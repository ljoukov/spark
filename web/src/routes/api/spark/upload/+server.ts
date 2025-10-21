import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getFirebaseAdminBucket, getFirebaseAdminFirestore } from '$lib/server/utils/firebaseAdmin';
import { getFirebaseAdminFirestoreModule } from '@spark/llm';
import { type SparkUploadQuizStatus, type SparkUploadStatus } from '@spark/schemas';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { z } from 'zod';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const SPARK_UPLOAD_QUIZ_QUESTION_COUNT = 20;
const { FieldValue } = getFirebaseAdminFirestoreModule();

const filenameSchema = z
	.string()
	.trim()
	.min(1, 'File name is required')
	.max(512, 'File name is too long');

function inferExtension(filename: string, mimeType: string | null): string {
	const ext = extname(filename).trim().toLowerCase();
	if (ext) {
		return ext.slice(1);
	}
	if (mimeType === 'application/pdf' || mimeType === 'application/x-pdf') {
		return 'pdf';
	}
	return '';
}

export const POST: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (error) {
		console.error('Spark upload: unable to parse form data', { error, userId });
		return json(
			{ error: 'invalid_multipart', message: 'We could not read that upload request.' },
			{ status: 400 }
		);
	}

	const fileValue = formData.get('file');
	if (!(fileValue instanceof File)) {
		return json(
			{ error: 'missing_file', message: 'Please attach a PDF to upload.' },
			{ status: 400 }
		);
	}

	const filenameResult = filenameSchema.safeParse(fileValue.name ?? '');
	if (!filenameResult.success) {
		return json(
			{
				error: 'invalid_filename',
				message: filenameResult.error.issues[0]?.message ?? 'Invalid file name.'
			},
			{ status: 400 }
		);
	}
	const filename = filenameResult.data;

	const size = fileValue.size ?? 0;
	if (size <= 0) {
		return json({ error: 'empty_file', message: 'The selected file is empty.' }, { status: 400 });
	}
	if (size > MAX_FILE_BYTES) {
		return json(
			{
				error: 'file_too_large',
				message: 'Files must be 25MB or smaller.'
			},
			{ status: 413 }
		);
	}

	const mimeType =
		typeof fileValue.type === 'string' && fileValue.type.length > 0
			? fileValue.type.toLowerCase()
			: null;
	const extension = inferExtension(filename, mimeType);
	if (extension !== 'pdf') {
		return json(
			{ error: 'invalid_type', message: 'Only PDF files are supported right now.' },
			{ status: 400 }
		);
	}
	if (
		mimeType &&
		!['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(mimeType)
	) {
		return json(
			{ error: 'invalid_type', message: 'Only PDF files are supported right now.' },
			{ status: 400 }
		);
	}

	const storageContentType =
		mimeType && mimeType !== 'application/octet-stream' ? mimeType : 'application/pdf';

	let fileBuffer: Buffer;
	try {
		fileBuffer = Buffer.from(await fileValue.arrayBuffer());
	} catch (error) {
		console.error('Spark upload: failed to read file buffer', { error, userId });
		return json(
			{ error: 'read_failed', message: 'We could not read that file. Please try again.' },
			{ status: 400 }
		);
	}

	if (fileBuffer.length > MAX_FILE_BYTES) {
		return json(
			{
				error: 'file_too_large',
				message: 'Files must be 25MB or smaller.'
			},
			{ status: 413 }
		);
	}

	const digest = createHash('sha256').update(fileBuffer).digest('hex');
	const storagePath =
		extension.length > 0
			? `spark/uploads/${userId}/${digest}.${extension}`
			: `spark/uploads/${userId}/${digest}`;

	try {
		const bucket = getFirebaseAdminBucket();
		const fileRef = bucket.file(storagePath);
		await fileRef.save(fileBuffer, {
			resumable: false,
			gzip: false,
			contentType: storageContentType,
			public: false,
			metadata: {
				cacheControl: 'private, max-age=0, no-store'
			}
		});
	} catch (error) {
		console.error('Spark upload: failed to save file to storage', { error, userId, storagePath });
		return json(
			{
				error: 'upload_failed',
				message: 'We could not upload that file. Please try again.'
			},
			{ status: 500 }
		);
	}

	const firestore = getFirebaseAdminFirestore();
	const uploadDocRef = firestore.collection('spark').doc(userId).collection('uploads').doc(digest);
	const quizDocRef = uploadDocRef.collection('quiz').doc();
	const serverTimestamp = FieldValue.serverTimestamp();
	const uploadStatus: SparkUploadStatus = 'uploaded';
	const quizStatus: SparkUploadQuizStatus = 'pending';

	try {
		await firestore.runTransaction(async (tx) => {
			tx.set(
				uploadDocRef,
				{
					filename,
					storagePath,
					contentType: storageContentType,
					hash: digest,
					sizeBytes: fileBuffer.length,
					status: uploadStatus,
					quizStatus,
					quizQuestionCount: SPARK_UPLOAD_QUIZ_QUESTION_COUNT,
					uploadedAt: serverTimestamp,
					lastUpdatedAt: serverTimestamp,
					activeQuizId: quizDocRef.id
				},
				{ merge: true }
			);

			tx.set(quizDocRef, {
				uploadId: digest,
				status: quizStatus,
				requestedQuestionCount: SPARK_UPLOAD_QUIZ_QUESTION_COUNT,
				createdAt: serverTimestamp,
				updatedAt: serverTimestamp
			});
		});
	} catch (error) {
		console.error('Spark upload: failed to persist Firestore metadata', {
			error,
			userId,
			storagePath,
			uploadDocPath: uploadDocRef.path,
			quizDocPath: quizDocRef.path
		});
		return json(
			{
				error: 'metadata_failed',
				message: 'We uploaded the file but could not record its metadata. Please try again.'
			},
			{ status: 500 }
		);
	}

	return json(
		{
			storagePath,
			hash: digest,
			size: fileBuffer.length,
			contentType: storageContentType,
			uploadId: digest,
			uploadDocPath: uploadDocRef.path,
			quizId: quizDocRef.id,
			quizDocPath: quizDocRef.path,
			questionCount: SPARK_UPLOAD_QUIZ_QUESTION_COUNT
		},
		{ status: 201 }
	);
};
