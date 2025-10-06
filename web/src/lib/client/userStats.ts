import type { UserStats } from '@spark/schemas';
import { writable, type Readable } from 'svelte/store';

const statsStore = writable<UserStats | null>(null);

export type UserStatsReadable = Readable<UserStats | null>;

export function initializeUserStats(initial: UserStats | null): UserStatsReadable {
	statsStore.set(initial ?? null);
	return { subscribe: statsStore.subscribe };
}

export function setUserStats(next: UserStats | null): void {
	statsStore.set(next ?? null);
}
