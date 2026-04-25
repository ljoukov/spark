import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import {
	listDiagnosticTests,
	loadDiagnosticProfile,
	serializeDiagnosticProfileForClient,
	serializeDiagnosticTestForClient
} from '$lib/server/diagnostic/service';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const [profile, diagnostics] = await Promise.all([
		loadDiagnosticProfile(user.uid),
		listDiagnosticTests(user.uid, 30)
	]);
	return {
		profile: serializeDiagnosticProfileForClient(profile),
		diagnostics: diagnostics.map(serializeDiagnosticTestForClient)
	};
};
