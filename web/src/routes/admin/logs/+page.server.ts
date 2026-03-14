import type { PageServerLoad } from './$types';
import { z } from 'zod';

import {
	listSparkCloudLogs,
	SPARK_CLOUD_LOG_LEVELS,
	SPARK_CLOUD_LOG_SOURCES
} from '$lib/server/gcp/logging';

const sourceFilterSchema = z.enum(['all', ...SPARK_CLOUD_LOG_SOURCES]);
const levelFilterSchema = z.enum(['all', ...SPARK_CLOUD_LOG_LEVELS]);

const querySchema = z
	.object({
		userId: z.string().trim().max(256).optional(),
		agentId: z.string().trim().max(256).optional(),
		workspaceId: z.string().trim().max(256).optional(),
		source: sourceFilterSchema.optional(),
		level: levelFilterSchema.optional(),
		limit: z.string().trim().optional(),
		lookbackHours: z.string().trim().optional()
	})
	.transform(({ userId, agentId, workspaceId, source, level, limit, lookbackHours }) => ({
		userId: userId && userId.length > 0 ? userId : '',
		agentId: agentId && agentId.length > 0 ? agentId : '',
		workspaceId: workspaceId && workspaceId.length > 0 ? workspaceId : '',
		source: source ?? 'all',
		level: level ?? 'all',
		limit:
			limit && limit.length > 0
				? z.coerce.number().int().min(1).max(200).parse(limit)
				: 100,
		lookbackHours:
			lookbackHours && lookbackHours.length > 0
				? z.coerce.number().int().min(1).max(168).parse(lookbackHours)
				: 24
	}));

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}

	return 'Unknown error';
}

export const load: PageServerLoad = async ({ url }) => {
	const query = querySchema.parse({
		userId: url.searchParams.get('userId') ?? undefined,
		agentId: url.searchParams.get('agentId') ?? undefined,
		workspaceId: url.searchParams.get('workspaceId') ?? undefined,
		source: url.searchParams.get('source') ?? undefined,
		level: url.searchParams.get('level') ?? undefined,
		limit: url.searchParams.get('limit') ?? undefined,
		lookbackHours: url.searchParams.get('lookbackHours') ?? undefined
	});

	try {
		return {
			...query,
			logs: await listSparkCloudLogs({
				userId: query.userId || null,
				agentId: query.agentId || null,
				workspaceId: query.workspaceId || null,
				source: query.source === 'all' ? null : query.source,
				level: query.level === 'all' ? null : query.level,
				limit: query.limit,
				lookbackHours: query.lookbackHours
			}),
			logsError: null,
			loadedAt: new Date().toISOString()
		};
	} catch (error) {
		console.error('Failed to load admin logs', { query, error });
		return {
			...query,
			logs: [],
			logsError: getErrorMessage(error),
			loadedAt: new Date().toISOString()
		};
	}
};
