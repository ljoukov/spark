import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const suffix = params.path ? `/${params.path}` : '';
	throw redirect(302, `/spark/code${suffix}`);
};
