import { json, type RequestHandler } from '@sveltejs/kit';
import { z, ZodError } from 'zod';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument } from '$lib/server/gcp/firestoreRest';

// The document holds arbitrary diagnostic data; validate as an object with any keys.
const DocSchema = z.object({}).loose();

export const GET: RequestHandler = async () => {
	console.log('GET: testing Firestore REST setup');
	try {
		const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
		if (!serviceAccountJson || serviceAccountJson.trim().length === 0) {
			return json({ error: 'misconfigured', message: 'GOOGLE_SERVICE_ACCOUNT_JSON missing' }, { status: 500 });
		}

		const documentPath = 'spark/test-user/docs/adminSdkDiagnostics';
		const snap = await getFirestoreDocument({ serviceAccountJson, documentPath });
		if (!snap.exists || !snap.data) {
			return json(
				{
					error: 'not_found',
					message: 'Document spark/test-user/docs/adminSdkDiagnostics not found'
				},
				{ status: 404 }
			);
		}

		const parsed = DocSchema.parse(snap.data);
		return json(parsed);
	} catch (err) {
		console.log('GET: failed:', err);
		if (err instanceof ZodError) {
			return json({ error: 'invalid_data', issues: err.issues }, { status: 400 });
		}
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: 'internal_error', message }, { status: 500 });
	}
};
