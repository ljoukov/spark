import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(webRoot, '..');
const outputPath = path.join(webRoot, 'src/lib/server/build-info.generated.ts');

function readEnv(...names) {
	for (const name of names) {
		const raw = process.env[name];
		if (typeof raw !== 'string') {
			continue;
		}
		const trimmed = raw.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return null;
}

function readGitValue(args) {
	try {
		const output = execFileSync('git', args, {
			cwd: repoRoot,
			stdio: ['ignore', 'pipe', 'ignore']
		});
		const trimmed = output.toString('utf8').trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

function resolveBuildPlatform() {
	if (readEnv('BUILD_TARGET')) {
		return readEnv('BUILD_TARGET');
	}
	if (readEnv('VERCEL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA')) {
		return 'vercel';
	}
	if (readEnv('CF_PAGES', 'CF_PAGES_COMMIT_SHA', 'CF_PAGES_BRANCH')) {
		return 'cloudflare';
	}
	if (readEnv('GCP_BUILDPACKS', 'BUILD_ID', 'BUILD_GIT_COMMIT_SHA')) {
		return 'gcp';
	}
	return 'local';
}

const buildInfo = {
	buildId: randomUUID(),
	builtAt: new Date().toISOString(),
	platform: resolveBuildPlatform(),
	gitCommitSha: readEnv(
		'BUILD_GIT_COMMIT_SHA',
		'VERCEL_GIT_COMMIT_SHA',
		'CF_PAGES_COMMIT_SHA',
		'COMMIT_SHA'
	) ?? readGitValue(['rev-parse', 'HEAD']),
	gitBranch:
		readEnv('BUILD_GIT_BRANCH', 'VERCEL_GIT_COMMIT_REF', 'CF_PAGES_BRANCH', 'BRANCH_NAME') ??
		readGitValue(['rev-parse', '--abbrev-ref', 'HEAD']),
	providerBuildId: readEnv('BUILD_PROVIDER_BUILD_ID', 'VERCEL_DEPLOYMENT_ID', 'BUILD_ID'),
	providerRevision: readEnv('BUILD_PROVIDER_REVISION', 'K_REVISION'),
	deploymentUrl: readEnv('CF_PAGES_URL', 'VERCEL_URL')
};

const fileContents = `export const embeddedBuildInfo = ${JSON.stringify(buildInfo, null, '\t')} as const;\n`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, fileContents, 'utf8');
