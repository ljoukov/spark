import { z } from 'zod';
import {
	CodeProblemSchema,
	PlanItemSchema,
	QuizDefinitionSchema,
	SessionMediaDocSchema,
	SessionSchema,
	SessionStateSchema,
	type CodeProblem,
	type PlanItem,
	type QuizDefinition,
	type Session,
	type SessionMediaDoc,
	type SessionState,
	FirestoreTimestampSchema
} from '@spark/schemas';
import { saveSession, setCurrentSessionId, getSession } from './repo';
import { saveUserQuiz } from '../quiz/repo';
import { saveUserProblem } from '../code/problemRepo';
import { env } from '$env/dynamic/private';
import { getFirestoreDocument, listFirestoreDocuments, setFirestoreDocument } from '$lib/server/gcp/firestoreRest';

export type WelcomeSessionKey = string;

export type WelcomeSessionOption = {
	key: WelcomeSessionKey;
	sessionId: string;
	title: string;
	tagline: string;
	emoji: string;
	posterImageUrl: string | null;
};

type LoadedTemplate = {
	session: Session;
	tagline: string;
	emoji: string;
	topic: string;
	key: string;
	quizzes: QuizDefinition[];
	problems: CodeProblem[];
	media: SessionMediaDoc | null;
};

const TEMPLATE_ROOT_COLLECTION = 'spark-admin';
const TEMPLATE_DOC_ID = 'templates';
const TEMPLATE_SESSIONS_COLLECTION = 'sessions';
function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

const TemplateDocSchema = z.object({
	id: z.string().trim().min(1, 'id is required'),
	title: z.string().trim().optional(),
	createdAt: FirestoreTimestampSchema.optional(),
	plan: z.array(PlanItemSchema),
	tagline: z.string().trim().min(1, 'tagline is required'),
	emoji: z.string().trim().min(1, 'emoji is required'),
	topic: z.string().trim().min(1, 'topic is required'),
	summary: z.string().trim().optional(),
	key: z.string().trim().optional()
});

type TemplateDoc = z.infer<typeof TemplateDocSchema>;

function templateCollectionPath(): string {
	return `${TEMPLATE_ROOT_COLLECTION}/${TEMPLATE_DOC_ID}/${TEMPLATE_SESSIONS_COLLECTION}`;
}

function templateDocPath(templateId: string): string {
	return `${templateCollectionPath()}/${templateId}`;
}

function docIdFromPath(documentPath: string): string {
	const parts = documentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? documentPath;
}

async function fetchTemplateSnapshot(keyOrSessionId: string): Promise<{ templateId: string; parsed: TemplateDoc }> {
	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: templateCollectionPath()
	});

	const direct = docs.find((doc) => docIdFromPath(doc.documentPath) === keyOrSessionId) ?? null;
	const matchByKey =
		direct ??
		docs.find((doc) => typeof doc.data.key === 'string' && doc.data.key === keyOrSessionId) ??
		null;

	if (!matchByKey) {
		throw new Error(`Welcome session template not found for key '${keyOrSessionId}'`);
	}

	const raw = matchByKey.data;
	const templateId = docIdFromPath(matchByKey.documentPath);
	const parsed = TemplateDocSchema.parse({
		id: (raw.id ?? templateId) as TemplateDoc['id'],
		title: raw.title,
		createdAt: raw.createdAt,
		plan: raw.plan,
		tagline: raw.tagline,
		emoji: raw.emoji,
		topic: raw.topic,
		summary: raw.summary,
		key: raw.key
	});

	return { templateId, parsed };
}

async function fetchTemplateQuizzes(templateId: string): Promise<QuizDefinition[]> {
	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: `${templateDocPath(templateId)}/quiz`
	});
	const quizzes: QuizDefinition[] = [];
	for (const doc of docs) {
		try {
			quizzes.push(QuizDefinitionSchema.parse({ id: docIdFromPath(doc.documentPath), ...doc.data }));
		} catch (error) {
			console.error('Unable to parse welcome quiz template', doc.documentPath, error);
		}
	}
	return quizzes;
}

async function fetchTemplateProblems(templateId: string): Promise<CodeProblem[]> {
	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: `${templateDocPath(templateId)}/code`
	});
	const problems: CodeProblem[] = [];
	for (const doc of docs) {
		try {
			problems.push(CodeProblemSchema.parse({ slug: docIdFromPath(doc.documentPath), ...doc.data }));
		} catch (error) {
			console.error('Unable to parse welcome problem template', doc.documentPath, error);
		}
	}
	return problems;
}

function findStoryPlanItem(plan: readonly PlanItem[]): PlanItem | null {
	for (const item of plan) {
		if (item.kind === 'media') {
			return item;
		}
	}
	return null;
}

async function fetchTemplateMedia(templateId: string, plan: readonly PlanItem[]): Promise<SessionMediaDoc | null> {
	const storyPlanItem = findStoryPlanItem(plan);
	if (!storyPlanItem) {
		console.warn('[welcome] Template plan missing a media item; skipping media copy');
		return null;
	}
	const docPath = `${templateDocPath(templateId)}/media/${storyPlanItem.id}`;
	const snapshot = await getFirestoreDocument({ serviceAccountJson: requireServiceAccountJson(), documentPath: docPath });
	if (!snapshot.exists || !snapshot.data) {
		console.warn('[welcome] Template media document not found for plan item', storyPlanItem.id);
		return null;
	}

	try {
		return SessionMediaDocSchema.parse({ id: storyPlanItem.id, ...snapshot.data });
	} catch (error) {
		console.error('Unable to parse template media document', storyPlanItem.id, error);
		return null;
	}
}

async function loadTemplate(sessionId: string): Promise<LoadedTemplate> {
	const { templateId, parsed } = await fetchTemplateSnapshot(sessionId);
	const session = SessionSchema.parse({
		id: parsed.id,
		title: parsed.title,
		summary: parsed.summary,
		tagline: parsed.tagline,
		emoji: parsed.emoji,
		createdAt: parsed.createdAt ?? new Date(),
		plan: parsed.plan
	});

	const [quizzes, problems, media] = await Promise.all([
		fetchTemplateQuizzes(templateId),
		fetchTemplateProblems(templateId),
		fetchTemplateMedia(templateId, session.plan)
	]);

	return {
		session,
		tagline: parsed.tagline,
		emoji: parsed.emoji,
		topic: parsed.topic,
		key: parsed.key ?? parsed.id,
		quizzes,
		problems,
		media
	};
}

async function copyMediaToUser(
	userId: string,
	sessionId: string,
	media: SessionMediaDoc
): Promise<void> {
	const now = new Date();
	await setFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `spark/${userId}/sessions/${sessionId}/media/${media.planItemId}`,
		data: {
			...media,
			createdAt: now,
			updatedAt: now
		} as unknown as Record<string, unknown>
	});
}

async function seedSessionState(userId: string, session: Session): Promise<void> {
	const baseState: SessionState = SessionStateSchema.parse({
		sessionId: session.id,
		items: session.plan.reduce<Record<string, SessionState['items'][string]>>((acc, item) => {
			acc[item.id] = { status: 'not_started' };
			return acc;
		}, {}),
		lastUpdatedAt: new Date()
	});

	await setFirestoreDocument({
		serviceAccountJson: requireServiceAccountJson(),
		documentPath: `spark/${userId}/state/${session.id}`,
		data: baseState as unknown as Record<string, unknown>
	});
}

export async function listWelcomeSessionOptions(): Promise<WelcomeSessionOption[]> {
	const docs = await listFirestoreDocuments({
		serviceAccountJson: requireServiceAccountJson(),
		collectionPath: templateCollectionPath()
	});
	const options: WelcomeSessionOption[] = [];

	for (const doc of docs) {
		const docId = docIdFromPath(doc.documentPath);
		const raw = doc.data;
		try {
			const parsed = TemplateDocSchema.safeParse({
				id: (raw.id ?? docId) as TemplateDoc['id'],
				title: raw.title,
				createdAt: raw.createdAt,
				plan: raw.plan,
				tagline: raw.tagline,
				emoji: raw.emoji,
				topic: raw.topic,
				summary: raw.summary,
				key: raw.key
			});
			if (!parsed.success) {
				const missing = ['plan', 'tagline', 'emoji', 'topic'].filter(
					(field) => raw[field] === undefined || raw[field] === null
				);
				console.warn('[welcome/templates] template parse failed', {
					id: docId,
					missing,
					issues: parsed.error.issues.map((issue) => issue.message)
				});
				continue;
			}

			const session = SessionSchema.parse({
				id: parsed.data.id,
				title: parsed.data.title,
				createdAt: parsed.data.createdAt ?? new Date(),
				plan: parsed.data.plan
			});

			options.push({
				key: parsed.data.key ?? parsed.data.id,
				sessionId: session.id,
				title: session.title,
				tagline: parsed.data.tagline,
				emoji: parsed.data.emoji,
				posterImageUrl: null
			});
		} catch (error) {
			console.error('Unable to parse welcome session option', doc.documentPath, error);
		}
	}

	return options.sort((a, b) => a.title.localeCompare(b.title));
}

export async function provisionWelcomeSession(
	userId: string,
	key: WelcomeSessionKey
): Promise<Session> {
	const template = await loadTemplate(key);

	const existing = await getSession(userId, template.session.id);
	if (existing) {
		await setCurrentSessionId(userId, existing.id);
		return existing;
	}

	const session = SessionSchema.parse({
		id: template.session.id,
		title: template.session.title,
		summary: template.session.summary,
		tagline: template.session.tagline,
		emoji: template.session.emoji,
		createdAt: new Date(),
		plan: template.session.plan
	});

	await saveSession(userId, session);

	await Promise.all(
		template.quizzes.map(async (quiz) => {
			const parsed = QuizDefinitionSchema.parse(quiz);
			await saveUserQuiz(userId, session.id, parsed);
		})
	);

	await Promise.all(
		template.problems.map(async (problem) => {
			const parsed = CodeProblemSchema.parse(problem);
			await saveUserProblem(userId, session.id, parsed);
		})
	);

	await seedSessionState(userId, session);

	if (template.media) {
		try {
			await copyMediaToUser(userId, session.id, template.media);
		} catch (error) {
			console.error('Unable to copy welcome session media', template.media.planItemId, error);
		}
	} else {
		console.warn('[welcome] No template media found; story narration will be missing');
	}

	await setCurrentSessionId(userId, session.id);

	return session;
}
