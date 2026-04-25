import {
	hasPathwayPersistenceConfig,
	listPathwaysForUser,
	serializePathwaysForClient
} from '$lib/server/pathways/service';
import { listGraderRuns } from '$lib/server/grader/repo';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

function resolvePathwaySheetPhase(options: {
	status: 'created' | 'executing' | 'stopped' | 'failed' | 'done';
	explicitPhase?: 'building' | 'solving' | 'grading' | 'graded';
	hasTotals: boolean;
}): 'building' | 'solving' | 'grading' | 'graded' | null {
	if (options.explicitPhase === 'graded') {
		return 'graded';
	}
	if (options.status === 'done' && options.hasTotals) {
		return 'graded';
	}
	return options.explicitPhase ?? null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	if (!hasPathwayPersistenceConfig()) {
		return {
			pathways: [],
			sheetRuns: {},
			pathwaysAvailable: false,
			loadError: 'Pathways storage is not configured for this environment.'
		};
	}

	try {
		const pathways = await listPathwaysForUser(user.uid);
		const graderRuns = await listGraderRuns(user.uid, 100).catch((error) => {
			console.warn('[pathways] failed to load sheet run status', { error, userId: user.uid });
			return [];
		});
		return {
			pathways: serializePathwaysForClient(pathways),
			sheetRuns: Object.fromEntries(
				graderRuns.map((run) => [
					run.id,
					{
						id: run.id,
						status: run.status,
						sheetPhase: resolvePathwaySheetPhase({
							status: run.status,
							explicitPhase: run.sheetPhase,
							hasTotals: run.totals !== undefined
						}),
						updatedAt: run.updatedAt.toISOString(),
						href: `/spark/sheets/${run.id}`
					}
				])
			),
			pathwaysAvailable: true,
			loadError: null
		};
	} catch (error) {
		console.error('[pathways] failed to load pathways', { error, userId: user.uid });
		return {
			pathways: [],
			sheetRuns: {},
			pathwaysAvailable: true,
			loadError: 'Unable to load saved pathways right now.'
		};
	}
};
