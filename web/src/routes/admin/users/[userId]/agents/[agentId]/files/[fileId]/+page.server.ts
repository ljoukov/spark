import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import { doc, getDoc, getFirestore } from '@ljoukov/firebase-admin-cloudflare/firestore';
import {
	buildWorkspaceFileDocPath,
	decodeWorkspaceFileId
} from '@spark/llm';
import { SparkAgentStateSchema, SparkAgentWorkspaceFileSchema } from '@spark/schemas';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import type { PageServerLoad } from './$types';

const paramsSchema = z.object({
	userId: z.string().trim().min(1, 'userId is required'),
	agentId: z.string().trim().min(1, 'agentId is required'),
	fileId: z.string().trim().min(1, 'fileId is required')
});

function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function toIso(value: Date | undefined): string | null {
	if (!value) {
		return null;
	}
	return value.toISOString();
}

export const load: PageServerLoad = async ({ params }) => {
	const { userId, agentId, fileId } = paramsSchema.parse(params);

	const serviceAccountJson = requireServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });

	const agentSnap = await getDoc(doc(firestore, `users/${userId}/agents/${agentId}`));
	if (!agentSnap.exists) {
		return {
			agentId,
			agentDocFound: false,
			agentParseOk: false,
			fileDocFound: false,
			fileParseOk: false,
			workspaceId: null,
			file: null,
			parseIssues: []
		};
	}

	const agentParsed = SparkAgentStateSchema.safeParse({ id: agentId, ...(agentSnap.data() ?? {}) });
	if (!agentParsed.success) {
		return {
			agentId,
			agentDocFound: true,
			agentParseOk: false,
			fileDocFound: false,
			fileParseOk: false,
			workspaceId: null,
			file: null,
			parseIssues: agentParsed.error.issues.map((issue) => ({
				path: issue.path.join('.'),
				message: issue.message
			}))
		};
	}

	const workspaceId = agentParsed.data.workspaceId;
	const filePath = decodeWorkspaceFileId(fileId);
	const fileSnap = await getDoc(
		doc(
			firestore,
			buildWorkspaceFileDocPath({
				userId,
				workspaceId,
				filePath
			})
		)
	);

	if (!fileSnap.exists) {
		return {
			agentId,
			agentDocFound: true,
			agentParseOk: true,
			fileDocFound: false,
			fileParseOk: false,
			workspaceId,
			file: null,
			parseIssues: []
		};
	}

	const fileData = fileSnap.data() ?? {};
	const fileParsed = SparkAgentWorkspaceFileSchema.safeParse({
		...fileData,
		path:
			typeof fileData.path === 'string' && fileData.path.trim().length > 0
				? fileData.path.trim()
				: filePath
	});
	if (!fileParsed.success) {
		return {
			agentId,
			agentDocFound: true,
			agentParseOk: true,
			fileDocFound: true,
			fileParseOk: false,
			workspaceId,
			file: null,
			parseIssues: fileParsed.error.issues.map((issue) => ({
				path: issue.path.join('.'),
				message: issue.message
			}))
		};
	}

	const file = fileParsed.data;

	return {
		agentId,
		agentDocFound: true,
		agentParseOk: true,
		fileDocFound: true,
		fileParseOk: true,
		workspaceId,
		file: {
			type: file.type ?? 'text',
			path: file.path,
			content: file.type === 'storage_link' ? null : file.content,
			storagePath: file.type === 'storage_link' ? file.storagePath : null,
			contentType: file.contentType ?? null,
			sizeBytes: typeof file.sizeBytes === 'number' ? file.sizeBytes : null,
			createdAt: toIso(file.createdAt),
			updatedAt: toIso(file.updatedAt)
		},
		parseIssues: []
	};
};
