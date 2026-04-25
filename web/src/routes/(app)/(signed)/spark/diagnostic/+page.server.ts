import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import {
	getLatestDiagnosticTest,
	serializeDiagnosticTestForClient
} from '$lib/server/diagnostic/service';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const latest = await getLatestDiagnosticTest(user.uid);
	return {
		diagnostic: latest ? serializeDiagnosticTestForClient(latest) : null
	};
};
