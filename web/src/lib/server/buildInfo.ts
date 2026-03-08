import { z } from 'zod';
import { embeddedBuildInfo } from '$lib/server/build-info.generated';
import { env } from '$env/dynamic/private';

export const BuildInfoSchema = z.object({
	buildId: z.string().min(1),
	builtAt: z.string().datetime({ offset: true }),
	platform: z.string().min(1),
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
	gitCommitSha: null,
	gitBranch: null,
	providerBuildId: null,
	providerRevision: null,
	deploymentUrl: null
};

export function getCurrentBuildInfo(): BuildInfo {
	const embeddedOrFallback =
		embeddedBuildInfo.buildId === 'uninitialised-build-info' ? localFallbackBuildInfo : embeddedBuildInfo;
	return BuildInfoSchema.parse({
		...embeddedOrFallback,
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
