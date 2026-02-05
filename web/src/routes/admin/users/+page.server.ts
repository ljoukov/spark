import {
	listAdminUserProfiles,
	findAdminUsersByEmail,
	getAdminUserProfile
} from '$lib/server/admin/usersRepo';
import { listFirestoreDocuments } from '$lib/server/gcp/firestoreRest';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const loginFilterSchema = z.enum(['all', 'guest', 'google', 'apple']);
const hasFilterSchema = z.enum(['all', 'lessons', 'chats']);

const querySchema = z
	.object({
		q: z.string().trim().max(320).optional(),
		login: loginFilterSchema.optional(),
		has: hasFilterSchema.optional()
	})
	.transform(({ q, login, has }) => ({
		q: q && q.length > 0 ? q : '',
		login: login ?? 'all',
		has: has ?? 'all'
	}));

function toIso(value: Date | null): string | null {
	if (!value) {
		return null;
	}
	return value.toISOString();
}

type LoginType = 'guest' | 'google' | 'apple' | 'other';

function deriveLoginType(user: { isAnonymous: boolean; signInProvider: string | null }): LoginType {
	if (user.isAnonymous || user.signInProvider === 'anonymous') {
		return 'guest';
	}
	if (user.signInProvider === 'google.com' || user.signInProvider === 'google') {
		return 'google';
	}
	if (user.signInProvider === 'apple.com' || user.signInProvider === 'apple') {
		return 'apple';
	}
	return 'other';
}

function matchesLoginFilter(
	user: { loginType: LoginType },
	login: z.infer<typeof loginFilterSchema>
): boolean {
	const matchers: Record<z.infer<typeof loginFilterSchema>, (loginType: LoginType) => boolean> = {
		all: () => true,
		guest: (loginType) => loginType === 'guest',
		google: (loginType) => loginType === 'google',
		apple: (loginType) => loginType === 'apple'
	};

	return matchers[login](user.loginType);
}

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

async function userHasLessons(userId: string, serviceAccountJson: string): Promise<boolean> {
	try {
		const docs = await listFirestoreDocuments({
			serviceAccountJson,
			collectionPath: `spark/${userId}/sessions`,
			limit: 1
		});
		return docs.length > 0;
	} catch (error) {
		console.error('Failed to check user lessons', { userId, error });
		return false;
	}
}

async function userHasChats(userId: string, serviceAccountJson: string): Promise<boolean> {
	try {
		const docs = await listFirestoreDocuments({
			serviceAccountJson,
			collectionPath: `${userId}/client/conversations`,
			limit: 1
		});
		return docs.length > 0;
	} catch (error) {
		console.error('Failed to check user chats', { userId, error });
		return false;
	}
}

async function filterUsersByHas<T extends { uid: string }>(
	users: T[],
	has: z.infer<typeof hasFilterSchema>,
	limit: number
): Promise<T[]> {
	if (has === 'all') {
		return users.slice(0, limit);
	}

	const serviceAccountJson = requireServiceAccountJson();
	const chunkSize = 10;
	const filtered: T[] = [];

	for (let offset = 0; offset < users.length; offset += chunkSize) {
		if (filtered.length >= limit) {
			break;
		}

		const chunk = users.slice(offset, offset + chunkSize);
		const checks = await Promise.all(
			chunk.map(async (user) => {
				if (has === 'lessons') {
					return await userHasLessons(user.uid, serviceAccountJson);
				}
				return await userHasChats(user.uid, serviceAccountJson);
			})
		);

		for (let index = 0; index < chunk.length; index += 1) {
			if (filtered.length >= limit) {
				break;
			}
			if (checks[index]) {
				const user = chunk[index];
				if (user) {
					filtered.push(user);
				}
			}
		}
	}

	return filtered;
}

export const load: PageServerLoad = async ({ url }) => {
	const parsed = querySchema.parse({
		q: url.searchParams.get('q') ?? undefined,
		login: url.searchParams.get('login') ?? undefined,
		has: url.searchParams.get('has') ?? undefined
	});
	const q = parsed.q;
	const login = parsed.login;
	const has = parsed.has;

	if (!q) {
		const rawUsers = await listAdminUserProfiles({
			limit: login === 'all' && has === 'all' ? 50 : 200,
			orderBy: 'lastLoginAt desc'
		});
		const loginFiltered = rawUsers
			.map((user) => ({
				...user,
				loginType: deriveLoginType(user)
			}))
			.filter((user) => matchesLoginFilter(user, login));
		const users = await filterUsersByHas(loginFiltered, has, 50);
		return {
			query: q,
			login,
			has,
			notice: '',
			users: users.map((user) => ({
				uid: user.uid,
				email: user.email,
				name: user.name,
				isAnonymous: user.isAnonymous,
				loginType: user.loginType,
				createdAt: toIso(user.createdAt),
				updatedAt: toIso(user.updatedAt),
				lastLoginAt: toIso(user.lastLoginAt),
				lastActivityAt: toIso(user.lastActivityAt)
			}))
		};
	}

	if (q.includes('@')) {
		const rawUsers = await findAdminUsersByEmail(q).catch((error) => {
			console.error('Failed to search users by email', { q, error });
			return [];
		});

		const users = rawUsers
			.map((user) => ({
				...user,
				loginType: deriveLoginType(user)
			}));

		const notice = users.length === 0 ? 'No users found for that query.' : '';
		return {
			query: q,
			login: 'all',
			has: 'all',
			notice,
			users: users.map((user) => ({
				uid: user.uid,
				email: user.email,
				name: user.name,
				isAnonymous: user.isAnonymous,
				loginType: user.loginType,
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
			login: 'all',
			has: 'all',
			notice: 'No users found for that query.',
			users: []
		};
	}

	return {
		query: q,
		login: 'all',
		has: 'all',
		notice: '',
		users: [
			{
				uid: user.uid,
				email: user.email,
				name: user.name,
				isAnonymous: user.isAnonymous,
				loginType: deriveLoginType(user),
				createdAt: toIso(user.createdAt),
				updatedAt: toIso(user.updatedAt),
				lastLoginAt: toIso(user.lastLoginAt),
				lastActivityAt: toIso(user.lastActivityAt)
			}
		]
	};
};
