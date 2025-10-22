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

import { clientFirebaseConfig } from '$lib/config/firebase';
import {
	getFirebaseAdminFirestore,
	getFirebaseAdminFirestoreModule,
	getFirebaseAdminStorage
} from '@spark/llm';
import { saveSession, setCurrentSessionId, getSession } from './repo';
import { saveUserQuiz } from '../quiz/repo';
import { saveUserProblem } from '../code/problemRepo';

export type WelcomeSessionKey = string;

export type WelcomeSessionOption = {
	key: WelcomeSessionKey;
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
const { Timestamp } = getFirebaseAdminFirestoreModule();

const firebaseAdminOptions = {
	storageBucket: clientFirebaseConfig.storageBucket
};

function getFirestore() {
	return getFirebaseAdminFirestore(undefined, firebaseAdminOptions);
}

function getStorageBucket() {
	const storage = getFirebaseAdminStorage(undefined, firebaseAdminOptions);
	return storage.bucket();
}

const TemplateDocSchema = z.object({
	id: z.string().trim().min(1, 'id is required'),
	title: z.string().trim().optional(),
	createdAt: FirestoreTimestampSchema.optional(),
	plan: z.array(PlanItemSchema),
	tagline: z.string().trim().min(1, 'tagline is required'),
	emoji: z.string().trim().min(1, 'emoji is required'),
	topic: z.string().trim().min(1, 'topic is required'),
	key: z.string().trim().optional()
});

type TemplateDoc = z.infer<typeof TemplateDocSchema>;

function resolveTemplateCollection() {
	const firestore = getFirestore();
	return firestore
		.collection(TEMPLATE_ROOT_COLLECTION)
		.doc(TEMPLATE_DOC_ID)
		.collection(TEMPLATE_SESSIONS_COLLECTION);
}

function resolveTemplateDocRef(sessionId: string) {
	return resolveTemplateCollection().doc(sessionId);
}

async function fetchTemplateSnapshot(sessionId: string) {
	const docRef = resolveTemplateDocRef(sessionId);
	const snapshot = await docRef.get();
	if (!snapshot.exists) {
		throw new Error(`Welcome session template not found for key '${sessionId}'`);
	}
	const raw = snapshot.data();
	if (!raw) {
		throw new Error(`Template data missing for key '${sessionId}'`);
	}
	const parsed = TemplateDocSchema.parse({
		id: (raw.id ?? snapshot.id) as TemplateDoc['id'],
		title: raw.title,
		createdAt: raw.createdAt,
		plan: raw.plan,
		tagline: raw.tagline,
		emoji: raw.emoji,
		topic: raw.topic,
		key: raw.key
	});
	return { docRef, parsed };
}

async function fetchTemplateQuizzes(
	docRef: FirebaseFirestore.DocumentReference
): Promise<QuizDefinition[]> {
	const snapshot = await docRef.collection('quiz').get();
	const quizzes: QuizDefinition[] = [];
	for (const doc of snapshot.docs) {
		const data = doc.data();
		if (!data) {
			continue;
		}
		try {
			quizzes.push(QuizDefinitionSchema.parse({ id: doc.id, ...data }));
		} catch (error) {
			console.error('Unable to parse welcome quiz template', doc.id, error);
		}
	}
	return quizzes;
}

async function fetchTemplateProblems(
	docRef: FirebaseFirestore.DocumentReference
): Promise<CodeProblem[]> {
	const snapshot = await docRef.collection('code').get();
	const problems: CodeProblem[] = [];
	for (const doc of snapshot.docs) {
		const data = doc.data();
		if (!data) {
			continue;
		}
		try {
			problems.push(CodeProblemSchema.parse({ slug: doc.id, ...data }));
		} catch (error) {
			console.error('Unable to parse welcome problem template', doc.id, error);
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

const POSTER_SIGNED_URL_TTL_MS = 60 * 60 * 1000;

function normaliseStoragePath(input: string): string {
	return input.replace(/^\/+/, '');
}

async function createSignedUrl(storagePath: string): Promise<string | null> {
	try {
		const bucket = getStorageBucket();
		const file = bucket.file(normaliseStoragePath(storagePath));
		const expiresAt = new Date(Date.now() + POSTER_SIGNED_URL_TTL_MS);
		const [url] = await file.getSignedUrl({
			action: 'read',
			expires: expiresAt
		});
		return url;
	} catch (error) {
		console.warn('[welcome] Unable to create signed URL for poster image', storagePath, error);
		return null;
	}
}

async function resolveTemplatePosterUrl(
	docRef: FirebaseFirestore.DocumentReference,
	plan: readonly PlanItem[]
): Promise<string | null> {
	const storyPlanItem = findStoryPlanItem(plan);
	if (!storyPlanItem) {
		return null;
	}

	const mediaSnapshot = await docRef.collection('media').doc(storyPlanItem.id).get();
	if (!mediaSnapshot.exists) {
		return null;
	}
	const mediaData = mediaSnapshot.data();
	if (!mediaData) {
		return null;
	}

	try {
		const parsed = SessionMediaDocSchema.parse({ id: mediaSnapshot.id, ...mediaData });
		const storagePath = parsed.posterImage?.storagePath;
		if (!storagePath) {
			return null;
		}
		return await createSignedUrl(storagePath);
	} catch (error) {
		console.error(
			'Unable to parse template media document for poster image',
			mediaSnapshot.id,
			error
		);
		return null;
	}
}

async function fetchTemplateMedia(
	docRef: FirebaseFirestore.DocumentReference,
	plan: readonly PlanItem[]
): Promise<SessionMediaDoc | null> {
	const storyPlanItem = findStoryPlanItem(plan);
	if (!storyPlanItem) {
		console.warn('[welcome] Template plan missing a media item; skipping media copy');
		return null;
	}

	const mediaSnapshot = await docRef.collection('media').doc(storyPlanItem.id).get();
	if (!mediaSnapshot.exists) {
		console.warn('[welcome] Template media document not found for plan item', storyPlanItem.id);
		return null;
	}

	const data = mediaSnapshot.data();
	if (!data) {
		return null;
	}

	try {
		return SessionMediaDocSchema.parse({ id: mediaSnapshot.id, ...data });
	} catch (error) {
		console.error('Unable to parse template media document', mediaSnapshot.id, error);
		return null;
	}
}

async function loadTemplate(sessionId: string): Promise<LoadedTemplate> {
	const { docRef, parsed } = await fetchTemplateSnapshot(sessionId);
	const session = SessionSchema.parse({
		id: parsed.id,
		title: parsed.title,
		createdAt: parsed.createdAt ?? Timestamp.now(),
		plan: parsed.plan
	});

	const [quizzes, problems, media] = await Promise.all([
		fetchTemplateQuizzes(docRef),
		fetchTemplateProblems(docRef),
		fetchTemplateMedia(docRef, session.plan)
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
	const firestore = getFirestore();
	const now = Timestamp.now();
	await firestore
		.collection('spark')
		.doc(userId)
		.collection('sessions')
		.doc(sessionId)
		.collection('media')
		.doc(media.planItemId)
		.set({
			...media,
			createdAt: now,
			updatedAt: now
		});
}

async function seedSessionState(userId: string, session: Session): Promise<void> {
	const firestore = getFirestore();
	const stateRef = firestore.collection('spark').doc(userId).collection('state').doc(session.id);

	const baseState: SessionState = SessionStateSchema.parse({
		sessionId: session.id,
		items: session.plan.reduce<Record<string, SessionState['items'][string]>>((acc, item) => {
			acc[item.id] = { status: 'not_started' };
			return acc;
		}, {}),
		lastUpdatedAt: Timestamp.now()
	});

	await stateRef.set(baseState);
}

export async function listWelcomeSessionOptions(): Promise<WelcomeSessionOption[]> {
	const snapshot = await resolveTemplateCollection().get();
	const options: WelcomeSessionOption[] = [];

	for (const doc of snapshot.docs) {
		const raw = doc.data();
		if (!raw) {
			continue;
		}
		try {
			const parsed = TemplateDocSchema.parse({
				id: (raw.id ?? doc.id) as TemplateDoc['id'],
				title: raw.title,
				createdAt: raw.createdAt,
				plan: raw.plan,
				tagline: raw.tagline,
				emoji: raw.emoji,
				topic: raw.topic,
				key: raw.key
			});

			const session = SessionSchema.parse({
				id: parsed.id,
				title: parsed.title,
				createdAt: parsed.createdAt ?? Timestamp.now(),
				plan: parsed.plan
			});

			const posterImageUrl = await resolveTemplatePosterUrl(doc.ref, session.plan);

			options.push({
				key: parsed.key ?? parsed.id,
				title: session.title,
				tagline: parsed.tagline,
				emoji: parsed.emoji,
				posterImageUrl
			});
		} catch (error) {
			console.error('Unable to parse welcome session option', doc.id, error);
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
		createdAt: Timestamp.now(),
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
