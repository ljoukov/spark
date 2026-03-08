import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { getTutorSession } from '$lib/server/tutorSessions/repo';
import { readTutorWorkspaceState } from '$lib/server/tutorSessions/workspace';
import { requireTutorServiceAccountJson } from '$lib/server/tutorSessions/service';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const session = await getTutorSession(user.uid, params.sessionId);
	if (!session) {
		throw error(404, 'Tutor session not found');
	}

	const workspace = await readTutorWorkspaceState({
		serviceAccountJson: requireTutorServiceAccountJson(),
		userId: user.uid,
		workspaceId: session.workspaceId,
		session
	});

	return {
		session: {
			id: session.id,
			workspaceId: session.workspaceId,
			title: session.title,
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
			latestDraftRevision: session.latestDraftRevision ?? 0,
			error: session.error ?? null
		},
		initialWorkspace: {
			tutorMarkdown: workspace.tutorMarkdown,
			inlineFeedbackMarkdown: workspace.inlineFeedbackMarkdown,
			screenState: workspace.screenState,
			composerState: workspace.composerState,
			context: workspace.context
		}
	};
};
