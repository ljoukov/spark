import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { verifyFirebaseIdToken } from '$lib/server/utils/firebaseServer';
import { getTestUserId, isTestUser } from '$lib/server/auth/testUser';
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

function extractBearerToken(header: string | null): string | null {
	if (!header) {
		return null;
	}
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match?.[1]?.trim() ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
	let decoded: { sub: string; firebase?: { sign_in_provider?: string } };
	if (isTestUser()) {
		decoded = { sub: getTestUserId() };
	} else {
		const token = extractBearerToken(request.headers.get('authorization'));
		if (!token) {
			return json(
				{ error: 'unauthorized', message: 'Missing or invalid Authorization header' },
				{ status: 401 }
			);
		}
		try {
			decoded = await verifyFirebaseIdToken(token);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Invalid Firebase ID token';
			return json({ error: 'unauthorized', message }, { status: 401 });
		}
	}

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
	const docRef = db.collection('spark').doc(decoded.sub);
	const snapshot = await docRef.get();

	const nowIso = new Date().toISOString();
	const firebaseClaim = (decoded as { firebase?: { sign_in_provider?: string } }).firebase;
	const signInProvider = firebaseClaim?.sign_in_provider ?? null;

	const data: Record<string, unknown> = {
		uid: decoded.sub,
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
