import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
	SparkTutorSessionSchema,
	type PaperSheetQuestion,
	type SparkGraderWorksheetReport
} from '@spark/schemas';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	findWorksheetQuestionEntry,
	safeParseGraderWorksheetReport
} from '$lib/server/grader/problemReport';
import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import {
	TUTOR_FALLBACK_REVIEW_REPLY_MARKDOWN,
	recoverTutorSessionIfStale
} from '$lib/server/tutorSessions/recovery';
import {
	appendTutorReviewMessage,
	buildInitialTutorReviewState,
	buildTutorReviewFocusLabel,
	buildTutorReviewPreview,
	findTutorReviewThread,
	summarizeTutorReviewState,
	updateTutorReviewThread
} from '$lib/server/tutorSessions/reviewState';
import {
	createTutorSession,
	findTutorSessionForSheet,
	getTutorSession,
	patchTutorSession
} from '$lib/server/tutorSessions/repo';
import {
	createTutorTurnAgentRun,
	ensureWorkspaceDoc,
	requireTutorServiceAccountJson
} from '$lib/server/tutorSessions/service';
import {
	buildTutorQuestionTurnPath,
	readTutorWorkspaceState,
	seedTutorWorkspace,
	writeTutorWorkspaceTextFile
} from '$lib/server/tutorSessions/workspace';

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

const requestSchema = z.object({
	action: z.literal('reply'),
	questionId: z.string().trim().min(1),
	text: z.string().trim().min(1)
});

function stringifyJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function formatThreadMessages(markdownByRole: Array<{ author: 'assistant' | 'student'; markdown: string }>): string {
	return markdownByRole
		.map((entry) => `${entry.author === 'assistant' ? 'Assistant' : 'Student'}:\n${entry.markdown}`)
		.join('\n\n');
}

function formatQuestionShape(question: PaperSheetQuestion): string {
	switch (question.type) {
		case 'fill':
			return [
				'Question type: fill-in-the-blank.',
				`Prompt before blank(s): ${question.prompt}`,
				`Blank count: ${question.blanks.length.toString()}`,
				...(question.conjunction ? [`Text between blanks: ${question.conjunction}`] : []),
				`Text after blank(s): ${question.after}`
			].join('\n');
		case 'mcq':
			return [
				'Question type: multiple choice.',
				`Prompt: ${question.prompt}`,
				`Options: ${question.options.join(' | ')}`
			].join('\n');
		case 'lines':
			return [
				'Question type: open written response.',
				`Prompt: ${question.prompt}`,
				`Writing lines shown on the worksheet: ${question.lines.toString()}`
			].join('\n');
		case 'calc':
			return [
				'Question type: calculation / short numeric response.',
				`Prompt: ${question.prompt}`,
				...(question.hint ? [`Hint on worksheet: ${question.hint}`] : []),
				`Input label: ${question.inputLabel}`,
				`Required unit: ${question.unit}`
			].join('\n');
		case 'match':
			return [
				'Question type: matching.',
				`Prompt: ${question.prompt}`,
				`Pairs to match: ${question.pairs.map((pair) => `${pair.term} -> ${pair.match}`).join(' | ')}`
			].join('\n');
		case 'spelling':
			return [
				'Question type: spelling correction.',
				`Prompt: ${question.prompt}`,
				`Words shown on worksheet: ${question.words.map((word) => word.wrong).join(' | ')}`
			].join('\n');
	}
}

function formatRecordedAnswer(report: SparkGraderWorksheetReport, questionId: string): string {
	const value = report.answers[questionId];
	if (typeof value === 'string') {
		return value.trim().length > 0 ? value : '(blank)';
	}
	if (!value) {
		return '(blank)';
	}
	return Object.entries(value)
		.map(([key, answer]) => `${key}: ${answer.trim().length > 0 ? answer : '(blank)'}`)
		.join('\n');
}

function buildSheetReplyPrompt(options: {
	report: SparkGraderWorksheetReport;
	questionId: string;
	threadMessages: Array<{ author: 'assistant' | 'student'; markdown: string }>;
	studentReplyMarkdown: string;
	studentTurnFilePath: string;
}): string {
	const entry = findWorksheetQuestionEntry(options.report.sheet, options.questionId);
	if (!entry) {
		return '';
	}

	const questionReview = options.report.review.questions[options.questionId];
	const references = options.report.references ?? {};

	return [
		'You are replying inside Spark\'s sheet feedback workflow.',
		'Focus only on the selected worksheet question.',
		'The student is looking at the worksheet question, their recorded answer, the grading note, and the interactive feedback thread on the same card.',
		'The student has already written their new reply into the workspace file listed below.',
		'That workspace history is append-only. Do not ask to delete or rewrite prior files.',
		'Use `wait_for_student_input` if the question still needs another revision.',
		'Use `complete_tutor_session` only if this question is now satisfied.',
		'Keep the reply concise, specific, and student-facing.',
		'Start by acknowledging the most sensible part of the latest attempt before naming the exact remaining gap.',
		'Prefer a rule of thumb, contrast, cue, or small next step before giving away the full answer.',
		'',
		`Worksheet: ${options.report.sheet.title}`,
		`Section: ${entry.section.label}`,
		`Question number: ${entry.number.toString()}`,
		`Marks: ${entry.question.marks.toString()}`,
		formatQuestionShape(entry.question),
		'',
		'Recorded worksheet answer:',
		formatRecordedAnswer(options.report, options.questionId),
		'',
		'Initial feedback note on this question:',
		questionReview?.note ?? '(missing)',
		'',
		'Interactive thread so far:',
		formatThreadMessages(options.threadMessages),
		'',
		`Latest student response file: ${options.studentTurnFilePath}`,
		'Latest student response content:',
		options.studentReplyMarkdown,
		'',
		'Whole-sheet marking notes:',
		references.gradingMarkdown ?? '(missing)',
		'',
		'Overall sheet feedback:',
		references.overallFeedbackMarkdown ?? '(missing)',
		'',
		'Reference problem text:',
		references.officialProblemMarkdown ?? references.problemMarkdown ?? '(missing)',
		'',
		'Reference solution:',
		references.officialSolutionMarkdown ?? '(missing)',
		'',
		'Tool reminder:',
		'- `wait_for_student_input`: append your reply and leave the question open.',
		'- `complete_tutor_session`: append your reply and resolve the question.',
		'- Then immediately call `done` with a short summary.'
	].join('\n');
}

export const POST: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let parsedParams: z.infer<typeof paramsSchema>;
	let parsedBody: z.infer<typeof requestSchema>;
	try {
		parsedParams = paramsSchema.parse(params);
		parsedBody = requestSchema.parse(await request.json());
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_request' }, { status: 400 });
	}

	const run = await getGraderRun(userId, parsedParams.sheetId);
	if (!run) {
		return json({ error: 'sheet_not_found' }, { status: 404 });
	}

	const reportPath = run.sheet?.filePath ?? run.sheetPath;
	const reportRaw = await getWorkspaceTextFile(userId, run.workspaceId, reportPath);
	if (!reportRaw) {
		return json({ error: 'sheet_not_ready' }, { status: 409 });
	}
	const report = safeParseGraderWorksheetReport(reportRaw);
	if (!report) {
		return json({ error: 'sheet_invalid' }, { status: 500 });
	}

	const serviceAccountJson = requireTutorServiceAccountJson();
	let session = await findTutorSessionForSheet({
		userId,
		runId: run.id
	});

	const now = new Date();
	if (!session) {
		const sessionId = randomUUID();
		const workspaceId = randomUUID();
		const reviewState = buildInitialTutorReviewState({
			report,
			now
		});
		const reviewSummary = summarizeTutorReviewState(reviewState);
		session = SparkTutorSessionSchema.parse({
			id: sessionId,
			workspaceId,
			status: reviewSummary.allResolved ? 'completed' : 'awaiting_student',
			source: {
				kind: 'sheet',
				runId: run.id,
				sheetTitle: report.sheet.title,
				...(typeof run.totals?.awardedMarks === 'number'
					? { awardedMarks: run.totals.awardedMarks }
					: {}),
				...(typeof run.totals?.maxMarks === 'number' ? { maxMarks: run.totals.maxMarks } : {})
			},
			title: `${report.sheet.title} feedback`,
			preview: buildTutorReviewPreview(reviewState),
			...(buildTutorReviewFocusLabel(reviewState)
				? { focusLabel: buildTutorReviewFocusLabel(reviewState) }
				: {}),
			createdAt: now,
			updatedAt: now,
			...(reviewSummary.allResolved ? { completedAt: now } : {})
		});

		await ensureWorkspaceDoc({
			userId,
			workspaceId,
			sessionId,
			now
		});
		await createTutorSession(userId, session);
		await seedTutorWorkspace({
			serviceAccountJson,
			userId,
			workspaceId,
			session,
			report,
			now
		});
	}

	let workspace = await readTutorWorkspaceState({
		serviceAccountJson,
		userId,
		workspaceId: session.workspaceId,
		session
	});
	const recovered = await recoverTutorSessionIfStale({
		serviceAccountJson,
		userId,
		session,
		reviewState: workspace.reviewState
	});
	if (recovered) {
		session = recovered.session;
		workspace = {
			...workspace,
			screenState: recovered.screenState,
			composerState: recovered.composerState,
			reviewState: recovered.reviewState
		};
	}

	if (session.status === 'responding') {
		return json({ error: 'sheet_busy' }, { status: 409 });
	}

	const currentThread = findTutorReviewThread(workspace.reviewState, parsedBody.questionId);
	if (!currentThread) {
		return json({ error: 'question_not_found' }, { status: 404 });
	}

	const createdAt = now.toISOString();
	const studentTurnFilePath = buildTutorQuestionTurnPath({
		questionId: parsedBody.questionId,
		author: 'student',
		now
	});
	const respondingThread = appendTutorReviewMessage({
		thread: currentThread,
		author: 'student',
		markdown: parsedBody.text,
		createdAt,
		status: 'responding'
	});
	const respondingReviewState = updateTutorReviewThread({
		reviewState: workspace.reviewState,
		thread: respondingThread,
		now
	});
	const respondingPreview = buildTutorReviewPreview(respondingReviewState);
	const respondingFocus = buildTutorReviewFocusLabel(respondingReviewState);

	await Promise.all([
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: studentTurnFilePath,
			content: stringifyJson({
				author: 'student',
				markdown: parsedBody.text,
				createdAt
			}),
			now
		}),
		writeTutorWorkspaceTextFile({
			serviceAccountJson,
			userId,
			workspaceId: session.workspaceId,
			filePath: 'state/review.json',
			content: stringifyJson(respondingReviewState),
			now
		}),
		patchTutorSession(userId, session.id, {
			status: 'responding',
			updatedAt: now,
			preview: respondingPreview,
			focusLabel: respondingFocus ?? null,
			error: null
		})
	]);

	const prompt = buildSheetReplyPrompt({
		report,
		questionId: parsedBody.questionId,
		threadMessages: respondingThread.messages.map((message) => ({
			author: message.author,
			markdown: message.markdown
		})),
		studentReplyMarkdown: parsedBody.text,
		studentTurnFilePath
	});
	const agentId = randomUUID();

	try {
		await createTutorTurnAgentRun({
			userId,
			agentId,
			workspaceId: session.workspaceId,
			sessionId: session.id,
			prompt,
			title: `${report.sheet.title} feedback`,
			action: 'reply',
			now,
			questionId: parsedBody.questionId,
			turnFilePath: studentTurnFilePath,
			studentText: parsedBody.text
		});
		await patchTutorSession(
			userId,
			session.id,
			{
				activeTurnAgentId: agentId,
				activeTurnQuestionId: parsedBody.questionId,
				updatedAt: new Date()
			},
			['error']
		).catch((error) => {
			console.warn('Unable to persist active tutor turn metadata', {
				error,
				userId,
				sessionId: session.id,
				agentId
			});
		});
	} catch (error) {
		const recoveredThread = appendTutorReviewMessage({
			thread: respondingThread,
			author: 'assistant',
			markdown: TUTOR_FALLBACK_REVIEW_REPLY_MARKDOWN,
			createdAt: new Date().toISOString(),
			status: 'open'
		});
		const recoveredReviewState = updateTutorReviewThread({
			reviewState: workspace.reviewState,
			thread: recoveredThread,
			now: new Date()
		});
		await Promise.all([
			writeTutorWorkspaceTextFile({
				serviceAccountJson,
				userId,
				workspaceId: session.workspaceId,
				filePath: 'state/review.json',
				content: stringifyJson(recoveredReviewState),
				now: new Date()
			}),
			patchTutorSession(userId, session.id, {
				status: 'awaiting_student',
				updatedAt: new Date(),
				preview: buildTutorReviewPreview(recoveredReviewState),
				focusLabel: buildTutorReviewFocusLabel(recoveredReviewState) ?? null,
				error:
					error instanceof Error && error.message.trim().length > 0
						? error.message.trim()
						: 'Unable to start worksheet feedback.'
			}, ['activeTurnAgentId', 'activeTurnQuestionId'])
		]);
		return json({ error: 'reply_launch_failed' }, { status: 500 });
	}

	return json(
		{
			ok: true,
			sessionId: session.id,
			workspaceId: session.workspaceId
		},
		{ status: 202 }
	);
};
