import { GoogleGenAI } from '@google/genai';

const MAX_PARALLEL_REQUESTS = 3;
const MIN_INTERVAL_BETWEEN_START_MS = 200;
const START_JITTER_MS = 200;
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 4000;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']);
const RATE_LIMIT_REASONS = new Set(['RATE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED']);

export const GEMINI_MODEL_IDS = [
	'gemini-2.5-pro',
	'gemini-flash-latest',
	'gemini-flash-lite-latest'
] as const;

export type GeminiModelId = (typeof GEMINI_MODEL_IDS)[number];

export function isGeminiModelId(value: string): value is GeminiModelId {
	return (GEMINI_MODEL_IDS as readonly string[]).includes(value);
}

let activeCount = 0;
let lastStartTime = 0;
const queue: Array<{
	execute: () => Promise<unknown>;
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
}> = [];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function resolveGeminiApiKey(): Promise<string> {
	const fromProcess = process.env.GEMINI_API_KEY?.trim();
	if (fromProcess) {
		return fromProcess;
	}
	try {
		const mod = await import('$env/static/private');
		const fromModule = typeof mod.GEMINI_API_KEY === 'string' ? mod.GEMINI_API_KEY.trim() : '';
		if (fromModule) {
			return fromModule;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== 'ERR_MODULE_NOT_FOUND') {
			console.warn('[gemini] Unable to load $env/static/private:', error);
		}
	}
	throw new Error('GEMINI_API_KEY is not set. Provide it in environment variables.');
}

let clientPromise: Promise<GoogleGenAI> | undefined;

async function getGeminiClient(): Promise<GoogleGenAI> {
	if (!clientPromise) {
		clientPromise = (async () => {
			const apiKey = await resolveGeminiApiKey();
			return new GoogleGenAI({ apiKey });
		})();
	}
	return clientPromise;
}

function getStatus(error: unknown): number | undefined {
	const maybe = error as {
		status?: unknown;
		statusCode?: unknown;
		code?: unknown;
		response?: { status?: unknown };
	};
	const candidates = [maybe?.status, maybe?.statusCode, maybe?.response?.status];
	for (const value of candidates) {
		if (typeof value === 'number') {
			return value;
		}
		if (typeof value === 'string') {
			const parsed = Number(value);
			if (!Number.isNaN(parsed)) {
				return parsed;
			}
		}
	}
	if (typeof maybe?.code === 'number') {
		return maybe.code;
	}
	return undefined;
}

function getErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== 'object') {
		return undefined;
	}
	const maybe = error as { code?: unknown; cause?: unknown };
	if (typeof maybe.code === 'string') {
		return maybe.code;
	}
	if (maybe.cause && typeof maybe.cause === 'object') {
		const causeCode = (maybe.cause as { code?: unknown }).code;
		if (typeof causeCode === 'string') {
			return causeCode;
		}
	}
	return undefined;
}

function getErrorReason(error: unknown): string | undefined {
	if (!error || typeof error !== 'object') {
		return undefined;
	}
	const details = (error as { errorDetails?: unknown }).errorDetails;
	if (Array.isArray(details) && details.length > 0) {
		const reason = (details[0] as { reason?: unknown }).reason;
		if (typeof reason === 'string') {
			return reason;
		}
	}
	const cause = (error as { cause?: unknown }).cause;
	if (cause && typeof cause === 'object') {
		const nestedDetails = (cause as { errorDetails?: unknown }).errorDetails;
		if (Array.isArray(nestedDetails) && nestedDetails.length > 0) {
			const reason = (nestedDetails[0] as { reason?: unknown }).reason;
			if (typeof reason === 'string') {
				return reason;
			}
		}
	}
	return undefined;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return '';
}

function shouldRetry(error: unknown): boolean {
	const status = getStatus(error);
	if (status && RETRYABLE_STATUSES.has(status)) {
		return true;
	}

	const reason = getErrorReason(error);
	if (reason && RATE_LIMIT_REASONS.has(reason)) {
		return true;
	}

	const code = getErrorCode(error);
	if (code && RETRYABLE_ERROR_CODES.has(code)) {
		return true;
	}

	const message = getErrorMessage(error).toLowerCase();
	if (message.includes('rate limit') || message.includes('temporarily unavailable')) {
		return true;
	}
	if (message.includes('quota') || message.includes('insufficient')) {
		return false;
	}
	if (message.includes('timeout') || message.includes('network')) {
		return true;
	}
	return false;
}

function retryDelayMs(attempt: number): number {
	const base = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1));
	const jitter = Math.floor(Math.random() * 200);
	return base + jitter;
}

async function attemptWithRetries<T>(fn: () => Promise<T>, attempt: number): Promise<T> {
	try {
		return await fn();
	} catch (error: unknown) {
		if (attempt >= MAX_ATTEMPTS || !shouldRetry(error)) {
			throw error;
		}
		const delay = retryDelayMs(attempt);
		const message = getErrorMessage(error);
		console.warn(
			`[gemini] attempt ${attempt} failed: ${message || 'unknown error'}; retrying in ${delay}ms`
		);
		await sleep(delay);
		return attemptWithRetries(fn, attempt + 1);
	}
}

async function applyStartSpacing(): Promise<void> {
	const now = Date.now();
	const earliestNext = lastStartTime + MIN_INTERVAL_BETWEEN_START_MS;
	const wait = Math.max(0, earliestNext - now);
	const jitter = Math.floor(Math.random() * (START_JITTER_MS + 1));
	const delay = wait + jitter;
	if (delay > 0) {
		await sleep(delay);
	}
	lastStartTime = Date.now();
}

async function runTask(task: {
	execute: () => Promise<unknown>;
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
}): Promise<void> {
	try {
		const result = await attemptWithRetries(async () => {
			await applyStartSpacing();
			return task.execute();
		}, 1);
		task.resolve(result);
	} catch (error: unknown) {
		task.reject(error);
	} finally {
		activeCount -= 1;
		queueMicrotask(drainQueue);
	}
}

function drainQueue(): void {
	while (activeCount < MAX_PARALLEL_REQUESTS && queue.length > 0) {
		const task = queue.shift();
		if (!task) {
			continue;
		}
		activeCount += 1;
		void runTask(task);
	}
}

function schedule<T>(fn: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		queue.push({
			execute: fn,
			resolve: (value) => {
				resolve(value as T);
			},
			reject: (error) => {
				reject(error);
			}
		});
		drainQueue();
	});
}

export async function runGeminiCall<T>(fn: (client: GoogleGenAI) => Promise<T>): Promise<T> {
	return schedule(async () => fn(await getGeminiClient())) as Promise<T>;
}
