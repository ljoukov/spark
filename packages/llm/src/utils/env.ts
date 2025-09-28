import path from 'node:path';

import { config as loadEnv } from 'dotenv';

let envLoaded = false;

export function loadLocalEnv(): void {
	if (envLoaded) {
		return;
	}
	const envPath = path.join(process.cwd(), '.env.local');
	loadEnv({ path: envPath, override: false });
	envLoaded = true;
}
