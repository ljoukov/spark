import {
	listAdminUserProfiles,
	findAdminUsersByEmail,
	getAdminUserProfile
} from '$lib/server/admin/usersRepo';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const loginFilterSchema = z.enum(['all', 'guest', 'google', 'apple']);

const querySchema = z
	.object({
		q: z.string().trim().max(320).optional(),
		login: loginFilterSchema.optional()
	})
	.transform(({ q, login }) => ({
		q: q && q.length > 0 ? q : '',
		login: login ?? 'all'
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

function matchesLoginFilter(user: { loginType: LoginType }, login: z.infer<typeof loginFilterSchema>): boolean {
	const matchers: Record<z.infer<typeof loginFilterSchema>, (loginType: LoginType) => boolean> = {
		all: () => true,
		guest: (loginType) => loginType === 'guest',
		google: (loginType) => loginType === 'google',
		apple: (loginType) => loginType === 'apple'
	};

	return matchers[login](user.loginType);
}

export const load: PageServerLoad = async ({ url }) => {
	const parsed = querySchema.parse({
		q: url.searchParams.get('q') ?? undefined,
		login: url.searchParams.get('login') ?? undefined
	});
	const q = parsed.q;
	const login = parsed.login;

	if (!q) {
		const rawUsers = await listAdminUserProfiles({
			limit: login === 'all' ? 50 : 200,
			orderBy: 'lastLoginAt desc'
		});
		const users = rawUsers
			.map((user) => ({
				...user,
				loginType: deriveLoginType(user)
			}))
			.filter((user) => matchesLoginFilter(user, login))
			.slice(0, 50);
		return {
			query: q,
			login,
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
			}))
			.filter((user) => matchesLoginFilter(user, login));

		const notice = users.length === 0 ? 'No users found for that query.' : '';
		return {
			query: q,
			login,
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

	if (!user || !matchesLoginFilter({ loginType: deriveLoginType(user) }, login)) {
		return {
			query: q,
			login,
			notice: 'No users found for that query.',
			users: []
		};
	}

	return {
		query: q,
		login,
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
