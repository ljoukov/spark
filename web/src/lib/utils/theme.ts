export type ThemeMode = 'light' | 'dark';

/** Applies the selected theme to the root document element. */
export function applyDocumentTheme(mode: ThemeMode): void {
	if (typeof document === 'undefined') {
		return;
	}

	const root = document.documentElement;
	root.dataset.theme = mode;
	root.classList.toggle('dark', mode === 'dark');
}

/**
 * Syncs the root document theme with the user's system preference.
 * Returns a cleanup function that removes the listener.
 */
export function startAutomaticThemeSync(): () => void {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return () => {};
	}

	const media = window.matchMedia('(prefers-color-scheme: dark)');
	const applyFromMedia = (matches: boolean) => applyDocumentTheme(matches ? 'dark' : 'light');

	applyFromMedia(media.matches);

	const handleChange = (event: MediaQueryListEvent) => applyFromMedia(event.matches);
	media.addEventListener('change', handleChange);

	return () => {
		media.removeEventListener('change', handleChange);
	};
}
