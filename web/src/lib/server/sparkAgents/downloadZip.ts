import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import {
	collection,
	documentId,
	doc,
	getDoc,
	getDocs,
	getFirestore,
	limit as limitQuery,
	orderBy,
	query
} from '@ljoukov/firebase-admin-cloudflare/firestore';
import { parseGoogleServiceAccountJson } from '$lib/server/gcp/googleAccessToken';
import { downloadStorageObject } from '$lib/server/gcp/storageRest';
import {
	SparkAgentStateSchema,
	SparkAgentWorkspaceFileSchema,
	type SparkAgentWorkspaceFile
} from '@spark/schemas';
import {
	buildWorkspaceFilesCollectionPath,
	isAllowedWorkspaceStoragePath,
	normalizeStorageObjectName,
	resolveWorkspaceFilePathFromFirestoreDocument
} from '@spark/llm';

const textEncoder = new TextEncoder();

async function decodeWorkspaceFileContent(options: {
	file: SparkAgentWorkspaceFile;
	serviceAccountJson: string;
	bucketName: string;
	userId: string;
}): Promise<Uint8Array> {
	const { file } = options;
	if (file.type === 'storage_link') {
		const objectName = normalizeStorageObjectName(file.storagePath);
		if (
			objectName.length === 0 ||
			!isAllowedWorkspaceStoragePath(options.userId, objectName)
		) {
			return encodeUtf8(
				JSON.stringify(
					{
						type: 'storage_link',
						path: file.path,
						storagePath: file.storagePath,
						contentType: file.contentType
					},
					null,
					2
				) + '\n'
			);
		}
		try {
			const downloaded = await downloadStorageObject({
				serviceAccountJson: options.serviceAccountJson,
				bucketName: options.bucketName,
				objectName
			});
			return downloaded.bytes;
		} catch {
			return encodeUtf8(
				JSON.stringify(
					{
						type: 'storage_link',
						path: file.path,
						storagePath: file.storagePath,
						contentType: file.contentType
					},
					null,
					2
				) + '\n'
			);
		}
	}
	return encodeUtf8(file.content);
}

function parseLogTimestamp(key: string): { ms: number; seq: number } | null {
	const match = /^t(\d{13})_(\d+)$/.exec(key);
	if (!match) {
		return null;
	}
	const ms = Number.parseInt(match[1] ?? '', 10);
	if (!Number.isFinite(ms)) {
		return null;
	}
	const seq = Number.parseInt(match[2] ?? '', 10);
	return { ms, seq: Number.isFinite(seq) ? seq : 0 };
}

function parseStreamTimestamp(value: unknown): Date | null {
	if (value instanceof Date) {
		return Number.isFinite(value.getTime()) ? value : null;
	}
	if (typeof value === 'string') {
		const date = new Date(value);
		return Number.isFinite(date.getTime()) ? date : null;
	}
	if (typeof value === 'number') {
		const date = new Date(value);
		return Number.isFinite(date.getTime()) ? date : null;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const secondsRaw =
		typeof record.seconds === 'number'
			? record.seconds
			: typeof record._seconds === 'number'
				? record._seconds
				: null;
	const nanosRaw =
		typeof record.nanos === 'number'
			? record.nanos
			: typeof record._nanoseconds === 'number'
				? record._nanoseconds
				: 0;
	if (secondsRaw === null) {
		return null;
	}
	const millis = secondsRaw * 1000 + Math.floor(nanosRaw / 1_000_000);
	const date = new Date(millis);
	return Number.isFinite(date.getTime()) ? date : null;
}

function formatAgentLogText(data: Record<string, unknown> | null): string {
	if (!data) {
		return '';
	}
	const rawLines = data.lines && typeof data.lines === 'object' ? data.lines : null;
	const entries: Array<{ ms: number; seq: number; line: string }> = [];
	if (rawLines && !Array.isArray(rawLines)) {
		for (const [key, value] of Object.entries(rawLines as Record<string, unknown>)) {
			if (typeof value !== 'string') {
				continue;
			}
			const parsedTs = parseLogTimestamp(key);
			if (!parsedTs) {
				continue;
			}
			entries.push({ ms: parsedTs.ms, seq: parsedTs.seq, line: value });
		}
	}
	entries.sort((a, b) => {
		const diff = a.ms - b.ms;
		if (diff !== 0) {
			return diff;
		}
		return a.seq - b.seq;
	});

	const lines = entries.map((entry) => `${new Date(entry.ms).toISOString()} ${entry.line}`);
	const stream = data.stream && typeof data.stream === 'object' ? data.stream : null;
	if (stream && !Array.isArray(stream)) {
		const streamRecord = stream as Record<string, unknown>;
		const thoughts =
			typeof streamRecord.thoughts === 'string' ? streamRecord.thoughts.trimEnd() : '';
		const assistant =
			typeof streamRecord.assistant === 'string' ? streamRecord.assistant.trimEnd() : '';
		const streamUpdatedAt = parseStreamTimestamp(streamRecord.updatedAt);
		if (thoughts.length > 0 || assistant.length > 0) {
			lines.push('');
			lines.push('--- stream snapshot ---');
			if (streamUpdatedAt) {
				lines.push(`updatedAt: ${streamUpdatedAt.toISOString()}`);
			}
			if (thoughts.length > 0) {
				lines.push('');
				lines.push('[thoughts]');
				lines.push(thoughts);
			}
			if (assistant.length > 0) {
				lines.push('');
				lines.push('[assistant]');
				lines.push(assistant);
			}
		}
	}

	if (lines.length === 0) {
		return '';
	}
	return lines.join('\n') + '\n';
}

function toSafeWorkspaceZipPath(filePath: string): string | null {
	const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
	const parts = normalized.split('/').filter((part) => part.length > 0);
	if (parts.length === 0) {
		return null;
	}
	if (parts.some((part) => part === '..')) {
		return null;
	}
	return parts.join('/');
}

function encodeUtf8(value: string): Uint8Array {
	return textEncoder.encode(value);
}

const CRC32_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let idx = 0; idx < 256; idx += 1) {
		let crc = idx;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
		}
		table[idx] = crc >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16LE(buffer: Uint8Array, offset: number, value: number): void {
	buffer[offset] = value & 0xff;
	buffer[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(buffer: Uint8Array, offset: number, value: number): void {
	buffer[offset] = value & 0xff;
	buffer[offset + 1] = (value >>> 8) & 0xff;
	buffer[offset + 2] = (value >>> 16) & 0xff;
	buffer[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
	let total = 0;
	for (const chunk of chunks) {
		total += chunk.byteLength;
	}
	const joined = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return joined;
}

type ZipEntry = {
	name: string;
	data: Uint8Array;
};

type AgentToolTraceCall = {
	step: number;
	toolIndex: number;
	toolName: string;
	callId?: string;
	error?: string;
	input: string;
	output: string;
};

type AgentToolTraceStep = {
	step: number;
	modelId: string;
	text: string;
	toolCallCount: number;
	toolCalls: AgentToolTraceCall[];
};

function formatAgentToolTraceText(steps: readonly AgentToolTraceStep[]): string {
	if (steps.length === 0) {
		return '';
	}
	const lines: string[] = [];
	lines.push('');
	lines.push('--- tool trace ---');
	for (const step of steps) {
		lines.push(
			`step=${step.step.toString()} model=${step.modelId} toolCalls=${step.toolCallCount.toString()}`
		);
		if (step.text.trim().length > 0) {
			lines.push('[step_text]');
			lines.push(step.text);
		}
		for (const call of step.toolCalls) {
			lines.push(
				[
					`tool_call step=${call.step.toString()} index=${call.toolIndex.toString()} tool=${call.toolName}`,
					call.callId ? `callId=${call.callId}` : null,
					call.error ? `error=${call.error}` : null
				]
					.filter((entry): entry is string => Boolean(entry))
					.join(' ')
			);
			lines.push('[input]');
			lines.push(call.input);
			lines.push('[output]');
			lines.push(call.output);
		}
	}
	return lines.join('\n') + '\n';
}

async function loadAgentToolTrace(args: {
	serviceAccountJson: string;
	logDocPath: string;
}): Promise<AgentToolTraceStep[]> {
	const firestore = getFirestore(
		initializeApp({ serviceAccountJson: args.serviceAccountJson }, args.serviceAccountJson)
	);
	firestore.settings({ ignoreUndefinedProperties: true });
	const stepDocs = await getDocs(
		query(
			collection(firestore, `${args.logDocPath}/toolTraceSteps`),
			orderBy('step', 'asc'),
			limitQuery(1000)
		)
	);

	const steps: AgentToolTraceStep[] = [];
	for (const stepDoc of stepDocs.docs) {
		const data = stepDoc.data() ?? {};
		const step = typeof data.step === 'number' ? data.step : Number.NaN;
		if (!Number.isFinite(step)) {
			continue;
		}
		const modelId = typeof data.modelId === 'string' ? data.modelId : '';
		const text = typeof data.text === 'string' ? data.text : '';
		const toolCallCount =
			typeof data.toolCallCount === 'number' && Number.isFinite(data.toolCallCount)
				? data.toolCallCount
				: 0;

		const callDocs = await getDocs(
			query(
				collection(firestore, `${stepDoc.ref.path}/toolCalls`),
				orderBy('toolIndex', 'asc'),
				limitQuery(2000)
			)
		);
		const toolCalls: AgentToolTraceCall[] = [];
		for (const callDoc of callDocs.docs) {
			const callData = callDoc.data() ?? {};
			const toolIndex =
				typeof callData.toolIndex === 'number' && Number.isFinite(callData.toolIndex)
					? callData.toolIndex
					: 0;
			const toolName =
				typeof callData.toolName === 'string' && callData.toolName.trim().length > 0
					? callData.toolName
					: 'unknown';
			const callId =
				typeof callData.callId === 'string' && callData.callId.trim().length > 0
					? callData.callId
					: undefined;
			const error =
				typeof callData.error === 'string' && callData.error.trim().length > 0
					? callData.error
					: undefined;
			const input = typeof callData.input === 'string' ? callData.input : '';
			const output = typeof callData.output === 'string' ? callData.output : '';
			toolCalls.push({
				step,
				toolIndex,
				toolName,
				...(callId ? { callId } : {}),
				...(error ? { error } : {}),
				input,
				output
			});
		}

		steps.push({
			step,
			modelId,
			text,
			toolCallCount,
			toolCalls
		});
	}

	steps.sort((a, b) => a.step - b.step);
	return steps;
}

function buildZip(entries: readonly ZipEntry[]): Uint8Array {
	const localParts: Uint8Array[] = [];
	const centralParts: Uint8Array[] = [];

	let offset = 0;
	for (const entry of entries) {
		const nameBytes = encodeUtf8(entry.name);
		const data = entry.data;
		const size = data.byteLength;
		if (size > 0xffffffff) {
			throw new Error(`Zip entry too large: ${entry.name}`);
		}
		const checksum = crc32(data);

		const localHeader = new Uint8Array(30 + nameBytes.byteLength);
		writeUint32LE(localHeader, 0, 0x04034b50);
		writeUint16LE(localHeader, 4, 20);
		writeUint16LE(localHeader, 6, 0x0800); // UTF-8 names
		writeUint16LE(localHeader, 8, 0); // stored
		writeUint16LE(localHeader, 10, 0);
		writeUint16LE(localHeader, 12, 0);
		writeUint32LE(localHeader, 14, checksum);
		writeUint32LE(localHeader, 18, size);
		writeUint32LE(localHeader, 22, size);
		writeUint16LE(localHeader, 26, nameBytes.byteLength);
		writeUint16LE(localHeader, 28, 0);
		localHeader.set(nameBytes, 30);

		localParts.push(localHeader, data);

		const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
		writeUint32LE(centralHeader, 0, 0x02014b50);
		writeUint16LE(centralHeader, 4, 20);
		writeUint16LE(centralHeader, 6, 20);
		writeUint16LE(centralHeader, 8, 0x0800);
		writeUint16LE(centralHeader, 10, 0);
		writeUint16LE(centralHeader, 12, 0);
		writeUint16LE(centralHeader, 14, 0);
		writeUint32LE(centralHeader, 16, checksum);
		writeUint32LE(centralHeader, 20, size);
		writeUint32LE(centralHeader, 24, size);
		writeUint16LE(centralHeader, 28, nameBytes.byteLength);
		writeUint16LE(centralHeader, 30, 0);
		writeUint16LE(centralHeader, 32, 0);
		writeUint16LE(centralHeader, 34, 0);
		writeUint16LE(centralHeader, 36, 0);
		writeUint32LE(centralHeader, 38, 0);
		writeUint32LE(centralHeader, 42, offset);
		centralHeader.set(nameBytes, 46);

		centralParts.push(centralHeader);
		offset += localHeader.byteLength + data.byteLength;
	}

	const centralDir = concatBytes(centralParts);
	const centralOffset = offset;
	const centralSize = centralDir.byteLength;
	const entryCount = entries.length;

	const endRecord = new Uint8Array(22);
	writeUint32LE(endRecord, 0, 0x06054b50);
	writeUint16LE(endRecord, 4, 0);
	writeUint16LE(endRecord, 6, 0);
	writeUint16LE(endRecord, 8, entryCount);
	writeUint16LE(endRecord, 10, entryCount);
	writeUint32LE(endRecord, 12, centralSize);
	writeUint32LE(endRecord, 16, centralOffset);
	writeUint16LE(endRecord, 20, 0);

	return concatBytes([...localParts, centralDir, endRecord]);
}

export type SparkAgentDownloadZipResult =
	| {
			ok: true;
			filename: string;
			body: ArrayBuffer;
	  }
	| {
			ok: false;
			status: number;
			error: 'not_found' | 'invalid_agent';
	  };

export async function buildSparkAgentDownloadZip(args: {
	serviceAccountJson: string;
	userId: string;
	agentId: string;
}): Promise<SparkAgentDownloadZipResult> {
	const { serviceAccountJson, userId, agentId } = args;
	const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
	const bucketName = `${serviceAccount.projectId}.firebasestorage.app`;
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });

	const agentDocPath = `users/${userId}/agents/${agentId}`;
	const agentSnap = await getDoc(doc(firestore, agentDocPath));
	if (!agentSnap.exists) {
		return { ok: false, status: 404, error: 'not_found' };
	}
	const agentParsed = SparkAgentStateSchema.safeParse({ id: agentId, ...agentSnap.data() });
	if (!agentParsed.success) {
		return { ok: false, status: 500, error: 'invalid_agent' };
	}
	const agent = agentParsed.data;

	const filesDocs = await getDocs(
		query(
			collection(
				firestore,
				buildWorkspaceFilesCollectionPath({
					userId,
					workspaceId: agent.workspaceId
				})
			),
			orderBy(documentId(), 'asc')
		)
	);

	const workspaceFiles: SparkAgentWorkspaceFile[] = [];
	for (const docSnap of filesDocs.docs) {
		const data = docSnap.data() ?? {};
		const payload = {
			...data,
			path: resolveWorkspaceFilePathFromFirestoreDocument({
				documentPath: docSnap.ref.path,
				storedPath: data.path
			})
		};
		const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
		if (!parsed.success) {
			continue;
		}
		workspaceFiles.push(parsed.data);
	}
	workspaceFiles.sort((a, b) => a.path.localeCompare(b.path));

	const logSnap = await getDoc(doc(firestore, `${agentDocPath}/logs/log`));
	const logDocPath = `${agentDocPath}/logs/log`;
	const traceSteps = await loadAgentToolTrace({
		serviceAccountJson,
		logDocPath
	}).catch(() => []);
	const traceText = formatAgentToolTraceText(traceSteps);
	const agentLogText = `${formatAgentLogText(logSnap.exists ? (logSnap.data() ?? null) : null)}${traceText}`;

	const archiveLabel = `spark-agent-${agentId}`;
	const archiveEntries: ZipEntry[] = [{ name: 'agent.log', data: encodeUtf8(agentLogText) }];
	if (traceSteps.length > 0) {
		archiveEntries.push({
			name: 'tool-trace.json',
			data: encodeUtf8(`${JSON.stringify(traceSteps, null, 2)}\n`)
		});
	}
	for (const file of workspaceFiles) {
		const safePath = toSafeWorkspaceZipPath(file.path);
		if (!safePath) {
			continue;
		}
		const content = await decodeWorkspaceFileContent({
			file,
			serviceAccountJson,
			bucketName,
			userId
		});
		archiveEntries.push({
			name: `workspace/${safePath}`,
			data: content
		});
	}

	const zipped = buildZip(archiveEntries);
	const body = new ArrayBuffer(zipped.byteLength);
	new Uint8Array(body).set(zipped);
	return { ok: true, filename: `${archiveLabel}.zip`, body };
}
