import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { getLearningGap } from '$lib/server/gaps/repo';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const gap = await getLearningGap(user.uid, params.gapId);
	if (!gap) {
		throw error(404, 'Gap not found');
	}

	return {
		gap: {
			...gap,
			createdAt: gap.createdAt.toISOString(),
			updatedAt: gap.updatedAt.toISOString()
		}
	};
};
