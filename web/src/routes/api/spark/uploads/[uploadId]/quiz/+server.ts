import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	createTask,
	getFirebaseAdminFirestore,
	getFirebaseAdminFirestoreModule,
	SPARK_UPLOAD_QUIZ_QUESTION_COUNT
} from '@spark/llm';
import { json, type RequestHandler } from '@sveltejs/kit';
import { SparkUploadDocumentSchema } from '@spark/schemas';
import { z } from 'zod';

const requestSchema = z
	.object({
		questionCount: z.number().int().min(1).max(40).optional()
	})
	.optional();

const uploadIdSchema = z
	.string()
	.trim()
	.min(1, 'Upload ID is required')
	.max(128, 'Upload ID is too long');

export const POST: RequestHandler = async ({ params, request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const uploadIdResult = uploadIdSchema.safeParse(params.uploadId ?? '');
	if (!uploadIdResult.success) {
		return json(
			{
				error: 'invalid_upload_id',
				message: uploadIdResult.error.issues[0]?.message ?? 'Invalid upload identifier.'
			},
			{ status: 400 }
		);
	}

	let body: z.infer<typeof requestSchema> = undefined;
	if (request.headers.get('content-type')?.includes('application/json')) {
		try {
			body = requestSchema.parse(await request.json());
		} catch (error) {
			console.error('Spark quiz rerun: failed to parse body', {
				error,
				uploadId: uploadIdResult.data
			});
			return json({ error: 'invalid_body', message: 'Body must be valid JSON.' }, { status: 400 });
		}
	}

	const firestore = getFirebaseAdminFirestore();
	const { FieldValue } = getFirebaseAdminFirestoreModule();
	const uploadDocRef = firestore
		.collection('spark')
		.doc(authResult.user.uid)
		.collection('uploads')
		.doc(uploadIdResult.data);

	const uploadSnap = await uploadDocRef.get();
	if (!uploadSnap.exists) {
		return json(
			{
				error: 'upload_not_found',
				message: 'We could not find that upload.'
			},
			{ status: 404 }
		);
	}

	let uploadDoc;
	try {
		uploadDoc = SparkUploadDocumentSchema.parse(uploadSnap.data());
	} catch (error) {
		console.error('Spark quiz rerun: invalid upload document', {
			error,
			uploadId: uploadIdResult.data,
			userId: authResult.user.uid
		});
		return json(
			{
				error: 'invalid_upload_document',
				message: 'Uploaded file metadata is malformed.'
			},
			{ status: 500 }
		);
	}

	let questionCount =
		body?.questionCount ?? uploadDoc.quizQuestionCount ?? SPARK_UPLOAD_QUIZ_QUESTION_COUNT;
	if (!Number.isFinite(questionCount) || questionCount <= 0) {
		questionCount = SPARK_UPLOAD_QUIZ_QUESTION_COUNT;
	}
	const quizCollection = uploadDocRef.collection('quiz');
	const quizDocRef = quizCollection.doc();
	const serverTimestamp = FieldValue.serverTimestamp();

	try {
		await firestore.runTransaction(async (tx) => {
			tx.set(
				quizDocRef,
				{
					uploadId: uploadIdResult.data,
					status: 'pending',
					requestedQuestionCount: questionCount,
					createdAt: serverTimestamp,
					updatedAt: serverTimestamp
				},
				{ merge: false }
			);

			tx.set(
				uploadDocRef,
				{
					status: 'processing',
					quizStatus: 'pending',
					quizQuestionCount: questionCount,
					activeQuizId: quizDocRef.id,
					lastUpdatedAt: serverTimestamp,
					latestError: FieldValue.delete()
				},
				{ merge: true }
			);
		});
	} catch (error) {
		console.error('Spark quiz rerun: failed to seed Firestore docs', {
			error,
			uploadId: uploadIdResult.data,
			quizId: quizDocRef.id,
			userId: authResult.user.uid
		});
		return json(
			{
				error: 'metadata_failed',
				message: 'We could not queue quiz generation. Please try again.'
			},
			{ status: 500 }
		);
	}

	try {
		await createTask({
			type: 'generateQuiz',
			generateQuiz: {
				userId: authResult.user.uid,
				uploadId: uploadIdResult.data,
				quizId: quizDocRef.id
			}
		});
	} catch (error) {
		console.error('Spark quiz rerun: failed to enqueue task', {
			error,
			uploadId: uploadIdResult.data,
			quizId: quizDocRef.id,
			userId: authResult.user.uid
		});

		try {
			await firestore.runTransaction(async (tx) => {
				tx.update(quizDocRef, {
					status: 'failed',
					failureReason: 'enqueue_failed',
					updatedAt: FieldValue.serverTimestamp()
				});
				tx.update(uploadDocRef, {
					status: 'failed',
					quizStatus: 'failed',
					latestError: 'Failed to enqueue quiz generation. Please retry later.',
					lastUpdatedAt: FieldValue.serverTimestamp()
				});
			});
		} catch (updateError) {
			console.error('Spark quiz rerun: failed to mark enqueue failure', {
				error: updateError,
				uploadId: uploadIdResult.data,
				quizId: quizDocRef.id,
				userId: authResult.user.uid
			});
		}

		return json(
			{
				error: 'enqueue_failed',
				message: 'We queued the request but could not start generation. Please try again soon.'
			},
			{ status: 500 }
		);
	}

	return json(
		{
			uploadId: uploadIdResult.data,
			quizId: quizDocRef.id,
			requestedQuestionCount: questionCount
		},
		{ status: 201 }
	);
};
