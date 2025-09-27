import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const OFFLINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(OFFLINE_DIR, '../../../../../../');
const REPO_ROOT = path.resolve(WEB_ROOT, '../');
const OUTPUT_DIR = path.join(REPO_ROOT, 'spark-data', 'output');
const REPORT_ROOT = path.join(REPO_ROOT, 'docs', 'reports');
const AUDIT_REPORT_DIR = path.join(REPO_ROOT, 'spark-data', 'report-audit');

let envLoaded = false;

export function ensureOfflineEnv(): void {
	if (envLoaded) {
		return;
	}
	const candidates = [
		path.join(REPO_ROOT, '.env.local'),
		path.join(WEB_ROOT, '.env.local'),
		path.resolve('.env.local')
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			loadEnv({ path: candidate });
			break;
		}
	}
	envLoaded = true;
}

export const OFFLINE_PATHS = {
	offlineDir: OFFLINE_DIR,
	webRoot: WEB_ROOT,
	repoRoot: REPO_ROOT,
	outputDir: OUTPUT_DIR,
	reportRoot: REPORT_ROOT,
	auditReportDir: AUDIT_REPORT_DIR
} as const;
