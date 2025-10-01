import { browser } from '$app/environment';

export type Monaco = typeof import('monaco-editor/esm/vs/editor/editor.api');

let monacoPromise: Promise<Monaco> | null = null;
let stylePromise: Promise<void> | null = null;

async function ensureMonacoStyles(): Promise<void> {
	if (stylePromise) {
		return stylePromise;
	}

	stylePromise = (async () => {
		const { default: styleUrl } = await import('monaco-editor/min/vs/style.css?url');
		if (document.querySelector('link[data-monaco-style="true"]')) {
			return;
		}
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = styleUrl;
		link.dataset.monacoStyle = 'true';
		document.head.appendChild(link);
	})();

	return stylePromise;
}

export async function loadMonaco(): Promise<Monaco | null> {
	if (!browser) {
		return null;
	}

	if (!monacoPromise) {
		monacoPromise = (async () => {
			const [{ default: EditorWorker }, monaco] = await Promise.all([
				import('monaco-editor/esm/vs/editor/editor.worker?worker'),
				import('monaco-editor/esm/vs/editor/editor.api')
			]);

			const globalScope = globalThis as typeof globalThis & {
				MonacoEnvironment?: { getWorker: (moduleId: string, label: string) => Worker };
			};

			if (!globalScope.MonacoEnvironment) {
				globalScope.MonacoEnvironment = {
					getWorker() {
						return new EditorWorker();
					}
				};
			}

			await Promise.all([
				ensureMonacoStyles(),
				import('monaco-editor/esm/vs/basic-languages/python/python.contribution')
			]);

			return monaco;
		})();
	}

	return monacoPromise;
}
