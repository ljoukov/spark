import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { listTutorSessions } from '$lib/server/tutorSessions/repo';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const sessions = await listTutorSessions(user.uid, 100);
	return {
		sessions: sessions.map((session) => ({
			id: session.id,
			title: session.title,
			preview: session.preview ?? null,
			status: session.status,
			focusLabel: session.focusLabel ?? null,
			source: {
				kind: session.source.kind,
				runId: session.source.runId,
				problemId: session.source.problemId,
				problemIndex: session.source.problemIndex,
				problemTitle: session.source.problemTitle,
				verdict: session.source.verdict ?? null,
				awardedMarks:
					typeof session.source.awardedMarks === 'number' ? session.source.awardedMarks : null,
				maxMarks: typeof session.source.maxMarks === 'number' ? session.source.maxMarks : null
			},
			createdAt: session.createdAt.toISOString(),
			updatedAt: session.updatedAt.toISOString(),
			completedAt: session.completedAt ? session.completedAt.toISOString() : null,
			error: session.error ?? null
		}))
	};
};
