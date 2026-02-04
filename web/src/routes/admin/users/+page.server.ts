import {
	listAdminUserProfiles,
	findAdminUsersByEmail,
	getAdminUserProfile
} from '$lib/server/admin/usersRepo';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const querySchema = z
	.object({
		q: z.string().trim().max(320).optional()
	})
	.transform(({ q }) => ({ q: q && q.length > 0 ? q : '' }));

function toIso(value: Date | null): string | null {
	if (!value) {
		return null;
	}
	return value.toISOString();
}

export const load: PageServerLoad = async ({ url }) => {
	const parsed = querySchema.parse({ q: url.searchParams.get('q') ?? undefined });
	const q = parsed.q;

	if (!q) {
		const users = await listAdminUserProfiles({ limit: 50, orderBy: 'lastLoginAt desc' });
		return {
			query: q,
			notice: '',
			users: users.map((user) => ({
				uid: user.uid,
				email: user.email,
				name: user.name,
				isAnonymous: user.isAnonymous,
				createdAt: toIso(user.createdAt),
				updatedAt: toIso(user.updatedAt),
				lastLoginAt: toIso(user.lastLoginAt),
				lastActivityAt: toIso(user.lastActivityAt)
			}))
		};
	}

	if (q.includes('@')) {
		const users = await findAdminUsersByEmail(q).catch((error) => {
			console.error('Failed to search users by email', { q, error });
			return [];
		});
		const notice = users.length === 0 ? 'No users found for that email.' : '';
		return {
			query: q,
			notice,
			users: users.map((user) => ({
				uid: user.uid,
				email: user.email,
				name: user.name,
				isAnonymous: user.isAnonymous,
				createdAt: toIso(user.createdAt),
				updatedAt: toIso(user.updatedAt),
				lastLoginAt: toIso(user.lastLoginAt),
				lastActivityAt: toIso(user.lastActivityAt)
			}))
		};
	}

	const user = await getAdminUserProfile(q).catch((error) => {
		console.error('Failed to fetch user by ID', { q, error });
		return null;
	});

	if (!user) {
		return {
			query: q,
			notice: 'No user found for that ID.',
			users: []
		};
	}

	return {
		query: q,
		notice: '',
		users: [
			{
				uid: user.uid,
				email: user.email,
				name: user.name,
				isAnonymous: user.isAnonymous,
				createdAt: toIso(user.createdAt),
				updatedAt: toIso(user.updatedAt),
				lastLoginAt: toIso(user.lastLoginAt),
				lastActivityAt: toIso(user.lastActivityAt)
			}
		]
	};
};
