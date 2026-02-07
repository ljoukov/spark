import { getFirestoreDocument, listFirestoreDocuments } from '$lib/server/gcp/firestoreRest';
import {
	SparkAgentStateSchema,
	SparkAgentWorkspaceFileSchema,
	type SparkAgentWorkspaceFile
} from '@spark/schemas';

const textEncoder = new TextEncoder();

function docIdFromPath(documentPath: string): string {
	const parts = documentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? documentPath;
}

function decodeFileId(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function parseLogTimestamp(key: string): { ms: number; seq: number } | null {
	const match = /^t(\d{13})_(\d{3})$/.exec(key);
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

function formatAgentLogText(data: Record<string, unknown> | null): string {
	if (!data) {
		return '';
	}
	const rawLines = data.lines && typeof data.lines === 'object' ? data.lines : null;
	if (!rawLines || Array.isArray(rawLines)) {
		return '';
	}
	const entries: Array<{ ms: number; seq: number; line: string }> = [];
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
	entries.sort((a, b) => {
		const diff = a.ms - b.ms;
		if (diff !== 0) {
			return diff;
		}
		return a.seq - b.seq;
	});
	return entries.map((entry) => `${new Date(entry.ms).toISOString()} ${entry.line}`).join('\n') + '\n';
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
			crc = (crc & 1) !== 0 ? (0xedb88320 ^ (crc >>> 1)) : crc >>> 1;
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

	const agentDocPath = `users/${userId}/agents/${agentId}`;
	const agentSnap = await getFirestoreDocument({ serviceAccountJson, documentPath: agentDocPath });
	if (!agentSnap.exists || !agentSnap.data) {
		return { ok: false, status: 404, error: 'not_found' };
	}
	const agentParsed = SparkAgentStateSchema.safeParse({ id: agentId, ...agentSnap.data });
	if (!agentParsed.success) {
		return { ok: false, status: 500, error: 'invalid_agent' };
	}
	const agent = agentParsed.data;

	const filesDocs = await listFirestoreDocuments({
		serviceAccountJson,
		collectionPath: `users/${userId}/workspace/${agent.workspaceId}/files`,
		limit: 1000,
		orderBy: 'path asc'
	});

	const workspaceFiles: SparkAgentWorkspaceFile[] = [];
	for (const docSnap of filesDocs) {
		const data = docSnap.data ?? {};
		const payload = {
			...data,
			path:
				typeof data.path === 'string' && data.path.trim().length > 0
					? data.path.trim()
					: decodeFileId(docIdFromPath(docSnap.documentPath))
		};
		const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
		if (!parsed.success) {
			continue;
		}
		workspaceFiles.push(parsed.data);
	}

	const logSnap = await getFirestoreDocument({
		serviceAccountJson,
		documentPath: `${agentDocPath}/logs/log`
	});
	const agentLogText = formatAgentLogText(logSnap.exists ? logSnap.data : null);

	const archiveLabel = `spark-agent-${agentId}`;
	const archiveEntries: ZipEntry[] = [{ name: 'agent.log', data: encodeUtf8(agentLogText) }];
	for (const file of workspaceFiles) {
		const safePath = toSafeWorkspaceZipPath(file.path);
		if (!safePath) {
			continue;
		}
		archiveEntries.push({
			name: `workspace/${safePath}`,
			data: encodeUtf8(file.content ?? '')
		});
	}

	const zipped = buildZip(archiveEntries);
	const body = new ArrayBuffer(zipped.byteLength);
	new Uint8Array(body).set(zipped);
	return { ok: true, filename: `${archiveLabel}.zip`, body };
}

