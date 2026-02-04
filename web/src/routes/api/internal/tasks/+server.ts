import { json, type RequestHandler } from '@sveltejs/kit';
import {
	TaskSchema,
	generateSparkPdfQuizDefinition,
	generateCodeProblems,
	generateSessionMetadata,
	convertSessionPlanToItems,
	generateSession,
	generateQuizDefinitions,
	generateWelcomeSessionTemplate,
	runSparkAgentTask
} from '@spark/llm';
import {
	SparkUploadDocumentSchema,
	SparkUploadQuizDocumentSchema,
	type Session
} from '@spark/schemas';
import { saveUserProblem } from '$lib/server/code/problemRepo';
import { saveUserQuiz } from '$lib/server/quiz/repo';
import { saveSession, updateSessionStatus } from '$lib/server/session/repo';
import { env } from '$env/dynamic/private';
import {
	commitFirestoreWrites,
	getFirestoreDocument
} from '$lib/server/gcp/firestoreRest';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';
import { downloadStorageObject } from '$lib/server/gcp/storageRest';

type FailureContext = {
	reason: string;
	error?: unknown;
	userId: string;
	uploadId?: string;
	quizId?: string;
	sessionId?: string;
};

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function normalizeObjectName(storagePath: string): string {
	return storagePath.replace(/^\/+/, '');
}

export const POST: RequestHandler = async ({ request }) => {
	const bodyText = await request.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}

	const result = TaskSchema.safeParse(parsed);
	if (!result.success) {
		return json({ error: 'invalid_task', issues: result.error.issues }, { status: 400 });
	}

	const task = result.data;
	if (task.type === 'helloWorld') {
		console.log('[internal task] helloWorld');
		return json({ status: 'ok' }, { status: 200 });
	}

	if (task.type === 'generateWelcomeSession') {
		const { topic } = task.generateWelcomeSession;
		console.log(`[internal task] generateWelcomeSession topic="${topic}"`);
		try {
			const result = await generateWelcomeSessionTemplate({ topic });
			return json({ status: 'completed', sessionId: result.sessionId }, { status: 200 });
		} catch (error) {
			console.error('Failed to generate welcome session', { error, topic });
			return json({ status: 'failed', reason: 'welcome_generation_failed' }, { status: 500 });
		}
	}

	if (task.type === 'runAgent') {
		const { userId, agentId, workspaceId } = task.runAgent;
		console.log(
			`[internal task] runAgent userId=${userId} agentId=${agentId} workspaceId=${workspaceId}`
		);
		try {
			await runSparkAgentTask({ userId, agentId, workspaceId });
			return json({ status: 'completed' }, { status: 200 });
		} catch (error) {
			console.error('[internal task] runAgent failed', { error, userId, agentId });
			return json({ status: 'failed', reason: 'agent_failed' }, { status: 500 });
		}
	}

	if (task.type === 'generateLesson') {
		const { userId, sessionId, proposalId, title, tagline, topics, emoji, sourceSessionId } =
			task.generateLesson;
		console.log(
			`[internal task] generateLesson userId=${userId} sessionId=${sessionId} proposalId=${proposalId}`
		);

		const fail = async ({ reason, error }: FailureContext) => {
			console.error('[internal task] lesson generation failed', {
				reason,
				error,
				userId,
				sessionId,
				proposalId
			});
			try {
				await updateSessionStatus(userId, sessionId, 'error');
			} catch (statusError) {
				console.error('[internal task] failed to mark session error', statusError);
			}
			return json({ status: 'failed', reason }, { status: 500 });
		};

		try {
			const result = await generateSession({
				topic: topics.join(', '),
				userId,
				sessionId,
				storyPlanItemId: 'story'
			});

			const metadata = await generateSessionMetadata({
				topic: result.plan.topic,
				plan: result.plan,
				storyTitle: result.story?.title
			});

			const quizDefinitions = await generateQuizDefinitions(result.plan, result.quizzes);
			const filteredQuizDefinitions = quizDefinitions.filter(
				(quiz) => quiz.id === 'intro_quiz' || quiz.id === 'wrap_up_quiz'
			);
			const missingQuizId = ['intro_quiz', 'wrap_up_quiz'].find((required) =>
				filteredQuizDefinitions.every((quiz) => quiz.id !== required)
			);
			if (missingQuizId) {
				throw new Error(`quiz definitions missing required id '${missingQuizId}'`);
			}

			const codeProblems = await generateCodeProblems(result.plan, result.problems);
			const filteredProblems = codeProblems.filter(
				(problem) => problem.slug === 'p1' || problem.slug === 'p2'
			);
			const missingProblemId = ['p1', 'p2'].find((required) =>
				filteredProblems.every((problem) => problem.slug !== required)
			);
			if (missingProblemId) {
				throw new Error(`code problems missing required slug '${missingProblemId}'`);
			}

			const { plan: planItems } = convertSessionPlanToItems(result, 'story');

			const sessionDoc: Session = {
				id: sessionId,
				title: title ?? result.plan.topic,
				summary: metadata.summary,
				tagline: tagline ?? metadata.tagline,
				emoji: emoji ?? metadata.emoji,
				topics,
				status: 'ready',
				createdAt: new Date(),
				plan: planItems,
				nextLessonProposals: [],
				sourceSessionId,
				sourceProposalId: proposalId
			};

			await saveSession(userId, sessionDoc);
			await Promise.all(
				filteredQuizDefinitions.map(async (quiz) => {
					await saveUserQuiz(userId, sessionId, quiz);
				})
			);
			await Promise.all(
				filteredProblems.map(async (problem) => {
					await saveUserProblem(userId, sessionId, problem);
				})
			);
		} catch (error) {
			return await fail({ reason: 'lesson_generation_failed', error, userId, sessionId });
		}

		return json({ status: 'completed' }, { status: 200 });
	}

	if (task.type === 'generateQuiz') {
		const { userId, uploadId, quizId } = task.generateQuiz;
		console.log(
			`[internal task] generateQuiz userId=${userId} uploadId=${uploadId} quizId=${quizId}`
		);

		const serviceAccountJson = requireServiceAccountJson();
		const uploadDocPath = `spark/${userId}/uploads/${uploadId}`;
		const quizDocPath = `${uploadDocPath}/quiz/${quizId}`;

		const fail = async ({ reason, error }: FailureContext) => {
			console.error('[internal task] quiz generation failed', {
				reason,
				error,
				userId,
				uploadId,
				quizId
			});
			try {
				const timestamp = new Date();
				await commitFirestoreWrites({
					serviceAccountJson,
					writes: [
						{
							type: 'patch',
							documentPath: quizDocPath,
							updates: {
								status: 'failed',
								failureReason: reason,
								updatedAt: timestamp
							}
						},
						{
							type: 'patch',
							documentPath: uploadDocPath,
							updates: {
								status: 'failed',
								quizStatus: 'failed',
								latestError: reason,
								lastUpdatedAt: timestamp
							}
						}
					]
				});
			} catch (updateError) {
				console.error('[internal task] failed to persist failure state', {
					updateError,
					userId,
					uploadId,
					quizId
				});
			}
			return json({ status: 'failed', reason }, { status: 500 });
		};

		let uploadSnap;
		try {
			uploadSnap = await getFirestoreDocument({ serviceAccountJson, documentPath: uploadDocPath });
		} catch (error) {
			return await fail({ reason: 'upload_fetch_failed', error, userId, uploadId, quizId });
		}
		if (!uploadSnap.exists || !uploadSnap.data) {
			return await fail({ reason: 'upload_not_found', userId, uploadId, quizId });
		}

		let uploadDoc;
		try {
			uploadDoc = SparkUploadDocumentSchema.parse(uploadSnap.data);
		} catch (error) {
			return await fail({
				reason: 'invalid_upload_document',
				error,
				userId,
				uploadId,
				quizId
			});
		}

		let quizSnap;
		try {
			quizSnap = await getFirestoreDocument({ serviceAccountJson, documentPath: quizDocPath });
		} catch (error) {
			return await fail({ reason: 'quiz_fetch_failed', error, userId, uploadId, quizId });
		}
		if (!quizSnap.exists || !quizSnap.data) {
			return await fail({ reason: 'quiz_doc_not_found', userId, uploadId, quizId });
		}

		let quizDoc;
		try {
			quizDoc = SparkUploadQuizDocumentSchema.parse(quizSnap.data);
		} catch (error) {
			return await fail({
				reason: 'invalid_quiz_document',
				error,
				userId,
				uploadId,
				quizId
			});
		}

		try {
			const timestamp = new Date();
			await commitFirestoreWrites({
				serviceAccountJson,
				writes: [
					{
						type: 'patch',
						documentPath: quizDocPath,
						updates: {
							status: 'generating',
							updatedAt: timestamp
						},
						deletes: ['failureReason']
					},
					{
						type: 'patch',
						documentPath: uploadDocPath,
						updates: {
							status: 'processing',
							quizStatus: 'generating',
							lastUpdatedAt: timestamp,
							activeQuizId: quizId,
							quizQuestionCount: quizDoc.requestedQuestionCount
						},
						deletes: ['latestError']
					}
				]
			});
		} catch (error) {
			return await fail({
				reason: 'status_update_failed',
				error,
				userId,
				uploadId,
				quizId
			});
		}

		let fileBuffer: Buffer;
		try {
			const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
			const bucketName = `${serviceAccount.projectId}.firebasestorage.app`;
			const objectName = normalizeObjectName(uploadDoc.storagePath);
			const result = await downloadStorageObject({
				serviceAccountJson,
				bucketName,
				objectName
			});
			if (typeof Buffer === 'undefined') {
				throw new Error('Buffer is unavailable in this runtime');
			}
			fileBuffer = Buffer.from(result.bytes);
			if (!fileBuffer || fileBuffer.length === 0) {
				throw new Error('downloaded file is empty');
			}
		} catch (error) {
			return await fail({
				reason: 'storage_download_failed',
				error,
				userId,
				uploadId,
				quizId
			});
		}

		try {
			const definition = await generateSparkPdfQuizDefinition({
				quizId,
				sources: [
					{
						filename: uploadDoc.filename,
						mimeType: uploadDoc.contentType,
						data: fileBuffer
					}
				],
				questionCount: quizDoc.requestedQuestionCount
			});

			const timestamp = new Date();
			await commitFirestoreWrites({
				serviceAccountJson,
				writes: [
					{
						type: 'patch',
						documentPath: quizDocPath,
						updates: {
							status: 'ready',
							definition,
							updatedAt: timestamp
						},
						deletes: ['failureReason']
					},
					{
						type: 'patch',
						documentPath: uploadDocPath,
						updates: {
							status: 'ready',
							quizStatus: 'ready',
							lastUpdatedAt: timestamp,
							activeQuizId: quizId,
							quizQuestionCount: definition.questions.length
						},
						deletes: ['latestError']
					}
				]
			});
		} catch (error) {
			return await fail({
				reason: 'quiz_generation_failed',
				error,
				userId,
				uploadId,
				quizId
			});
		}

		return json({ status: 'completed' }, { status: 200 });
	}

	console.warn('[internal task] unsupported task type');
	return json({ error: 'unsupported_task' }, { status: 400 });
};
