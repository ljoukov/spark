import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getFirebaseAdminFirestore } from '$lib/server/utils/firebaseAdmin';

const bodySchema = z
	.object({
		name: z.string().trim().min(1).nullish(),
		email: z.email().nullish(),
		photoUrl: z.url().nullish(),
		isAnonymous: z.boolean().nullish()
	})
	.transform(({ name, email, photoUrl, isAnonymous }) => ({
		name: name ?? null,
		email: email?.toLowerCase() ?? null,
		photoUrl: photoUrl ?? null,
		isAnonymous: isAnonymous ?? false
	}));

export const POST: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const { user } = authResult;

	let parsedBody;
	try {
		const raw = await request.json();
		parsedBody = bodySchema.parse(raw);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json(
			{ error: 'invalid_body', message: 'Unable to parse request body as JSON' },
			{ status: 400 }
		);
	}

	const { name, email, photoUrl, isAnonymous } = parsedBody;

	const db = getFirebaseAdminFirestore();
	const docRef = db.collection('spark').doc(user.uid);
	const snapshot = await docRef.get();

	const nowIso = new Date().toISOString();
	type FirebaseSignInClaim = { sign_in_provider?: string };
	const firebaseClaim =
		(user.decodedToken as { firebase?: FirebaseSignInClaim } | null)?.firebase ?? null;
	const signInProvider = firebaseClaim?.sign_in_provider ?? null;

	const data: Record<string, unknown> = {
		uid: user.uid,
		name,
		email,
		photoUrl,
		isAnonymous,
		signInProvider,
		updatedAt: nowIso,
		lastLoginAt: nowIso
	};

	if (!snapshot.exists) {
		data.createdAt = nowIso;
	}

	await docRef.set(data, { merge: true });

	return json({ status: 'ok' });
};
