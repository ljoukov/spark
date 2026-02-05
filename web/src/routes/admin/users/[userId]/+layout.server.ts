import { getAdminUserProfile } from '$lib/server/admin/usersRepo';
import { z } from 'zod';
import type { LayoutServerLoad } from './$types';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required')
});

function toIso(value: Date | null): string | null {
	if (!value) {
		return null;
	}
	return value.toISOString();
}

export const load: LayoutServerLoad = async ({ params }) => {
	const { userId } = paramsSchema.parse(params);

	const profile = await getAdminUserProfile(userId).catch((error) => {
		console.error('Failed to load user profile', { userId, error });
		return null;
	});

	const user = profile ?? {
		uid: userId,
		email: null,
		name: null,
		photoUrl: null,
		isAnonymous: false,
		signInProvider: null,
		currentSessionId: null,
		createdAt: null,
		updatedAt: null,
		lastLoginAt: null,
		lastActivityAt: null
	};

	return {
		userDocFound: Boolean(profile),
		user: {
			uid: user.uid,
			email: user.email,
			name: user.name,
			photoUrl: user.photoUrl,
			isAnonymous: user.isAnonymous,
			signInProvider: user.signInProvider,
			currentSessionId: user.currentSessionId,
			createdAt: toIso(user.createdAt),
			updatedAt: toIso(user.updatedAt),
			lastLoginAt: toIso(user.lastLoginAt),
			lastActivityAt: toIso(user.lastActivityAt)
		}
	};
};

