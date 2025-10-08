import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getUserQuiz } from '$lib/server/quiz/repo';
import { getSession } from '$lib/server/session/repo';
import { getFirebaseAdminFirestore } from '$lib/server/utils/firebaseAdmin';
import {
	DEFAULT_USER_STATS,
	PlanItemStateSchema,
	UserStatsSchema,
	type PlanItem,
	type PlanItemState,
	type UserStats
} from '@spark/schemas';
import { json, type RequestHandler } from '@sveltejs/kit';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

const paramsSchema = z.object({
	sessionId: z.string().trim().min(1, 'sessionId is required')
});

const requestSchema = z.object({
	planItemId: z.string().trim().min(1, 'planItemId is required'),
	state: z.unknown(),
	quizCompletion: z
		.object({
			quizId: z.string().trim().min(1, 'quizId is required')
		})
		.optional()
});

type AwardingContext =
	| {
			kind: 'quiz';
			progressDocId: string;
			xpAvailable: number;
			quizId: string;
	  }
	| {
			kind: 'code';
			progressDocId: string;
			xpAvailable: number;
	  }
	| null;

const QUESTION_XP: Record<string, number> = Object.freeze({
	'multiple-choice': 10,
	'type-answer': 12,
	'info-card': 5
});

const CODE_PROBLEM_XP: Record<string, number> = Object.freeze({
	warmup: 20,
	intro: 30,
	easy: 40,
	medium: 60,
	hard: 80
});

const DEFAULT_CODE_XP = 40;

function computeQuizXp(quiz: Awaited<ReturnType<typeof getUserQuiz>>): number {
	if (!quiz) {
		return 0;
	}
	return quiz.questions.reduce((total, question) => total + (QUESTION_XP[question.kind] ?? 0), 0);
}

function computeCodeXp(planItem: PlanItem, state: PlanItemState): number {
	if (planItem.kind !== 'problem' || state.status !== 'completed') {
		return 0;
	}
	const source = state.code?.source;
	if (!source || source.trim().length === 0) {
		return 0;
	}
	const difficultyKey = planItem.difficulty?.toLowerCase() ?? '';
	return CODE_PROBLEM_XP[difficultyKey] ?? DEFAULT_CODE_XP;
}

// Note: server no longer computes/merges session state transitions.
// It validates input with zod, persists it, and (optionally) awards XP.

export const POST: RequestHandler = async ({ params, request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let sessionId: string;
	try {
		sessionId = paramsSchema.parse(params).sessionId;
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_params', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_params', message: 'Invalid session id' }, { status: 400 });
	}

	let parsedBody: z.infer<typeof requestSchema>;
	try {
		parsedBody = requestSchema.parse(await request.json());
	} catch (error) {
		console.error('Failed to parse session update body', {
			error,
			userId,
			sessionId: params.sessionId
		});
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json(
			{ error: 'invalid_body', message: 'Unable to parse request body as JSON' },
			{ status: 400 }
		);
	}

	let incomingState: PlanItemState;
	try {
		// Normalize and validate via shared schema (accepts Date/string/number for timestamps).
		incomingState = PlanItemStateSchema.parse(parsedBody.state);
	} catch (error) {
		console.error('Session update rejected due to invalid state payload', {
			error,
			userId,
			sessionId,
			planItemId: parsedBody.planItemId
		});
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_state', issues: error.issues }, { status: 400 });
		}
		return json(
			{ error: 'invalid_state', message: 'Unable to parse plan item state' },
			{ status: 400 }
		);
	}

	const session = await getSession(userId, sessionId);
	if (!session) {
		return json({ error: 'not_found', message: 'Session not found' }, { status: 404 });
	}

	const planItem = session.plan.find((item) => item.id === parsedBody.planItemId);
	if (!planItem) {
		return json({ error: 'not_found', message: 'Plan item not found in session' }, { status: 404 });
	}

	let awardingContext: AwardingContext = null;
	if (parsedBody.quizCompletion) {
		if (planItem.kind !== 'quiz') {
			return json(
				{ error: 'invalid_plan_item', message: 'Plan item is not a quiz' },
				{ status: 400 }
			);
		}
		if (parsedBody.quizCompletion.quizId !== planItem.id) {
			return json(
				{ error: 'quiz_mismatch', message: 'quizId must match the plan item id' },
				{ status: 400 }
			);
		}
		const quiz = await getUserQuiz(userId, sessionId, parsedBody.quizCompletion.quizId);
		if (!quiz) {
			return json({ error: 'not_found', message: 'Quiz definition not found' }, { status: 404 });
		}
		const xpAvailable = computeQuizXp(quiz);
		awardingContext = {
			kind: 'quiz',
			progressDocId: `quiz:${sessionId}:${parsedBody.planItemId}`,
			xpAvailable,
			quizId: parsedBody.quizCompletion.quizId
		};
	} else if (
		planItem.kind === 'problem' &&
		incomingState.status === 'completed' &&
		typeof incomingState.code?.source === 'string' &&
		incomingState.code.source.trim().length > 0
	) {
		const xpAvailable = computeCodeXp(planItem, incomingState);
		if (xpAvailable > 0) {
			awardingContext = {
				kind: 'code',
				progressDocId: `code:${sessionId}:${parsedBody.planItemId}`,
				xpAvailable
			};
		}
	}

	const firestore = getFirebaseAdminFirestore();
	const userDocRef = firestore.collection('spark').doc(userId);
	const sessionStateDocRef = userDocRef.collection('state').doc(sessionId);

	const result = await firestore.runTransaction(async (tx) => {
		// Reads must occur before all writes in a transaction.
		let xpAwarded = 0;
		let nextStats: UserStats | null = null;
		let alreadyCompleted = false;

		// Pre-read for XP awarding if applicable
		let parsedStats: UserStats | null = null;
		let progressDocRef: FirebaseFirestore.DocumentReference | null = null;
		if (awardingContext && awardingContext.xpAvailable > 0) {
			progressDocRef = userDocRef.collection('progress').doc(awardingContext.progressDocId);
			const progressSnapshot = await tx.get(progressDocRef);
			alreadyCompleted = progressSnapshot.exists;
			if (!alreadyCompleted) {
				const userSnapshot = await tx.get(userDocRef);
				const rawStats = userSnapshot.exists ? (userSnapshot.data()?.stats ?? {}) : {};
				parsedStats = UserStatsSchema.parse(rawStats ?? {});
			}
		}

		// Writes after reads
		// Ensure document exists, then update nested field path without clobbering the entire items map
		tx.set(sessionStateDocRef, { sessionId }, { merge: true });
		tx.update(sessionStateDocRef, {
			lastUpdatedAt: FieldValue.serverTimestamp(),
			[`items.${parsedBody.planItemId}`]: incomingState
		});

		if (
			awardingContext &&
			awardingContext.xpAvailable > 0 &&
			progressDocRef &&
			!alreadyCompleted
		) {
			xpAwarded = awardingContext.xpAvailable;
			const baseProgressPayload = {
				sessionId,
				planItemId: parsedBody.planItemId,
				xpAwarded,
				createdAt: FieldValue.serverTimestamp()
			};

			if (awardingContext.kind === 'quiz') {
				tx.set(progressDocRef, {
					...baseProgressPayload,
					quizId: awardingContext.quizId
				});
			} else {
				const problemDifficulty =
					planItem.kind === 'problem' ? planItem.difficulty ?? null : null;
				tx.set(progressDocRef, {
					...baseProgressPayload,
					problemId: planItem.id,
					difficulty: problemDifficulty,
					language: incomingState.code?.language ?? null
				});
			}

			if (parsedStats) {
				nextStats = {
					xp: parsedStats.xp + xpAwarded,
					level: parsedStats.level,
					streakDays: parsedStats.streakDays,
					solvedCount: parsedStats.solvedCount + 1
				};
				tx.set(userDocRef, { stats: nextStats }, { merge: true });
			}
		}

		return { xpAwarded, alreadyCompleted, stats: nextStats };
	});

	return json({
		status: 'ok',
		stats: result.stats ?? DEFAULT_USER_STATS,
		xpAwarded: result.xpAwarded,
		alreadyCompleted: result.alreadyCompleted
	});
};
