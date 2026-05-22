import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getGiadFlow } from '$lib/spark/giad/flows';

export const load: PageLoad = ({ params }) => {
	const flow = getGiadFlow(params.id);
	if (!flow) {
		throw error(404, 'Diagnosis flow not found');
	}
	return { flow };
};
