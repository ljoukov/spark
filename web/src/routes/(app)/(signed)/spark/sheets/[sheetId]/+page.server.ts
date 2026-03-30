import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { loadSparkSheetPageState } from '$lib/server/grader/sheetPageState';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const state = await loadSparkSheetPageState({
		userId: user.uid,
		sheetId: params.sheetId
	});
	if (!state) {
		throw error(404, 'Sheet not found');
	}
	return state;
};
