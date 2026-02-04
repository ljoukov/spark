declare module '@spark/llm/utils/gemini' {
	type ConfigureGeminiOptions = {
		projectId?: string;
		location?: string;
	};
	export function configureGemini(options?: ConfigureGeminiOptions): void;
}

declare module '@spark/llm/utils/gcp/base64' {
	export function decodeBase64ToBytes(base64: string): Uint8Array;
	export function encodeBytesToBase64(bytes: Uint8Array): string;
	export function encodeBytesToBase64Url(bytes: Uint8Array): string;
}

declare module '@spark/llm/utils/gcp/googleAccessToken' {
	export type GoogleServiceAccount = {
		projectId: string;
		clientEmail: string;
		privateKey: string;
		tokenUri?: string;
	};

	export function parseGoogleServiceAccountJson(raw: string): GoogleServiceAccount;

	export function getGoogleAccessToken(options: {
		serviceAccountJson: string;
		scopes: string[];
	}): Promise<{ accessToken: string; projectId: string }>;
}

declare module '@spark/llm/utils/gcp/firestoreRest' {
	export function getFirestoreDocument(options: {
		serviceAccountJson: string;
		documentPath: string;
	}): Promise<{
		exists: boolean;
		data: Record<string, unknown> | null;
		updateTime?: string;
		createTime?: string;
	}>;

	export function setFirestoreDocument(options: {
		serviceAccountJson: string;
		documentPath: string;
		data: Record<string, unknown>;
	}): Promise<void>;

	export function patchFirestoreDocument(options: {
		serviceAccountJson: string;
		documentPath: string;
		updates: Record<string, unknown>;
		deletes?: string[];
	}): Promise<void>;

	export function listFirestoreDocuments(options: {
		serviceAccountJson: string;
		collectionPath: string;
		limit?: number;
		orderBy?: string;
	}): Promise<Array<{ documentPath: string; data: Record<string, unknown> }>>;

	export function queryFirestoreDocuments(options: {
		serviceAccountJson: string;
		collectionPath: string;
		where?: { fieldPath: string; op: 'EQUAL'; value: unknown };
		limit?: number;
		orderBy?: string;
	}): Promise<Array<{ documentPath: string; data: Record<string, unknown> }>>;

	type CommitWrite =
		| {
				type: 'patch';
				documentPath: string;
				updates: Record<string, unknown>;
				deletes?: string[];
				precondition?: { exists?: boolean };
		  }
		| {
				type: 'set';
				documentPath: string;
				data: Record<string, unknown>;
				precondition?: { exists?: boolean };
		  };

	export function commitFirestoreWrites(options: {
		serviceAccountJson: string;
		writes: CommitWrite[];
	}): Promise<void>;

	export function deleteFirestoreDocument(options: {
		serviceAccountJson: string;
		documentPath: string;
	}): Promise<void>;
}

declare module '@spark/llm/utils/gcp/storageRest' {
	export function downloadStorageObject(options: {
		serviceAccountJson: string;
		bucketName: string;
		objectName: string;
		timeoutMs?: number;
	}): Promise<{ bytes: Uint8Array; contentType: string | null }>;

	export function uploadStorageObject(options: {
		serviceAccountJson: string;
		bucketName: string;
		objectName: string;
		contentType: string;
		data: Uint8Array;
		onlyIfMissing?: boolean;
		timeoutMs?: number;
	}): Promise<void>;
}
