import { describe, expect, it } from 'vitest';
import { BuildInfoSchema, doBuildsMatch } from './buildInfo';

describe('BuildInfoSchema', () => {
	it('accepts embedded build info shape', () => {
		const parsed = BuildInfoSchema.parse({
			buildId: 'build-123',
			builtAt: '2026-03-08T12:00:00.000Z',
			platform: 'gcp',
			gitCommitSha: 'abcdef1234567890',
			gitBranch: 'main',
			providerBuildId: 'provider-build-1',
			providerRevision: 'spark-00001-abc',
			deploymentUrl: null
		});

		expect(parsed.platform).toBe('gcp');
		expect(parsed.gitCommitSha).toBe('abcdef1234567890');
	});
});

describe('doBuildsMatch', () => {
	it('matches exact build ids only', () => {
		const first = BuildInfoSchema.parse({
			buildId: 'same-build',
			builtAt: '2026-03-08T12:00:00.000Z',
			platform: 'vercel',
			gitCommitSha: 'abc123',
			gitBranch: 'main',
			providerBuildId: null,
			providerRevision: null,
			deploymentUrl: null
		});
		const second = BuildInfoSchema.parse({
			buildId: 'same-build',
			builtAt: '2026-03-08T12:05:00.000Z',
			platform: 'vercel',
			gitCommitSha: 'abc123',
			gitBranch: 'main',
			providerBuildId: null,
			providerRevision: null,
			deploymentUrl: null
		});
		const third = BuildInfoSchema.parse({
			buildId: 'different-build',
			builtAt: '2026-03-08T12:05:00.000Z',
			platform: 'vercel',
			gitCommitSha: 'abc123',
			gitBranch: 'main',
			providerBuildId: null,
			providerRevision: null,
			deploymentUrl: null
		});

		expect(doBuildsMatch(first, second)).toBe(true);
		expect(doBuildsMatch(first, third)).toBe(false);
	});
});
