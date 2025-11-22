import type { Session, SessionState, SessionStatus } from '@spark/schemas';

export function deriveLessonStatus(session: Session, state: SessionState | null): SessionStatus {
	const storedStatus = session.status ?? 'ready';
	if (storedStatus === 'generating' || storedStatus === 'error') {
		return storedStatus;
	}
	const planItems = session.plan ?? [];
	if (planItems.length === 0) {
		return storedStatus;
	}
	const planStatuses = planItems.map((item) => state?.items[item.id]?.status ?? 'not_started');
	const allCompleted =
		planStatuses.length > 0 && planStatuses.every((status) => status === 'completed');
	if (allCompleted) {
		return 'completed';
	}
	const hasProgress = planStatuses.some((status) => status !== 'not_started');
	if (hasProgress) {
		return 'in_progress';
	}
	return 'ready';
}

export function countCompletedSteps(
	session: Session,
	state: SessionState | null
): { completed: number; total: number } {
	const planItems = session.plan ?? [];
	const total = planItems.length;
	let completed = 0;
	for (const item of planItems) {
		if (state?.items[item.id]?.status === 'completed') {
			completed += 1;
		}
	}
	return { completed, total };
}
