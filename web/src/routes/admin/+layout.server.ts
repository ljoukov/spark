import type { LayoutServerLoad } from './$types';
import { isUserAdmin } from '$lib/server/utils/admin';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	let isAdmin = false;
	if (user) {
		try {
			isAdmin = isUserAdmin({ userId: user.uid } as unknown as { userId: string });
		} catch {
			isAdmin = false;
		}
	}
	return {
		user,
		isAdmin
	};
};
