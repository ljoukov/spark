import { env } from '$env/dynamic/private';
import { initializeApp } from '@ljoukov/firebase-admin-cloudflare/app';
import { doc, getFirestore, setDoc } from '@ljoukov/firebase-admin-cloudflare/firestore';
import { createTask } from '@spark/llm';
import type { SparkTutorConfidence, SparkTutorHintLevel } from '@spark/schemas';

type TutorTurnAction = 'initial' | 'reply' | 'hint';

export function requireTutorServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function requireTasksEnv(): { serviceUrl: string; apiKey: string } {
	const serviceUrl = env.TASKS_SERVICE_URL;
	if (!serviceUrl || serviceUrl.trim().length === 0) {
		throw new Error('TASKS_SERVICE_URL is missing');
	}
	const apiKey = env.TASKS_API_KEY;
	if (!apiKey || apiKey.trim().length === 0) {
		throw new Error('TASKS_API_KEY is missing');
	}
	return { serviceUrl, apiKey };
}

export async function ensureWorkspaceDoc(options: {
	userId: string;
	workspaceId: string;
	agentId?: string;
	sessionId?: string;
	now: Date;
}): Promise<void> {
	const serviceAccountJson = requireTutorServiceAccountJson();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });
	await setDoc(doc(firestore, `users/${options.userId}/workspace/${options.workspaceId}`), {
		id: options.workspaceId,
		...(options.agentId ? { agentId: options.agentId } : {}),
		...(options.sessionId ? { tutorSessionId: options.sessionId } : {}),
		createdAt: options.now,
		updatedAt: options.now
	});
}

export async function createTutorTurnAgentRun(options: {
	userId: string;
	agentId: string;
	workspaceId: string;
	sessionId: string;
	prompt: string;
	title: string;
	action: TutorTurnAction;
	now: Date;
	studentText?: string;
	confidence?: SparkTutorConfidence;
	hintLevel?: SparkTutorHintLevel;
}): Promise<void> {
	const serviceAccountJson = requireTutorServiceAccountJson();
	const tasksEnv = requireTasksEnv();
	const firestore = getFirestore(initializeApp({ serviceAccountJson }, serviceAccountJson));
	firestore.settings({ ignoreUndefinedProperties: true });

	await setDoc(doc(firestore, `users/${options.userId}/agents/${options.agentId}`), {
		id: options.agentId,
		prompt: options.prompt,
		title: options.title,
		status: 'created',
		workspaceId: options.workspaceId,
		tutorSessionId: options.sessionId,
		tutorInteractionKind: 'full_turn',
		tutorAction: options.action,
		...(options.studentText ? { tutorStudentText: options.studentText } : {}),
		...(options.confidence ? { tutorConfidence: options.confidence } : {}),
		...(options.hintLevel ? { tutorHintLevel: options.hintLevel } : {}),
		createdAt: options.now,
		updatedAt: options.now,
		statesTimeline: [{ state: 'created', timestamp: options.now }]
	});

	await createTask(
		{
			type: 'runAgent',
			runAgent: {
				userId: options.userId,
				agentId: options.agentId,
				workspaceId: options.workspaceId
			}
		},
		{
			serviceUrl: tasksEnv.serviceUrl,
			apiKey: tasksEnv.apiKey,
			serviceAccountJson
		}
	);
}
