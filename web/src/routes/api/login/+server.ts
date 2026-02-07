import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { setAppSessionCookie } from '$lib/server/auth/sessionCookie';
import { getFirestoreDocument, patchFirestoreDocument } from '$lib/server/gcp/firestoreRest';
import { env } from '$env/dynamic/private';

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

export const POST: RequestHandler = async ({ request, cookies }) => {
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

	try {
		await setAppSessionCookie(cookies, new URL(request.url), {
			uid: user.uid,
			name,
			email,
			photoUrl,
			isAnonymous
		});
	} catch (error) {
		console.warn('Failed to issue Spark session cookie (continuing)', {
			error: error instanceof Error ? error.message : String(error),
			userId: user.uid
		});
	}

	// Best-effort user doc upsert.
	// This must be Workers-compatible; Firebase Admin Firestore uses gRPC/protobuf codegen
	// and can throw EvalError on Cloudflare Workers.
	try {
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

		const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
		if (!serviceAccountJson || serviceAccountJson.trim().length === 0) {
			throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
		}

		const existing = await getFirestoreDocument({
			serviceAccountJson,
			documentPath: `spark/${user.uid}`
		});
		const existingCreatedAt =
			typeof existing.data?.createdAt === 'string' && existing.data.createdAt.trim().length > 0
				? existing.data.createdAt
				: null;

		await patchFirestoreDocument({
			serviceAccountJson,
			documentPath: `spark/${user.uid}`,
			updates: { ...data, createdAt: existingCreatedAt ?? nowIso }
		});
	} catch (error) {
		console.warn('Login user doc upsert failed (continuing)', {
			error: error instanceof Error ? error.message : String(error),
			userId: user.uid
		});
	}

	return json({ status: 'ok' });
};
