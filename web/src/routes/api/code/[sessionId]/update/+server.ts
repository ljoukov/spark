import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { getUserQuiz } from '$lib/server/quiz/repo';
import { getSession } from '$lib/server/session/repo';
import {
	DEFAULT_USER_STATS,
	PlanItemStateSchema,
	UserStatsSchema,
	type PlanItem,
	type PlanItemState,
	type UserStats
} from '@spark/schemas';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import {
	commitFirestoreWrites,
	getFirestoreDocument,
	patchFirestoreDocument
} from '$lib/server/gcp/firestoreRest';

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
function requireServiceAccountJson(): string {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function computeQuizXp(quiz: Awaited<ReturnType<typeof getUserQuiz>>): number {
	if (!quiz) {
		return 0;
	}
	return quiz.questions.reduce((total, question) => total + (QUESTION_XP[question.kind] ?? 0), 0);
}

function computeCodeXp(planItem: PlanItem, state: PlanItemState): number {
	if (planItem.kind !== 'coding_problem' || state.status !== 'completed') {
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
			planItem.kind === 'coding_problem' &&
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

	const serviceAccountJson = requireServiceAccountJson();
	const userDocPath = `spark/${userId}`;
	const sessionStateDocPath = `${userDocPath}/state/${sessionId}`;

	try {
		await patchFirestoreDocument({
			serviceAccountJson,
			documentPath: sessionStateDocPath,
			updates: {
				sessionId,
				lastUpdatedAt: new Date(),
				[`items.${parsedBody.planItemId}`]: incomingState
			}
		});
	} catch (error) {
		console.error('Failed to persist session state update', { error, userId, sessionId });
		return json(
			{ error: 'session_state_write_failed', message: 'Unable to persist your progress.' },
			{ status: 500 }
		);
	}

	let xpAwarded = 0;
	let alreadyCompleted = false;
	let nextStats: UserStats | null = null;

	if (awardingContext && awardingContext.xpAvailable > 0) {
		const now = new Date();
		const progressDocPath = `${userDocPath}/progress/${awardingContext.progressDocId}`;

		let currentStats: UserStats = DEFAULT_USER_STATS;
		try {
			const userSnapshot = await getFirestoreDocument({
				serviceAccountJson,
				documentPath: userDocPath
			});
			const rawStats =
				userSnapshot.exists && userSnapshot.data && typeof userSnapshot.data === 'object'
					? (userSnapshot.data.stats as unknown)
					: {};
			currentStats = UserStatsSchema.parse(rawStats ?? {});
		} catch (error) {
			console.warn('Failed to read user stats before awarding XP (continuing with defaults)', {
				error,
				userId
			});
			currentStats = DEFAULT_USER_STATS;
		}

		xpAwarded = awardingContext.xpAvailable;
		nextStats = {
			xp: currentStats.xp + xpAwarded,
			level: currentStats.level,
			streakDays: currentStats.streakDays,
			solvedCount: currentStats.solvedCount + 1
		};

		const baseProgressPayload: Record<string, unknown> = {
			sessionId,
			planItemId: parsedBody.planItemId,
			xpAwarded,
			createdAt: now
		};

		let progressPayload: Record<string, unknown> = baseProgressPayload;
		if (awardingContext.kind === 'quiz') {
			progressPayload = {
				...baseProgressPayload,
				quizId: awardingContext.quizId
			};
			} else {
				const problemDifficulty =
					planItem.kind === 'coding_problem' ? (planItem.difficulty ?? null) : null;
				progressPayload = {
					...baseProgressPayload,
					problemId: planItem.id,
					difficulty: problemDifficulty,
				language: incomingState.code?.language ?? null
			};
		}

		try {
			await commitFirestoreWrites({
				serviceAccountJson,
				writes: [
					{
						type: 'set',
						documentPath: progressDocPath,
						data: progressPayload,
						precondition: { exists: false }
					},
					{
						type: 'patch',
						documentPath: userDocPath,
						updates: { stats: nextStats }
					}
				]
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes('ALREADY_EXISTS') || message.includes('FAILED_PRECONDITION')) {
				alreadyCompleted = true;
				xpAwarded = 0;
				nextStats = null;
			} else {
				console.error('Failed to award XP', { error, userId, sessionId, planItemId: parsedBody.planItemId });
				return json(
					{ error: 'xp_award_failed', message: 'Unable to award XP.' },
					{ status: 500 }
				);
			}
		}
	}

	return json(
		{
			status: 'ok',
			...(nextStats ? { stats: nextStats } : {}),
			xpAwarded,
			alreadyCompleted
		},
		{ status: 200 }
	);
};
