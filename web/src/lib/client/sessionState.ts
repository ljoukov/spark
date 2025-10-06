import {
	SessionStateSchema,
	PlanItemStateSchema,
	type PlanItemState,
	type SessionState
} from '@spark/schemas';
import { getFirebaseApp } from '$lib/utils/firebaseClient';
import { browser } from '$app/environment';
import { get, writable, type Readable } from 'svelte/store';
import {
	doc,
	getFirestore,
	onSnapshot,
	serverTimestamp,
	setDoc,
	type FirestoreError
} from 'firebase/firestore';

export type SessionStateStore = Readable<SessionState> & {
	updateItem: (
		planItemId: string,
		updater: (current: PlanItemState) => PlanItemState
	) => Promise<void>;
	markStatus: (
		planItemId: string,
		status: PlanItemState['status'],
		extras?: Partial<Omit<PlanItemState, 'status'>>
	) => Promise<void>;
	stop: () => void;
};

function createFallbackState(sessionId: string): SessionState {
	return {
		sessionId,
		items: {},
		lastUpdatedAt: new Date()
	};
}

export function createSessionStateStore(userId: string, sessionId: string): SessionStateStore {
	const store = writable<SessionState>(createFallbackState(sessionId));

	if (!browser) {
		return {
			subscribe: store.subscribe,
			updateItem: async () => {},
			markStatus: async () => {},
			stop: () => {}
		};
	}

	const firestore = getFirestore(getFirebaseApp());
	const documentRef = doc(firestore, 'spark', userId, 'state', sessionId);

	const unsubscribe = onSnapshot(
		documentRef,
		(snapshot) => {
			if (!snapshot.exists()) {
				store.set(createFallbackState(sessionId));
				return;
			}
			try {
				const parsed = SessionStateSchema.parse({
					sessionId,
					...snapshot.data()
				});
				store.set(parsed);
			} catch (error) {
				console.error('Failed to parse session state snapshot', error);
			}
		},
		(error: FirestoreError) => {
			console.error('Session state listener error', error);
		}
	);

	async function persistState(planItemId: string, nextState: PlanItemState): Promise<void> {
		const payload = {
			sessionId,
			lastUpdatedAt: serverTimestamp(),
			[`items.${planItemId}`]: PlanItemStateSchema.parse(nextState)
		};
		await setDoc(documentRef, payload, { merge: true });
	}

	async function updateItem(
		planItemId: string,
		updater: (current: PlanItemState) => PlanItemState
	): Promise<void> {
		const current = get(store);
		const existing: PlanItemState = current.items[planItemId] ?? { status: 'not_started' };
		const next = updater(existing);
		await persistState(planItemId, next);
	}

	async function markStatus(
		planItemId: string,
		status: PlanItemState['status'],
		extras?: Partial<Omit<PlanItemState, 'status'>>
	): Promise<void> {
		await updateItem(planItemId, (current) => ({
			...current,
			...extras,
			status
		}));
	}

	return {
		subscribe: store.subscribe,
		updateItem,
		markStatus,
		stop: unsubscribe
	};
}
