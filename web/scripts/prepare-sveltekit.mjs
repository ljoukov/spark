import { spawnSync } from 'node:child_process';

const result = spawnSync('svelte-kit', ['sync'], {
	stdio: 'inherit',
	shell: process.platform === 'win32'
});

if (result.error?.code === 'ENOENT') {
	console.log(
		'Skipping svelte-kit sync: dependencies are not installed. Run `bun install` from the repo root.'
	);
	process.exit(0);
}

if (result.error) {
	throw result.error;
}

if (result.signal !== null) {
	console.error(`svelte-kit sync terminated by ${result.signal}`);
	process.exit(1);
}

process.exit(result.status ?? 1);
