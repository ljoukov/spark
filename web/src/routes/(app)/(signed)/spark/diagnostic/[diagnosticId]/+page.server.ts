import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import {
	buildDiagnosticPaperSheetData,
	getDiagnosticTest,
	serializeDiagnosticTestForClient
} from '$lib/server/diagnostic/service';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const diagnostic = await getDiagnosticTest(user.uid, params.diagnosticId);
	if (!diagnostic || diagnostic.status === 'complete') {
		throw redirect(302, '/spark/diagnostic');
	}

	const activeSheet =
		diagnostic.sheets.find((sheet) => sheet.index === diagnostic.currentSheetIndex) ?? null;
	if (!activeSheet || activeSheet.runId || activeSheet.grading) {
		throw redirect(302, '/spark/diagnostic');
	}

	return {
		diagnostic: serializeDiagnosticTestForClient(diagnostic),
		sheetDocument: buildDiagnosticPaperSheetData({
			test: diagnostic,
			sheet: activeSheet
		}),
		activeSheetIndex: activeSheet.index
	};
};
