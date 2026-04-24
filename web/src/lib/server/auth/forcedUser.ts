import { env } from '$env/dynamic/private';
import { getAdminUserProfile } from '$lib/server/admin/usersRepo';
import { z } from 'zod';

const forcedUserEnvSchema = z.object({
	FORCE_USER_ID: z.string().trim().min(1).optional().catch(undefined)
});

type ForcedUserEnv = z.infer<typeof forcedUserEnvSchema>;

let cachedForcedAppUser: {
	cacheKey: string;
	user: NonNullable<App.Locals['appUser']>;
} | null = null;

function readForcedUserEnv(): ForcedUserEnv {
	return forcedUserEnvSchema.parse({
		FORCE_USER_ID: env.FORCE_USER_ID
	});
}

function buildForcedUserCacheKey(parsed: ForcedUserEnv): string {
	return parsed.FORCE_USER_ID ?? '';
}

export async function getForcedAppUser(): Promise<NonNullable<App.Locals['appUser']> | null> {
	const parsed = readForcedUserEnv();

	if (!parsed.FORCE_USER_ID) {
		return null;
	}

	const cacheKey = buildForcedUserCacheKey(parsed);
	if (cachedForcedAppUser?.cacheKey === cacheKey) {
		return cachedForcedAppUser.user;
	}

	let profile: Awaited<ReturnType<typeof getAdminUserProfile>> = null;
	try {
		profile = await getAdminUserProfile(parsed.FORCE_USER_ID);
	} catch (error) {
		console.warn('Failed to load forced user profile from Firestore', {
			error: error instanceof Error ? error.message : String(error),
			userId: parsed.FORCE_USER_ID
		});
	}

	const user = {
		uid: parsed.FORCE_USER_ID,
		name: profile?.name ?? null,
		email: profile?.email ?? null,
		photoUrl: profile?.photoUrl ?? null,
		isAnonymous: parsed.FORCE_USER_ID === profile?.uid ? profile.isAnonymous : false
	};

	cachedForcedAppUser = { cacheKey, user };
	return user;
}
