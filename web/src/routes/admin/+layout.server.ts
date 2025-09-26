import type { LayoutServerLoad } from './$types';
import { isUserAdmin } from '$lib/server/utils/admin';
import { isTestUser } from '$lib/server/auth/testUser';

type AdminAuthState = 'anonymous' | 'allowed' | 'forbidden';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		return {
			user: null,
			isAdmin: false,
			authState: 'anonymous' as const satisfies AdminAuthState,
			authDisabled: isTestUser()
		};
	}

	let isAdmin = false;
	try {
		isAdmin = isUserAdmin({ userId: user.uid });
	} catch {
		isAdmin = false;
	}

	if (!isAdmin) {
		return {
			user,
			isAdmin: false,
			authState: 'forbidden' as const satisfies AdminAuthState,
			authDisabled: isTestUser()
		};
	}

	return {
		user,
		isAdmin: true,
		authState: 'allowed' as const satisfies AdminAuthState,
		authDisabled: isTestUser()
	};
};
