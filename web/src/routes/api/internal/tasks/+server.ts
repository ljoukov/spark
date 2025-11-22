import { json, type RequestHandler } from '@sveltejs/kit';
import {
	TaskSchema,
	generateSparkPdfQuizDefinition,
	getFirebaseAdminFirestore,
	getFirebaseAdminFirestoreModule,
	getFirebaseAdminStorage,
	getFirebaseStorageBucketName
} from '@spark/llm';
import { SparkUploadDocumentSchema, SparkUploadQuizDocumentSchema } from '@spark/schemas';

type FailureContext = {
	reason: string;
	error?: unknown;
	userId: string;
	uploadId: string;
	quizId: string;
};

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

	const { userId, uploadId, quizId } = task.generateQuiz;
	console.log(
		`[internal task] generateQuiz userId=${userId} uploadId=${uploadId} quizId=${quizId}`
	);

	const firestore = getFirebaseAdminFirestore();
	const storage = getFirebaseAdminStorage();
	const { FieldValue } = getFirebaseAdminFirestoreModule();
	const uploadDocRef = firestore
		.collection('spark')
		.doc(userId)
		.collection('uploads')
		.doc(uploadId);
	const quizDocRef = uploadDocRef.collection('quiz').doc(quizId);

	const fail = async ({ reason, error }: FailureContext) => {
		console.error('[internal task] quiz generation failed', {
			reason,
			error,
			userId,
			uploadId,
			quizId
		});
		const timestamp = FieldValue.serverTimestamp();
		try {
			await firestore.runTransaction(async (tx) => {
				tx.set(
					quizDocRef,
					{
						status: 'failed',
						failureReason: reason,
						updatedAt: timestamp
					},
					{ merge: true }
				);
				tx.set(
					uploadDocRef,
					{
						status: 'failed',
						quizStatus: 'failed',
						latestError: reason,
						lastUpdatedAt: timestamp
					},
					{ merge: true }
				);
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

	const uploadSnap = await uploadDocRef.get();
	if (!uploadSnap.exists) {
		return await fail({ reason: 'upload_not_found', userId, uploadId, quizId });
	}

	let uploadDoc;
	try {
		uploadDoc = SparkUploadDocumentSchema.parse(uploadSnap.data());
	} catch (error) {
		return await fail({
			reason: 'invalid_upload_document',
			error,
			userId,
			uploadId,
			quizId
		});
	}

	const quizSnap = await quizDocRef.get();
	if (!quizSnap.exists) {
		return await fail({ reason: 'quiz_doc_not_found', userId, uploadId, quizId });
	}

	let quizDoc;
	try {
		quizDoc = SparkUploadQuizDocumentSchema.parse(quizSnap.data());
	} catch (error) {
		return await fail({
			reason: 'invalid_quiz_document',
			error,
			userId,
			uploadId,
			quizId
		});
	}

	const generatingTimestamp = FieldValue.serverTimestamp();
	try {
		await firestore.runTransaction(async (tx) => {
			tx.update(quizDocRef, {
				status: 'generating',
				updatedAt: generatingTimestamp,
				failureReason: FieldValue.delete()
			});
			tx.update(uploadDocRef, {
				status: 'processing',
				quizStatus: 'generating',
				lastUpdatedAt: generatingTimestamp,
				activeQuizId: quizId,
				quizQuestionCount: quizDoc.requestedQuestionCount,
				latestError: FieldValue.delete()
			});
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
		const bucket = storage.bucket(getFirebaseStorageBucketName());
		const fileRef = bucket.file(uploadDoc.storagePath);
		[fileBuffer] = await fileRef.download();
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

		const completedTimestamp = FieldValue.serverTimestamp();
		await firestore.runTransaction(async (tx) => {
			tx.update(quizDocRef, {
				status: 'ready',
				definition,
				updatedAt: completedTimestamp,
				failureReason: FieldValue.delete()
			});
			tx.update(uploadDocRef, {
				status: 'ready',
				quizStatus: 'ready',
				lastUpdatedAt: completedTimestamp,
				activeQuizId: quizId,
				quizQuestionCount: definition.questions.length,
				latestError: FieldValue.delete()
			});
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
};
