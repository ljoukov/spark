export type PythonRunnerRequest =
	| { type: 'preload'; requestId: string }
	| { type: 'run'; requestId: string; code: string; stdin: string[] };

export type PythonRunnerWorkerMessage =
	| { type: 'status'; status: 'initializing' | 'running'; requestId: string }
	| { type: 'stdout'; text: string; requestId: string }
	| { type: 'stderr'; text: string; requestId: string }
	| { type: 'done'; requestId: string }
	| { type: 'ready'; requestId: string }
	| { type: 'error'; error: string; requestId: string };
