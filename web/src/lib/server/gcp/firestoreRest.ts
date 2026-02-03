import { z } from 'zod';
import { getGoogleAccessToken } from './googleAccessToken';

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';

type FirestoreValue =
	| { nullValue: null }
	| { booleanValue: boolean }
	| { integerValue: string }
	| { doubleValue: number }
	| { stringValue: string }
	| { bytesValue: string }
	| { timestampValue: string }
	| { mapValue: { fields: Record<string, FirestoreValue> } }
	| { arrayValue: { values: FirestoreValue[] } };

type FirestoreDocument = {
	name: string;
	fields?: Record<string, FirestoreValue>;
	createTime?: string;
	updateTime?: string;
};

function toFirestoreValue(value: unknown): FirestoreValue {
	if (value === null) {
		return { nullValue: null };
	}
	if (value === undefined) {
		// Firestore doesn't support explicit "undefined" values; callers should omit.
		return { nullValue: null };
	}
	if (typeof value === 'boolean') {
		return { booleanValue: value };
	}
	if (typeof value === 'number') {
		if (Number.isInteger(value)) {
			return { integerValue: String(value) };
		}
		return { doubleValue: value };
	}
	if (typeof value === 'string') {
		return { stringValue: value };
	}
	if (value instanceof Date) {
		return { timestampValue: value.toISOString() };
	}
	if (Buffer.isBuffer(value)) {
		return { bytesValue: value.toString('base64') };
	}
	if (value instanceof Uint8Array) {
		return { bytesValue: Buffer.from(value).toString('base64') };
	}
	if (Array.isArray(value)) {
		return { arrayValue: { values: value.filter((v) => v !== undefined).map((v) => toFirestoreValue(v)) } };
	}
	if (typeof value === 'object' && value !== null) {
		const fields: Record<string, FirestoreValue> = {};
		for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
			if (v === undefined) {
				continue;
			}
			fields[key] = toFirestoreValue(v);
		}
		return { mapValue: { fields } };
	}
	return { stringValue: String(value) };
}

function fromFirestoreValue(value: FirestoreValue): unknown {
	if ('nullValue' in value) {
		return null;
	}
	if ('booleanValue' in value) {
		return value.booleanValue;
	}
	if ('integerValue' in value) {
		const n = Number(value.integerValue);
		return Number.isNaN(n) ? value.integerValue : n;
	}
	if ('doubleValue' in value) {
		return value.doubleValue;
	}
	if ('stringValue' in value) {
		return value.stringValue;
	}
	if ('bytesValue' in value) {
		return value.bytesValue;
	}
	if ('timestampValue' in value) {
		return value.timestampValue;
	}
	if ('arrayValue' in value) {
		const values = value.arrayValue?.values ?? [];
		return values.map((entry) => fromFirestoreValue(entry));
	}
	if ('mapValue' in value) {
		const out: Record<string, unknown> = {};
		const fields = value.mapValue?.fields ?? {};
		for (const [k, v] of Object.entries(fields)) {
			out[k] = fromFirestoreValue(v);
		}
		return out;
	}
	return null;
}

function documentFieldsFromData(data: Record<string, unknown>): Record<string, FirestoreValue> {
	const fields: Record<string, FirestoreValue> = {};
	for (const [key, value] of Object.entries(data)) {
		if (value === undefined) {
			continue;
		}
		fields[key] = toFirestoreValue(value);
	}
	return fields;
}

const FirestoreDocumentPathSchema = z
	.string()
	.trim()
	.min(1)
	.refine((value) => !value.startsWith('/'), { message: 'Firestore document path must be relative.' })
	.refine((value) => value.split('/').filter(Boolean).length % 2 === 0, {
		message: 'Firestore document path must have an even number of segments.'
	});

function firestoreDocUrl(projectId: string, documentPath: string): string {
	const normalizedPath = FirestoreDocumentPathSchema.parse(documentPath);
	const encoded = normalizedPath
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
	return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
		projectId
	)}/databases/(default)/documents/${encoded}`;
}

export async function getFirestoreDocument(options: {
	serviceAccountJson: string;
	documentPath: string;
}): Promise<{ exists: boolean; data: Record<string, unknown> | null }> {
	const { accessToken, projectId } = await getGoogleAccessToken({
		serviceAccountJson: options.serviceAccountJson,
		scopes: [FIRESTORE_SCOPE]
	});

	const resp = await fetch(firestoreDocUrl(projectId, options.documentPath), {
		headers: { authorization: `Bearer ${accessToken}` }
	});

	if (resp.status === 404) {
		return { exists: false, data: null };
	}
	if (!resp.ok) {
		const text = await resp.text().catch(() => '');
		throw new Error(`Firestore GET failed (${resp.status}): ${text.slice(0, 500)}`);
	}

	const doc = (await resp.json()) as FirestoreDocument;
	const fields = doc.fields ?? {};
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(fields)) {
		out[k] = fromFirestoreValue(v);
	}
	return { exists: true, data: out };
}

export async function setFirestoreDocument(options: {
	serviceAccountJson: string;
	documentPath: string;
	data: Record<string, unknown>;
}): Promise<void> {
	const { accessToken, projectId } = await getGoogleAccessToken({
		serviceAccountJson: options.serviceAccountJson,
		scopes: [FIRESTORE_SCOPE]
	});

	const fields = documentFieldsFromData(options.data);
	const resp = await fetch(firestoreDocUrl(projectId, options.documentPath), {
		method: 'PATCH',
		headers: {
			authorization: `Bearer ${accessToken}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ fields })
	});

	if (!resp.ok) {
		const text = await resp.text().catch(() => '');
		throw new Error(`Firestore PATCH failed (${resp.status}): ${text.slice(0, 500)}`);
	}
}

