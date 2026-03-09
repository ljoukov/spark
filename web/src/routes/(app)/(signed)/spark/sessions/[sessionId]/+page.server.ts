import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { getTutorSession, listTutorSessions } from '$lib/server/tutorSessions/repo';
import { recoverTutorSessionIfStale } from '$lib/server/tutorSessions/recovery';
import { readTutorWorkspaceState } from '$lib/server/tutorSessions/workspace';
import { requireTutorServiceAccountJson } from '$lib/server/tutorSessions/service';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	let session = await getTutorSession(user.uid, params.sessionId);
	if (!session) {
		const fallback = (await listTutorSessions(user.uid, 1))[0] ?? null;
		if (fallback && fallback.id !== params.sessionId) {
			throw redirect(302, `/spark/sessions/${fallback.id}`);
		}
		throw redirect(302, '/spark/sessions');
	}

	let workspace = await readTutorWorkspaceState({
		serviceAccountJson: requireTutorServiceAccountJson(),
		userId: user.uid,
		workspaceId: session.workspaceId,
		session
	});
	const recovered = await recoverTutorSessionIfStale({
		serviceAccountJson: requireTutorServiceAccountJson(),
		userId: user.uid,
		session,
		reviewState: workspace.reviewState
	});
	if (recovered) {
		session = recovered.session;
		workspace = {
			...workspace,
			screenState: recovered.screenState,
			composerState: recovered.composerState,
			reviewState: recovered.reviewState
		};
	}

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
				maxMarks:
					typeof session.source.maxMarks === 'number' ? session.source.maxMarks : null
			},
			createdAt: session.createdAt.toISOString(),
			updatedAt: session.updatedAt.toISOString(),
			error: session.error ?? null
		},
		initialWorkspace: {
			tutorMarkdown: workspace.tutorMarkdown,
			screenState: workspace.screenState,
			composerState: workspace.composerState,
			reviewState: workspace.reviewState,
			context: workspace.context
		}
	};
};
