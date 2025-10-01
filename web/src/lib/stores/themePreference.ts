import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { ThemeMode } from '$lib/utils/theme';

export type ThemePreference = 'auto' | ThemeMode;

const STORAGE_KEY = 'spark-theme-preference';

function readInitialPreference(): ThemePreference {
	if (!browser) {
		return 'auto';
	}
	const stored = window.localStorage.getItem(STORAGE_KEY);
	return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

const preferenceStore = writable<ThemePreference>(readInitialPreference());

if (browser) {
	preferenceStore.subscribe((value) => {
		if (value === 'auto') {
			window.localStorage.removeItem(STORAGE_KEY);
			return;
		}
		window.localStorage.setItem(STORAGE_KEY, value);
	});
}

export const themePreference = {
	subscribe: preferenceStore.subscribe,
	set(value: ThemePreference) {
		preferenceStore.set(value);
	}
};

export function setThemePreference(value: ThemePreference): void {
	preferenceStore.set(value);
}
