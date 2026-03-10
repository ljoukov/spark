import { z } from 'zod';
import { embeddedBuildInfo } from '$lib/server/build-info.generated';
import { env } from '$env/dynamic/private';

export const BuildInfoSchema = z.object({
	buildId: z.string().min(1),
	builtAt: z.iso.datetime({ offset: true }),
	platform: z.string().min(1),
	runtime: z.string().min(1),
	runtimeVersion: z.string().min(1).nullable(),
	gitCommitSha: z.string().min(1).nullable(),
	gitBranch: z.string().min(1).nullable(),
	providerBuildId: z.string().min(1).nullable(),
	providerRevision: z.string().min(1).nullable(),
	deploymentUrl: z.string().min(1).nullable()
});

export type BuildInfo = z.infer<typeof BuildInfoSchema>;

export const TaskServiceInfoResponseSchema = z.object({
	build: BuildInfoSchema
});

export type TaskServiceInfoResponse = z.infer<typeof TaskServiceInfoResponseSchema>;

const localFallbackBuildInfo: BuildInfo = {
	buildId: 'local-dev',
	builtAt: new Date().toISOString(),
	platform: 'local',
	runtime: 'bun',
	runtimeVersion: null,
	gitCommitSha: null,
	gitBranch: null,
	providerBuildId: null,
	providerRevision: null,
	deploymentUrl: null
};

function readTrimmed(value: string | undefined): string | null {
	if (!value) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function resolveRuntimeOverride(): { runtime: string | null; runtimeVersion: string | null } {
	const maybeBun = globalThis as typeof globalThis & { Bun?: { version?: string } };
	const bunVersion = readTrimmed(maybeBun.Bun?.version);
	if (bunVersion) {
		return {
			runtime: 'bun',
			runtimeVersion: bunVersion
		};
	}

	const nodeVersion =
		typeof process !== 'undefined' ? readTrimmed(process.versions?.node) : null;
	if (nodeVersion) {
		return {
			runtime: 'node',
			runtimeVersion: nodeVersion
		};
	}

	const cloudflareCompatibilityDate =
		readTrimmed(env.COMPATIBILITY_DATE) ?? readTrimmed(env.CF_PAGES_COMPATIBILITY_DATE);
	if (
		readTrimmed(env.CF_PAGES) ||
		readTrimmed(env.CF_PAGES_URL) ||
		readTrimmed(env.CF_PAGES_BRANCH)
	) {
		return {
			runtime: 'cloudflare-worker',
			runtimeVersion: cloudflareCompatibilityDate
		};
	}

	return {
		runtime: null,
		runtimeVersion: null
	};
}

export function getCurrentBuildInfo(): BuildInfo {
	const embeddedInfo = embeddedBuildInfo as BuildInfo;
	const embeddedOrFallback =
		embeddedInfo.buildId === 'uninitialised-build-info' ? localFallbackBuildInfo : embeddedInfo;
	const runtimeOverride = resolveRuntimeOverride();
	return BuildInfoSchema.parse({
		...embeddedOrFallback,
		runtime: runtimeOverride.runtime ?? embeddedOrFallback.runtime,
		runtimeVersion: runtimeOverride.runtimeVersion ?? embeddedOrFallback.runtimeVersion,
		providerBuildId:
			env.BUILD_PROVIDER_BUILD_ID?.trim() ||
			env.VERCEL_DEPLOYMENT_ID?.trim() ||
			embeddedOrFallback.providerBuildId,
		providerRevision:
			env.K_REVISION?.trim() || env.BUILD_PROVIDER_REVISION?.trim() || embeddedOrFallback.providerRevision,
		deploymentUrl:
			env.CF_PAGES_URL?.trim() || env.VERCEL_URL?.trim() || embeddedOrFallback.deploymentUrl
	});
}

export function doBuildsMatch(left: BuildInfo, right: BuildInfo): boolean {
	return left.buildId === right.buildId;
}
