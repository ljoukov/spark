import { deriveLessonStatus, countCompletedSteps } from '$lib/server/lessons/status';
import { getSession } from '$lib/server/session/repo';
import { getSessionState } from '$lib/server/sessionState/repo';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required'),
	sessionId: z.string().trim().min(1, 'sessionId is required')
});

function instantOrNull(value: Date | undefined): Date | null {
	if (!value) {
		return null;
	}
	if (value.getTime() <= 0) {
		return null;
	}
	return value;
}

function toIso(value: Date | undefined | null): string | null {
	if (!value) {
		return null;
	}
	return value.toISOString();
}

export const load: PageServerLoad = async ({ params }) => {
	const { userId, sessionId } = paramsSchema.parse(params);

	const session = await getSession(userId, sessionId).catch((error) => {
		console.error('Failed to load session', { userId, sessionId, error });
		return null;
	});
	const state = await getSessionState(userId, sessionId).catch((error) => {
		console.error('Failed to load session state', { userId, sessionId, error });
		return null;
	});

	const resolvedState = state ?? { sessionId, items: {}, lastUpdatedAt: new Date(0) };
	const derivedStatus = session ? deriveLessonStatus(session, resolvedState) : null;
	const completion = session ? countCompletedSteps(session, resolvedState) : { completed: 0, total: 0 };
	const lastProgressAt = instantOrNull(resolvedState.lastUpdatedAt);

	const planItems = (session?.plan ?? []).map((item) => {
		const itemState = resolvedState.items[item.id];
		const status = itemState?.status ?? 'not_started';
		return {
			id: item.id,
			kind: item.kind,
			title: item.title,
			summary: item.summary ?? null,
			description: item.description ?? null,
			icon: item.icon ?? null,
			meta: item.meta ?? null,
			state: {
				status,
				startedAt: toIso(instantOrNull(itemState?.startedAt)),
				completedAt: toIso(instantOrNull(itemState?.completedAt))
			}
		};
	});

	return {
		userId,
		sessionId,
		sessionDocFound: Boolean(session),
		session: session
			? {
					id: session.id,
					title: session.title,
					emoji: session.emoji ?? '📘',
					status: derivedStatus ?? session.status ?? 'ready',
					createdAt: toIso(session.createdAt),
					summary: session.summary ?? null,
					tagline: session.tagline ?? null,
					topics: session.topics ?? []
				}
			: {
					id: sessionId,
					title: sessionId,
					emoji: '📘',
					status: 'ready',
					createdAt: null,
					summary: null,
					tagline: null,
					topics: []
				},
		completion,
		lastProgressAt: toIso(lastProgressAt),
		planItems
	};
};
