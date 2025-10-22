import { json, type RequestHandler } from '@sveltejs/kit';
import { z, ZodError } from 'zod';
import { getFirebaseAdminFirestore } from '@spark/llm';

// The document holds arbitrary diagnostic data; validate as an object with any keys.
const DocSchema = z.object({}).loose();

export const GET: RequestHandler = async () => {
	console.log('GET: testing firestore admin SDK setup');
	try {
		const db = getFirebaseAdminFirestore();
		const ref = db
			.collection('spark')
			.doc('test-user')
			.collection('docs')
			.doc('adminSdkDiagnostics');

		const snap = await ref.get();
		if (!snap.exists) {
			return json(
				{
					error: 'not_found',
					message: 'Document spark/test-user/docs/adminSdkDiagnostics not found'
				},
				{ status: 404 }
			);
		}

		const parsed = DocSchema.parse(snap.data());
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
