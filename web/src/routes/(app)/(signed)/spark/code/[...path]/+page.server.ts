import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const path = params.path?.trim() ?? '';
	if (!path) {
		throw redirect(302, '/spark/lesson');
	}
	if (path === 'lessons') {
		throw redirect(302, '/spark/lessons');
	}
	throw redirect(302, `/spark/lesson/${path}`);
};
