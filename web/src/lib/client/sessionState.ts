import {
	PlanItemStateSchema,
	UserStatsSchema,
	type PlanItemState,
	type SessionState,
	type UserStats
} from '@spark/schemas';
import { browser } from '$app/environment';
import { get, writable, type Readable } from 'svelte/store';
import { z } from 'zod';
import { setUserStats } from './userStats';

export type SessionUpdateResult = {
	stats: UserStats | null;
	xpAwarded: number;
	alreadyCompleted: boolean;
};

export type SessionUpdateOptions = {
	quizCompletion?: {
		quizId: string;
	};
	sync?: boolean;
	markInProgress?: boolean;
};

const responseSchema = z.object({
	status: z.literal('ok'),
	stats: z.unknown().optional(),
	xpAwarded: z.number().int().nonnegative().optional(),
	alreadyCompleted: z.boolean().optional()
});

async function sendSessionUpdate(
	sessionId: string,
	planItemId: string,
	state: PlanItemState,
	options?: SessionUpdateOptions
): Promise<SessionUpdateResult> {
	const response = await fetch(`/api/session/${sessionId}/update`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			planItemId,
			state,
			...(options?.quizCompletion ? { quizCompletion: options.quizCompletion } : {})
		})
	});
	if (!response.ok) {
		let details: unknown = null;
		try {
			details = await response.json();
		} catch {
			details = null;
		}
		const message =
			details && typeof details === 'object' && 'error' in (details as Record<string, unknown>)
				? `Session update failed: ${(details as Record<string, unknown>).error}`
				: `Session update failed with status ${response.status}`;
		throw new Error(message);
	}
	const payload = await response.json();
	const parsed = responseSchema.parse(payload);
	const stats = parsed.stats ? UserStatsSchema.parse(parsed.stats) : null;
	return {
		stats,
		xpAwarded: parsed.xpAwarded ?? 0,
		alreadyCompleted: parsed.alreadyCompleted ?? false
	};
}

export type SessionStateStore = Readable<SessionState> & {
	updateItem: (
		planItemId: string,
		updater: (current: PlanItemState) => PlanItemState,
		options?: SessionUpdateOptions
	) => Promise<SessionUpdateResult | null>;
	markStatus: (
		planItemId: string,
		status: PlanItemState['status'],
		extras?: Partial<Omit<PlanItemState, 'status'>>,
		options?: SessionUpdateOptions
	) => Promise<SessionUpdateResult | null>;
	stop: () => void;
};

export function createSessionStateStore(
	sessionId: string,
	initialState: SessionState
): SessionStateStore {
	const store = writable<SessionState>(initialState);

	if (!browser) {
		return {
			subscribe: store.subscribe,
			updateItem: async () => null,
			markStatus: async () => null,
			stop: () => {}
		};
	}

	async function applyUpdate(
		planItemId: string,
		options: SessionUpdateOptions | undefined,
		mutator: (current: PlanItemState) => PlanItemState
	): Promise<SessionUpdateResult | null> {
		const previous = get(store);
		const existing: PlanItemState = previous.items[planItemId] ?? { status: 'not_started' };
		let nextPlanItem: PlanItemState;
		try {
			nextPlanItem = PlanItemStateSchema.parse(mutator(existing));
		} catch (error) {
			console.error('Invalid plan item state produced by updater', error);
			throw error;
		}

		const optimistic: SessionState = {
			...previous,
			lastUpdatedAt: new Date(),
			items: {
				...previous.items,
				[planItemId]: nextPlanItem
			}
		};
		store.set(optimistic);

		if (options?.sync === false) {
			return null;
		}

		try {
			const result = await sendSessionUpdate(sessionId, planItemId, nextPlanItem, options);
			if (result.stats) {
				setUserStats(result.stats);
			}
			return result;
		} catch (error) {
			console.error('Failed to sync session state', error);
			throw error;
		}
	}

	return {
		subscribe: store.subscribe,
		updateItem: (planItemId, updater, options) => applyUpdate(planItemId, options, updater),
		markStatus: async (planItemId, status, extras, options) =>
			applyUpdate(planItemId, options, (current) => ({
				...current,
				...extras,
				status
			})),
		stop: () => {}
	};
}
