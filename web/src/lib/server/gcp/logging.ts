import { z } from 'zod';

import { env } from '$env/dynamic/private';
import { getCurrentBuildInfo } from '$lib/server/buildInfo';
import { getGoogleAccessToken, parseGoogleServiceAccountJson } from './googleAccessToken';

const CLOUD_LOGGING_WRITE_SCOPE = 'https://www.googleapis.com/auth/logging.write';
const CLOUD_LOGGING_READ_SCOPE = 'https://www.googleapis.com/auth/cloud-platform.read-only';
const CLOUD_LOGGING_WRITE_URL = 'https://logging.googleapis.com/v2/entries:write';
const CLOUD_LOGGING_LIST_URL = 'https://logging.googleapis.com/v2/entries:list';
const DEFAULT_CLOUD_RUN_SERVICE_NAME = 'spark';
const DEFAULT_CLOUD_TASKS_QUEUE_ID = 'spark-tasks';

export const SPARK_WEB_LOG_ID = 'spark-web';
export const SPARK_WEB_LOG_NAME = (projectId: string) => `projects/${projectId}/logs/${SPARK_WEB_LOG_ID}`;
export const SPARK_CLOUD_LOG_SOURCES = [
	'web',
	'cloud-run',
	'cloud-run-request',
	'cloud-run-stdout',
	'cloud-run-stderr',
	'tasks-queue'
] as const;
export type SparkCloudLogSource = (typeof SPARK_CLOUD_LOG_SOURCES)[number];
export const SPARK_CLOUD_LOG_LEVELS = ['DEFAULT', 'INFO', 'WARNING', 'ERROR'] as const;
export type SparkCloudLogLevel = (typeof SPARK_CLOUD_LOG_LEVELS)[number];
const CLOUD_RUN_REQUEST_LOG_NAME = (projectId: string) =>
	`projects/${projectId}/logs/run.googleapis.com%2Frequests`;
const CLOUD_RUN_STDOUT_LOG_NAME = (projectId: string) =>
	`projects/${projectId}/logs/run.googleapis.com%2Fstdout`;
const CLOUD_RUN_STDERR_LOG_NAME = (projectId: string) =>
	`projects/${projectId}/logs/run.googleapis.com%2Fstderr`;
const CLOUD_TASKS_OPERATIONS_LOG_NAME = (projectId: string) =>
	`projects/${projectId}/logs/cloudtasks.googleapis.com%2Ftask_operations_log`;

type ConsoleMethodName = 'log' | 'warn' | 'error';
type ConsoleLevel = 'info' | 'warn' | 'error';
type CloudLogSeverity = 'INFO' | 'WARNING' | 'ERROR';

type SparkIdentifierLabels = {
	userId?: string;
	agentId?: string;
	workspaceId?: string;
};

type CloudLogPlatformMetadata = {
	platform: string;
	runtime: string;
	runtimeVersion: string | null;
	deploymentUrl: string | null;
	providerBuildId: string | null;
	providerRevision: string | null;
	localHost: string | null;
	localPort: string | null;
	localIp: string | null;
};

type ConsoleLogPayload = {
	message: string;
	args: unknown[];
	labels: SparkIdentifierLabels;
};

type PendingWriteEntry = {
	logName: string;
	resource: {
		type: 'global';
		labels: {
			project_id: string;
		};
	};
	severity: CloudLogSeverity;
	timestamp: string;
	labels: Record<string, string>;
	jsonPayload: Record<string, unknown>;
};

export type SparkCloudLogEntry = {
	insertId: string | null;
	timestamp: string;
	severity: string;
	source: string;
	logName: string;
	message: string;
	requestUrl: string | null;
	httpStatus: number | null;
	userId: string | null;
	agentId: string | null;
	workspaceId: string | null;
	labels: Record<string, string>;
	resourceType: string;
	raw: Record<string, unknown>;
};

const loggingConfigSchema = z.object({
	serviceAccountJson: z.string().trim().min(1),
	projectId: z.string().trim().min(1),
	writeDisabled: z.boolean(),
	mirrorConsole: z.boolean(),
	cloudRunServiceName: z.string().trim().min(1),
	cloudTasksQueueId: z.string().trim().min(1)
});

const loggingEntrySchema = z
	.object({
		insertId: z.string().optional(),
		logName: z.string().optional(),
		timestamp: z.string().optional(),
		severity: z.string().optional(),
		textPayload: z.string().optional(),
		jsonPayload: z.record(z.string(), z.unknown()).optional(),
		httpRequest: z
			.object({
				requestMethod: z.string().optional(),
				requestUrl: z.string().optional(),
				status: z.union([z.number(), z.string()]).optional(),
				latency: z.string().optional()
			})
			.optional(),
		resource: z
			.object({
				type: z.string(),
				labels: z.record(z.string(), z.string()).optional()
			})
			.optional(),
		labels: z.record(z.string(), z.string()).optional()
	})
	.loose();

const listEntriesResponseSchema = z.object({
	entries: z.array(loggingEntrySchema).optional(),
	nextPageToken: z.string().optional()
});

const originalConsole = {
	log: console.log.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console)
} satisfies Record<ConsoleMethodName, (...args: unknown[]) => void>;

let consoleLoggingInstalled = false;
const pendingWrites: PendingWriteEntry[] = [];
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;
const pendingEntryTasks = new Set<Promise<void>>();
let localNetworkMetadataPromise: Promise<{ localHost: string | null; localIp: string | null }> | null =
	null;

export type SparkCloudLogWriteOptions = {
	severity?: CloudLogSeverity;
	message: string;
	source: string;
	labels?: SparkIdentifierLabels;
	jsonPayload?: Record<string, unknown>;
};

function parseBooleanFlag(value: string | undefined): boolean {
	if (!value) {
		return false;
	}

	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isNodeRuntime(): boolean {
	return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

async function resolveLocalNetworkMetadata(): Promise<{
	localHost: string | null;
	localIp: string | null;
}> {
	if (localNetworkMetadataPromise) {
		return await localNetworkMetadataPromise;
	}

	localNetworkMetadataPromise = (async () => {
		if (!isNodeRuntime()) {
			return { localHost: null, localIp: null };
		}

		const hostname =
			typeof process !== 'undefined' && typeof process.env.HOSTNAME === 'string'
				? process.env.HOSTNAME.trim() || null
				: null;

		try {
			const os = await import('node:os');
			const networkInterfaces = os.networkInterfaces();
			for (const addresses of Object.values(networkInterfaces)) {
				for (const address of addresses ?? []) {
					if (!address || address.internal || address.family !== 'IPv4') {
						continue;
					}
					return {
						localHost: hostname,
						localIp: address.address
					};
				}
			}
		} catch {
			return { localHost: hostname, localIp: null };
		}

		return { localHost: hostname, localIp: null };
	})();

	return await localNetworkMetadataPromise;
}

async function resolvePlatformMetadata(): Promise<CloudLogPlatformMetadata> {
	const buildInfo = getCurrentBuildInfo();
	const port = env.VITE_DEV_PORT?.trim() || env.PORT?.trim() || null;
	if (buildInfo.platform !== 'local') {
		return {
			platform: buildInfo.platform,
			runtime: buildInfo.runtime,
			runtimeVersion: buildInfo.runtimeVersion,
			deploymentUrl: buildInfo.deploymentUrl,
			providerBuildId: buildInfo.providerBuildId,
			providerRevision: buildInfo.providerRevision,
			localHost: null,
			localPort: null,
			localIp: null
		};
	}

	const localHostFromEnv = env.VITE_DEV_AUTH_HOST?.trim() || env.HOST?.trim() || null;
	const network = await resolveLocalNetworkMetadata();
	return {
		platform: buildInfo.platform,
		runtime: buildInfo.runtime,
		runtimeVersion: buildInfo.runtimeVersion,
		deploymentUrl: buildInfo.deploymentUrl,
		providerBuildId: buildInfo.providerBuildId,
		providerRevision: buildInfo.providerRevision,
		localHost: localHostFromEnv ?? network.localHost,
		localPort: port,
		localIp: network.localIp
	};
}

function readLoggingConfig(): z.infer<typeof loggingConfigSchema> | null {
	const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? '';
	if (!serviceAccountJson) {
		return null;
	}

	const disabled =
		parseBooleanFlag(env.DISABLE_CLOUD_LOGGING) ||
		parseBooleanFlag(env.CLOUD_LOGGING_DISABLED) ||
		parseBooleanFlag(env.SPARK_DISABLE_CLOUD_LOGGING);

	const projectId = parseGoogleServiceAccountJson(serviceAccountJson).projectId;
	return loggingConfigSchema.parse({
		serviceAccountJson,
		projectId,
		writeDisabled: disabled,
		mirrorConsole: !disabled,
		cloudRunServiceName:
			env.TASKS_CLOUD_RUN_SERVICE_NAME?.trim() ||
			env.K_SERVICE?.trim() ||
			DEFAULT_CLOUD_RUN_SERVICE_NAME,
		cloudTasksQueueId: env.TASKS_QUEUE?.trim() || DEFAULT_CLOUD_TASKS_QUEUE_ID
	});
}

function normaliseError(error: Error): Record<string, unknown> {
	const next: Record<string, unknown> = {
		name: error.name,
		message: error.message
	};
	if (error.stack) {
		next.stack = error.stack;
	}
	const cause = (error as Error & { cause?: unknown }).cause;
	if (cause !== undefined) {
		next.cause = normaliseForJson(cause, 1, new WeakSet());
	}
	return next;
}

function normaliseForJson(
	value: unknown,
	depth: number,
	seen: WeakSet<object>
): unknown {
	if (value === null || value === undefined) {
		return value ?? null;
	}
	if (typeof value === 'string' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : String(value);
	}
	if (typeof value === 'bigint') {
		return value.toString();
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (value instanceof URL) {
		return value.toString();
	}
	if (value instanceof Error) {
		return normaliseError(value);
	}
	if (depth >= 4) {
		return '[MaxDepth]';
	}
	if (Array.isArray(value)) {
		return value.slice(0, 50).map((entry) => normaliseForJson(entry, depth + 1, seen));
	}
	if (typeof value === 'object') {
		if (seen.has(value)) {
			return '[Circular]';
		}
		seen.add(value);
		const result: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value).slice(0, 50)) {
			result[key] = normaliseForJson(entry, depth + 1, seen);
		}
		return result;
	}
	return String(value);
}

function truncateText(value: string, maxLength = 4000): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, maxLength - 1)}…`;
}

function stringifyForMessage(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (value instanceof Error) {
		return `${value.name}: ${value.message}`;
	}
	const normalised = normaliseForJson(value, 0, new WeakSet());
	try {
		return truncateText(JSON.stringify(normalised));
	} catch {
		return String(value);
	}
}

function extractIdentifiersFromString(
	value: string,
	labels: SparkIdentifierLabels
): void {
	if (!labels.agentId) {
		const agentMatch = /\[spark-agent:([0-9a-f-]{36})\]/i.exec(value);
		if (agentMatch?.[1]) {
			labels.agentId = agentMatch[1];
		}
	}
	if (!labels.userId) {
		const userMatch = /(?:^|[?&\s])userId=([A-Za-z0-9._-]{6,})/i.exec(value);
		if (userMatch?.[1]) {
			labels.userId = userMatch[1];
		}
	}
	if (!labels.agentId) {
		const agentParamMatch = /(?:^|[?&\s])agentId=([A-Za-z0-9-]{8,})/i.exec(value);
		if (agentParamMatch?.[1]) {
			labels.agentId = agentParamMatch[1];
		}
	}
	if (!labels.workspaceId) {
		const workspaceMatch = /(?:^|[?&\s])workspaceId=([A-Za-z0-9-]{8,})/i.exec(value);
		if (workspaceMatch?.[1]) {
			labels.workspaceId = workspaceMatch[1];
		}
	}
}

function extractIdentifiers(
	value: unknown,
	labels: SparkIdentifierLabels,
	seen: WeakSet<object>
): void {
	if (value === null || value === undefined) {
		return;
	}
	if (typeof value === 'string') {
		extractIdentifiersFromString(value, labels);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			extractIdentifiers(entry, labels, seen);
		}
		return;
	}
	if (typeof value !== 'object') {
		return;
	}
	if (seen.has(value)) {
		return;
	}
	seen.add(value);
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === 'string') {
			if (key === 'userId' && !labels.userId) {
				labels.userId = entry;
			}
			if (key === 'agentId' && !labels.agentId) {
				labels.agentId = entry;
			}
			if (key === 'workspaceId' && !labels.workspaceId) {
				labels.workspaceId = entry;
			}
		}
		extractIdentifiers(entry, labels, seen);
	}
}

function buildConsolePayload(args: unknown[]): ConsoleLogPayload {
	const labels: SparkIdentifierLabels = {};
	const seen = new WeakSet<object>();
	for (const arg of args) {
		extractIdentifiers(arg, labels, seen);
	}
	const message = truncateText(args.map((arg) => stringifyForMessage(arg)).join(' '), 8000);
	const normalisedArgs = args.map((arg) => normaliseForJson(arg, 0, new WeakSet()));
	return {
		message,
		args: normalisedArgs,
		labels
	};
}

function levelToSeverity(level: ConsoleLevel): CloudLogSeverity {
	switch (level) {
		case 'warn':
			return 'WARNING';
		case 'error':
			return 'ERROR';
		case 'info':
			return 'INFO';
	}
}

function buildEntryLabels(
	level: ConsoleLevel,
	platform: CloudLogPlatformMetadata,
	labels: SparkIdentifierLabels
): Record<string, string> {
	const next: Record<string, string> = {
		spark_source: 'web-console',
		spark_level: level,
		spark_platform: platform.platform
	};
	if (labels.userId) {
		next.spark_user_id = labels.userId;
	}
	if (labels.agentId) {
		next.spark_agent_id = labels.agentId;
	}
	if (labels.workspaceId) {
		next.spark_workspace_id = labels.workspaceId;
	}
	return next;
}

async function createPendingWriteEntry(
	level: ConsoleLevel,
	args: unknown[]
): Promise<PendingWriteEntry | null> {
	const config = readLoggingConfig();
	if (!config || config.writeDisabled || !config.mirrorConsole) {
		return null;
	}

	const payload = buildConsolePayload(args);
	const platform = await resolvePlatformMetadata();
	return {
		logName: SPARK_WEB_LOG_NAME(config.projectId),
		resource: {
			type: 'global',
			labels: {
				project_id: config.projectId
			}
		},
		severity: levelToSeverity(level),
		timestamp: new Date().toISOString(),
		labels: buildEntryLabels(level, platform, payload.labels),
		jsonPayload: {
			source: 'spark-web',
			logger: 'console',
			level,
			message: payload.message,
			args: payload.args,
			userId: payload.labels.userId ?? null,
			agentId: payload.labels.agentId ?? null,
			workspaceId: payload.labels.workspaceId ?? null,
			platform
		}
	};
}

async function createStructuredWriteEntry(
	options: SparkCloudLogWriteOptions
): Promise<PendingWriteEntry | null> {
	const config = readLoggingConfig();
	if (!config || config.writeDisabled) {
		return null;
	}

	const platform = await resolvePlatformMetadata();
	const labels = options.labels ?? {};
	return {
		logName: SPARK_WEB_LOG_NAME(config.projectId),
		resource: {
			type: 'global',
			labels: {
				project_id: config.projectId
			}
		},
		severity: options.severity ?? 'INFO',
		timestamp: new Date().toISOString(),
		labels: buildEntryLabels('info', platform, labels),
		jsonPayload: {
			source: options.source,
			message: options.message,
			userId: labels.userId ?? null,
			agentId: labels.agentId ?? null,
			workspaceId: labels.workspaceId ?? null,
			platform,
			...(options.jsonPayload ?? {})
		}
	};
}

function scheduleFlush(delayMs: number): void {
	if (pendingFlushTimer) {
		return;
	}
	pendingFlushTimer = setTimeout(() => {
		pendingFlushTimer = null;
		void flushPendingCloudLogWrites();
	}, delayMs);
}

async function writeEntriesBatch(entries: PendingWriteEntry[]): Promise<void> {
	const config = readLoggingConfig();
	if (!config || config.writeDisabled) {
		return;
	}

	const { accessToken } = await getGoogleAccessToken({
		serviceAccountJson: config.serviceAccountJson,
		scopes: [CLOUD_LOGGING_WRITE_SCOPE]
	});

	const response = await fetch(CLOUD_LOGGING_WRITE_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			partialSuccess: true,
			entries
		})
	}).catch(() => null);

	if (!response) {
		originalConsole.warn('[cloud-logging] write failed with a network error');
		return;
	}
	if (!response.ok) {
		const text = await response.text().catch(() => '');
		originalConsole.warn('[cloud-logging] write failed', {
			status: response.status,
			body: text.slice(0, 500)
		});
	}
}

async function waitForPendingEntryTasks(): Promise<void> {
	while (pendingEntryTasks.size > 0) {
		await Promise.allSettled(Array.from(pendingEntryTasks));
	}
}

export async function flushPendingCloudLogWrites(): Promise<void> {
	if (pendingFlushTimer) {
		clearTimeout(pendingFlushTimer);
		pendingFlushTimer = null;
	}
	await waitForPendingEntryTasks();
	if (flushPromise) {
		return await flushPromise;
	}
	if (pendingWrites.length === 0) {
		return;
	}

	const batch = pendingWrites.splice(0, 50);
	flushPromise = writeEntriesBatch(batch).finally(() => {
		flushPromise = null;
		if (pendingWrites.length > 0) {
			scheduleFlush(0);
		}
	});
	await flushPromise;
}

function enqueuePendingWrite(entry: PendingWriteEntry): void {
	pendingWrites.push(entry);
	if (pendingWrites.length >= 20) {
		scheduleFlush(0);
		return;
	}
	scheduleFlush(250);
}

function trackPendingEntryTask(task: Promise<void>): void {
	pendingEntryTasks.add(task);
	void task.finally(() => {
		pendingEntryTasks.delete(task);
	});
}

export function installServerConsoleCloudLogging(): void {
	if (consoleLoggingInstalled) {
		return;
	}
	consoleLoggingInstalled = true;

	const mappings: Array<{ method: ConsoleMethodName; level: ConsoleLevel }> = [
		{ method: 'log', level: 'info' },
		{ method: 'warn', level: 'warn' },
		{ method: 'error', level: 'error' }
	];

	for (const { method, level } of mappings) {
		console[method] = (...args: unknown[]) => {
			originalConsole[method](...args);
			const task = createPendingWriteEntry(level, args).then((entry) => {
				if (entry) {
					enqueuePendingWrite(entry);
				}
			});
			trackPendingEntryTask(task);
		};
	}
}

export function writeSparkCloudLog(options: SparkCloudLogWriteOptions): void {
	const task = createStructuredWriteEntry(options).then((entry) => {
		if (entry) {
			enqueuePendingWrite(entry);
		}
	});
	trackPendingEntryTask(task);
}

function escapeFilterString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function makeEqualsFilter(field: string, value: string): string {
	return `${field}="${escapeFilterString(value)}"`;
}

function makeContainsFilter(field: string, value: string): string {
	return `${field}:"${escapeFilterString(value)}"`;
}

function buildCustomWebLogClause(labels: {
	userId?: string | null;
	agentId?: string | null;
	workspaceId?: string | null;
	projectId: string;
}): string {
	const clauses: string[] = [makeEqualsFilter('logName', SPARK_WEB_LOG_NAME(labels.projectId))];
	if (labels.userId) {
		clauses.push(makeEqualsFilter('labels.spark_user_id', labels.userId));
	}
	if (labels.agentId) {
		clauses.push(makeEqualsFilter('labels.spark_agent_id', labels.agentId));
	}
	if (labels.workspaceId) {
		clauses.push(makeEqualsFilter('labels.spark_workspace_id', labels.workspaceId));
	}
	return `(${clauses.join(' AND ')})`;
}

function buildCloudRunTextFilters(filters: {
	userId?: string | null;
	agentId?: string | null;
	workspaceId?: string | null;
}): string[] {
	const textFilters: string[] = [];
	if (filters.agentId) {
		textFilters.push(
			`(${makeContainsFilter('textPayload', `[spark-agent:${filters.agentId}]`)} OR ${makeContainsFilter('textPayload', `agentId=${filters.agentId}`)})`
		);
	} else if (filters.workspaceId) {
		textFilters.push(makeContainsFilter('textPayload', `workspaceId=${filters.workspaceId}`));
	} else if (filters.userId) {
		textFilters.push(makeContainsFilter('textPayload', `userId=${filters.userId}`));
	}
	return textFilters;
}

function buildCloudRunStreamClause(filters: {
	userId?: string | null;
	agentId?: string | null;
	workspaceId?: string | null;
	projectId: string;
	cloudRunServiceName: string;
	logName: string;
}): string {
	const textFilters = buildCloudRunTextFilters(filters);
	return `(${makeEqualsFilter('resource.type', 'cloud_run_revision')} AND ${makeEqualsFilter(
		'resource.labels.service_name',
		filters.cloudRunServiceName
	)} AND ${makeEqualsFilter('logName', filters.logName)}${textFilters.length > 0 ? ` AND ${textFilters.join(' AND ')}` : ''})`;
}

function buildCloudRunTextClause(filters: {
	userId?: string | null;
	agentId?: string | null;
	workspaceId?: string | null;
	projectId: string;
	cloudRunServiceName: string;
}): string {
	return `(${buildCloudRunStreamClause({
		...filters,
		logName: CLOUD_RUN_STDOUT_LOG_NAME(filters.projectId)
	})} OR ${buildCloudRunStreamClause({
		...filters,
		logName: CLOUD_RUN_STDERR_LOG_NAME(filters.projectId)
	})})`;
}

function buildCloudRunRequestClause(filters: {
	userId?: string | null;
	agentId?: string | null;
	workspaceId?: string | null;
	projectId: string;
	cloudRunServiceName: string;
}): string {
	const clauses: string[] = [
		makeEqualsFilter('resource.type', 'cloud_run_revision'),
		makeEqualsFilter('resource.labels.service_name', filters.cloudRunServiceName),
		makeEqualsFilter('logName', CLOUD_RUN_REQUEST_LOG_NAME(filters.projectId))
	];
	if (filters.userId) {
		clauses.push(makeContainsFilter('httpRequest.requestUrl', `userId=${filters.userId}`));
	}
	if (filters.agentId) {
		clauses.push(makeContainsFilter('httpRequest.requestUrl', `agentId=${filters.agentId}`));
	}
	if (filters.workspaceId) {
		clauses.push(
			makeContainsFilter('httpRequest.requestUrl', `workspaceId=${filters.workspaceId}`)
		);
	}
	return `(${clauses.join(' AND ')})`;
}

function buildCloudTasksClause(filters: {
	userId?: string | null;
	agentId?: string | null;
	workspaceId?: string | null;
	projectId: string;
	cloudTasksQueueId: string;
}): string {
	const clauses: string[] = [
		makeEqualsFilter('logName', CLOUD_TASKS_OPERATIONS_LOG_NAME(filters.projectId)),
		makeEqualsFilter('resource.type', 'cloud_tasks_queue'),
		makeEqualsFilter('resource.labels.queue_id', filters.cloudTasksQueueId)
	];
	if (filters.userId) {
		clauses.push(
			makeContainsFilter('jsonPayload.attemptResponseLog.targetAddress', `userId=${filters.userId}`)
		);
	}
	if (filters.agentId) {
		clauses.push(
			makeContainsFilter(
				'jsonPayload.attemptResponseLog.targetAddress',
				`agentId=${filters.agentId}`
			)
		);
	}
	if (filters.workspaceId) {
		clauses.push(
			makeContainsFilter(
				'jsonPayload.attemptResponseLog.targetAddress',
				`workspaceId=${filters.workspaceId}`
			)
		);
	}
	return `(${clauses.join(' AND ')})`;
}

function buildCombinedFilter(options: {
	userId?: string | null;
	agentId?: string | null;
	workspaceId?: string | null;
	since: Date;
	projectId: string;
	cloudRunServiceName: string;
	cloudTasksQueueId: string;
	source?: SparkCloudLogSource | null;
	level?: SparkCloudLogLevel | null;
}): string {
	const filters = {
		userId: options.userId ?? null,
		agentId: options.agentId ?? null,
		workspaceId: options.workspaceId ?? null,
		projectId: options.projectId,
		cloudRunServiceName: options.cloudRunServiceName,
		cloudTasksQueueId: options.cloudTasksQueueId
	};
	const sourceClauses = (() => {
		switch (options.source) {
			case 'web':
				return [buildCustomWebLogClause(filters)];
			case 'cloud-run':
				return [
					buildCloudRunTextClause(filters),
					buildCloudRunRequestClause(filters)
				];
			case 'cloud-run-request':
				return [buildCloudRunRequestClause(filters)];
			case 'cloud-run-stdout':
				return [
					buildCloudRunStreamClause({
						...filters,
						logName: CLOUD_RUN_STDOUT_LOG_NAME(filters.projectId)
					})
				];
			case 'cloud-run-stderr':
				return [
					buildCloudRunStreamClause({
						...filters,
						logName: CLOUD_RUN_STDERR_LOG_NAME(filters.projectId)
					})
				];
			case 'tasks-queue':
				return [buildCloudTasksClause(filters)];
			case undefined:
			case null:
				return [
					buildCustomWebLogClause(filters),
					buildCloudRunTextClause(filters),
					buildCloudRunRequestClause(filters),
					buildCloudTasksClause(filters)
				];
		}
	})();
	return [
		`timestamp >= "${options.since.toISOString()}"`,
		options.level ? makeEqualsFilter('severity', options.level) : '',
		`(${sourceClauses.join(' OR ')})`
	]
		.filter((part) => part.length > 0)
		.join(' AND ');
}

function toNumber(value: number | string | undefined): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function buildLogMessage(entry: z.infer<typeof loggingEntrySchema>): string {
	const payload = entry.jsonPayload ?? {};
	const attemptResponseLog = payload.attemptResponseLog;
	if (attemptResponseLog && typeof attemptResponseLog === 'object' && !Array.isArray(attemptResponseLog)) {
		const attempt = attemptResponseLog as Record<string, unknown>;
		const targetAddress =
			typeof attempt.targetAddress === 'string' ? attempt.targetAddress : '';
		const status =
			typeof attempt.status === 'string'
				? attempt.status
				: typeof attempt.status === 'number'
					? String(attempt.status)
					: '';
		const dispatchCount =
			typeof attempt.dispatchCount === 'number'
				? String(attempt.dispatchCount)
				: '';
		return ['Cloud Tasks', status, dispatchCount ? `dispatch=${dispatchCount}` : '', targetAddress]
			.filter((value) => value.length > 0)
			.join(' ');
	}
	if (entry.textPayload && entry.textPayload.trim().length > 0) {
		return entry.textPayload;
	}
	const message = payload.message;
	if (typeof message === 'string' && message.trim().length > 0) {
		const args = Array.isArray(payload.args) ? payload.args : null;
		if (!args || args.length === 0) {
			return message;
		}
		if (
			args.length === 1 &&
			typeof args[0] === 'string' &&
			args[0].trim() === message.trim()
		) {
			return message;
		}
		if (
			args.length === 1 &&
			typeof args[0] === 'object' &&
			args[0] !== null &&
			!Array.isArray(args[0]) &&
			Object.keys(args[0] as Record<string, unknown>).length === 0
		) {
			return message;
		}
		return `${message}\n${truncateText(JSON.stringify(args, null, 2), 8000)}`;
	}
	if (entry.httpRequest?.requestMethod || entry.httpRequest?.requestUrl) {
		const status = toNumber(entry.httpRequest.status);
		return [entry.httpRequest.requestMethod ?? 'REQUEST', status ?? '—', entry.httpRequest.requestUrl ?? '']
			.filter((value) => String(value).length > 0)
			.join(' ');
	}
	return truncateText(JSON.stringify(payload, null, 2), 8000);
}

function inferLogSource(logName: string, entry: z.infer<typeof loggingEntrySchema>): string {
	if (logName.endsWith(`/logs/${SPARK_WEB_LOG_ID}`)) {
		return 'web';
	}
	if (logName.endsWith('/logs/cloudtasks.googleapis.com%2Ftask_operations_log')) {
		return 'tasks-queue';
	}
	if (logName.endsWith('/logs/run.googleapis.com%2Frequests')) {
		return 'cloud-run-request';
	}
	if (logName.endsWith('/logs/run.googleapis.com%2Fstdout')) {
		return 'cloud-run-stdout';
	}
	if (logName.endsWith('/logs/run.googleapis.com%2Fstderr')) {
		return 'cloud-run-stderr';
	}
	return entry.resource?.type ?? 'log';
}

function normaliseLogEntry(entry: z.infer<typeof loggingEntrySchema>): SparkCloudLogEntry {
	const logName = entry.logName ?? '';
	const payload = entry.jsonPayload ?? {};
	const readString = (value: unknown): string | null =>
		typeof value === 'string' && value.trim().length > 0 ? value : null;
	return {
		insertId: entry.insertId ?? null,
		timestamp: entry.timestamp ?? new Date(0).toISOString(),
		severity: entry.severity ?? 'DEFAULT',
		source: inferLogSource(logName, entry),
		logName,
		message: buildLogMessage(entry),
		requestUrl: entry.httpRequest?.requestUrl ?? null,
		httpStatus: toNumber(entry.httpRequest?.status),
		userId: readString(entry.labels?.spark_user_id) ?? readString(payload.userId),
		agentId: readString(entry.labels?.spark_agent_id) ?? readString(payload.agentId),
		workspaceId:
			readString(entry.labels?.spark_workspace_id) ?? readString(payload.workspaceId),
		labels: entry.labels ?? {},
		resourceType: entry.resource?.type ?? 'unknown',
		raw: entry as Record<string, unknown>
	};
}

export async function listSparkCloudLogs(options: {
	userId?: string | null;
	agentId?: string | null;
	workspaceId?: string | null;
	limit?: number;
	lookbackHours?: number;
	source?: SparkCloudLogSource | null;
	level?: SparkCloudLogLevel | null;
}): Promise<SparkCloudLogEntry[]> {
	const config = readLoggingConfig();
	if (!config) {
		return [];
	}

	const pageSize = Math.max(1, Math.min(options.limit ?? 100, 500));
	const lookbackHours = Math.max(1, Math.min(options.lookbackHours ?? 24, 168));
	const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
	const { accessToken } = await getGoogleAccessToken({
		serviceAccountJson: config.serviceAccountJson,
		scopes: [CLOUD_LOGGING_READ_SCOPE]
	});

	const response = await fetch(CLOUD_LOGGING_LIST_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			resourceNames: [`projects/${config.projectId}`],
			filter: buildCombinedFilter({
				userId: options.userId,
				agentId: options.agentId,
				workspaceId: options.workspaceId,
				since,
				projectId: config.projectId,
				cloudRunServiceName: config.cloudRunServiceName,
				cloudTasksQueueId: config.cloudTasksQueueId,
				source: options.source,
				level: options.level
			}),
			orderBy: 'timestamp desc',
			pageSize
		})
	});

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Cloud Logging list failed (${response.status}): ${text.slice(0, 500)}`);
	}

	const parsed = listEntriesResponseSchema.parse(await response.json());
	const entries = (parsed.entries ?? []).map((entry) => normaliseLogEntry(entry));
	entries.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
	return entries;
}
