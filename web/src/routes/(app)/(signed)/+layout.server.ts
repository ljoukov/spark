import { redirect } from '@sveltejs/kit';
import { isUserAdmin } from '$lib/server/utils/admin';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const user = locals.appUser;
	if (!user) {
		const redirectTo = `${url.pathname}${url.search}`;
		throw redirect(302, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
	}

	let admin = false;
	try {
		admin = isUserAdmin({ userId: user.uid });
	} catch {
		admin = false;
	}

	return { user, isAdmin: admin, authMode: locals.authMode };
};
