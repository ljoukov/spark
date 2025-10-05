/// <reference lib="webworker" />
import type { PythonRunnerRequest, PythonRunnerWorkerMessage } from './python-runner.types';

type LoadPyodideFn = (typeof import('pyodide'))['loadPyodide'];
type PyodideInterface = Awaited<ReturnType<LoadPyodideFn>>;

const ctx = self as DedicatedWorkerGlobalScope & {
	__PYODIDE_BASE_URL__?: string;
};

const PYODIDE_VERSION = '0.28.3';
const DEFAULT_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const INDEX_URL = ctx.__PYODIDE_BASE_URL__ ?? DEFAULT_INDEX_URL;

let loadPyodideFnPromise: Promise<LoadPyodideFn> | null = null;
let pyodidePromise: Promise<PyodideInterface> | null = null;

const ensureLoadPyodideFn = async (): Promise<LoadPyodideFn> => {
	if (!loadPyodideFnPromise) {
		loadPyodideFnPromise = import(/* @vite-ignore */ `${INDEX_URL}pyodide.mjs`).then(
			(module) => module.loadPyodide as LoadPyodideFn
		);
	}
	return loadPyodideFnPromise;
};

const ensurePyodide = async (): Promise<PyodideInterface> => {
	if (!pyodidePromise) {
		pyodidePromise = ensureLoadPyodideFn().then((loadPyodide) =>
			loadPyodide({ indexURL: INDEX_URL })
		);
	}
	return pyodidePromise;
};

const postMessageToClient = (message: PythonRunnerWorkerMessage) => {
	ctx.postMessage(message);
};

const handlePreloadRequest = async (requestId: string) => {
	postMessageToClient({ type: 'status', status: 'initializing', requestId });

	try {
		await ensurePyodide();
		postMessageToClient({ type: 'status', status: 'running', requestId });
		postMessageToClient({ type: 'ready', requestId });
	} catch (error) {
		const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		postMessageToClient({ type: 'error', error: message, requestId });
	}
};

ctx.addEventListener('message', async (event: MessageEvent<PythonRunnerRequest>) => {
	const payload = event.data;

	if (!payload) {
		return;
	}

	if (payload.type === 'preload') {
		await handlePreloadRequest(payload.requestId);
		return;
	}

	if (payload.type !== 'run') {
		return;
	}

	const { requestId, code, stdin } = payload;

	postMessageToClient({ type: 'status', status: 'initializing', requestId });

	try {
		const pyodide = await ensurePyodide();

		postMessageToClient({ type: 'status', status: 'running', requestId });

		const stdinQueue = [...stdin];

		pyodide.setStdout({
			batched: (text: string) => {
				postMessageToClient({ type: 'stdout', text, requestId });
			}
		});

		pyodide.setStderr({
			batched: (text: string) => {
				postMessageToClient({ type: 'stderr', text, requestId });
			}
		});

		pyodide.setStdin({
			stdin: () => {
				if (stdinQueue.length === 0) {
					return null;
				}
				const nextLine = stdinQueue.shift() ?? '';
				return `${nextLine}\n`;
			}
		});

		await pyodide.runPythonAsync(code);

		postMessageToClient({ type: 'done', requestId });
	} catch (error) {
		const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		postMessageToClient({ type: 'error', error: message, requestId });
	} finally {
		if (pyodidePromise) {
			void pyodidePromise
				.then((instance) => {
					instance.setStdout();
					instance.setStderr();
					instance.setStdin();
				})
				.catch(() => {
					return;
				});
		}
	}
});
