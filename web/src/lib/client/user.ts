import { UserDocSchema, type UserStats } from '@spark/schemas';
import { getFirebaseApp } from '$lib/utils/firebaseClient';
import { browser } from '$app/environment';
import { writable, type Readable } from 'svelte/store';
import { doc, getFirestore, onSnapshot, type FirestoreError } from 'firebase/firestore';

export type UserStatsStore = Readable<UserStats | null> & {
	stop: () => void;
};

export function createUserStatsStore(userId: string): UserStatsStore {
	const store = writable<UserStats | null>(null);

	if (!browser) {
		return {
			subscribe: store.subscribe,
			stop: () => {}
		};
	}

	const firestore = getFirestore(getFirebaseApp());
	const documentRef = doc(firestore, 'spark', userId);

	const unsubscribe = onSnapshot(
		documentRef,
		(snapshot) => {
			if (!snapshot.exists()) {
				store.set(null);
				return;
			}
			try {
				const parsed = UserDocSchema.parse(snapshot.data());
				store.set(parsed.stats);
			} catch (error) {
				console.error('Failed to parse user document for stats', error);
			}
		},
		(error: FirestoreError) => {
			console.error('User stats listener error', error);
		}
	);

	return {
		subscribe: store.subscribe,
		stop: unsubscribe
	};
}
