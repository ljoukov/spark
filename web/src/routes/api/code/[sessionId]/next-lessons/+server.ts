import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import { generateLessonProposalsForSession } from '$lib/server/lessons/proposals';
import {
	getSession,
	saveNextLessonProposals,
	saveSession,
	setCurrentSessionId,
	updateSessionStatus
} from '$lib/server/session/repo';
import {
	SessionSchema,
	type LessonProposal,
	type Session,
	type SessionStatus
} from '@spark/schemas';
import { createTask } from '@spark/llm';
import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '$env/dynamic/private';

const paramsSchema = z.object({
	sessionId: z.string().trim().min(1, 'sessionId is required')
});

const requestSchema = z.object({
	action: z.enum(['propose', 'select']),
	proposalId: z.string().trim().min(1).optional()
});

function slugifyId(value: string): string {
	const trimmed = value.trim().toLowerCase();
	const slug = trimmed
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');
	return slug.slice(0, 48);
}

function randomSuffix(): string {
	return Math.random().toString(36).slice(2, 6);
}

async function ensureUniqueSessionId(userId: string, baseId: string): Promise<string> {
	const fallback = baseId.length > 0 ? baseId : 'lesson';
	let candidate = `${fallback}-${randomSuffix()}`;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const existing = await getSession(userId, candidate);
		if (!existing) {
			return candidate;
		}
		candidate = `${fallback}-${randomSuffix()}`;
	}
	return `${fallback}-${randomUUID().slice(0, 8)}`;
}

function findProposal(proposals: LessonProposal[], proposalId: string): LessonProposal | null {
	for (const proposal of proposals) {
		if (proposal.id === proposalId) {
			return proposal;
		}
	}
	return null;
}

function deriveStatus(session: Session | null): SessionStatus | null {
	if (!session) {
		return null;
	}
	return session.status ?? 'ready';
}

async function createGeneratingSession(
	userId: string,
	sourceSessionId: string,
	proposal: LessonProposal
): Promise<Session> {
	const baseId = slugifyId(proposal.id ?? proposal.title);
	const sessionId = await ensureUniqueSessionId(userId, baseId);
	const parsed = SessionSchema.parse({
		id: sessionId,
		title: proposal.title,
		summary: proposal.tagline,
		tagline: proposal.tagline,
		emoji: proposal.emoji,
		topics: proposal.topics,
		status: 'generating',
		sourceSessionId,
		sourceProposalId: proposal.id,
		createdAt: new Date(),
		plan: []
	});
	await saveSession(userId, parsed);
	return parsed;
}

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
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_body', message: 'Request body must be JSON' }, { status: 400 });
	}

	const session = await getSession(userId, sessionId);
	if (!session) {
		return json({ error: 'not_found', message: 'Session not found' }, { status: 404 });
	}

	if (parsedBody.action === 'propose') {
		if (session.nextLessonProposals && session.nextLessonProposals.length > 0) {
			return json({ proposals: session.nextLessonProposals, reused: true });
		}

		try {
			const proposals = await generateLessonProposalsForSession(session);
			await saveNextLessonProposals(userId, sessionId, proposals);
			return json({ proposals, reused: false });
		} catch (error) {
			console.error('Failed to generate lesson proposals', { error, userId, sessionId });
			return json(
				{
					error: 'proposal_failed',
					message: 'We could not draft your next lessons. Please try again.'
				},
				{ status: 500 }
			);
		}
	}

	if (parsedBody.action === 'select') {
		if (!parsedBody.proposalId) {
			return json(
				{ error: 'invalid_body', message: 'proposalId is required to start a lesson' },
				{ status: 400 }
			);
		}

		let proposals = session.nextLessonProposals ?? [];
		if (proposals.length === 0) {
			try {
				const generated = await generateLessonProposalsForSession(session);
				proposals = generated;
				await saveNextLessonProposals(userId, sessionId, generated);
			} catch (error) {
				console.error('Failed to generate proposals before selection', {
					error,
					userId,
					sessionId
				});
				return json(
					{
						error: 'proposal_failed',
						message: 'We could not draft your next lessons. Please try again.'
					},
					{ status: 500 }
				);
			}
		}

		const selected = findProposal(proposals, parsedBody.proposalId);
		if (!selected) {
			return json(
				{ error: 'proposal_not_found', message: 'That proposal is no longer available' },
				{ status: 404 }
			);
		}

		const existingTarget = await getSession(userId, slugifyId(selected.id));
		if (deriveStatus(existingTarget) === 'generating') {
			return json({ nextSessionId: existingTarget!.id, status: 'generating' });
		}

		let nextSession: Session;
		try {
			nextSession = await createGeneratingSession(userId, sessionId, selected);
		} catch (error) {
			console.error('Failed to create generating session placeholder', {
				error,
				userId,
				sessionId,
				proposalId: selected.id
			});
			return json(
				{
					error: 'persist_failed',
					message: 'We could not start the next lesson. Please try again.'
				},
				{ status: 500 }
			);
		}

		try {
			await createTask({
				type: 'generateLesson',
				generateLesson: {
					userId,
					sessionId: nextSession.id,
					proposalId: selected.id,
					title: selected.title,
					tagline: selected.tagline,
					topics: selected.topics,
					emoji: selected.emoji,
					sourceSessionId: sessionId
				}
			}, {
				serviceUrl: env.TASKS_SERVICE_URL ?? '',
				apiKey: env.TASKS_API_KEY ?? '',
				serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON ?? ''
			});
		} catch (error) {
			console.error('Failed to enqueue lesson generation', {
				error,
				userId,
				sessionId,
				nextSessionId: nextSession.id,
				proposalId: selected.id
			});
			try {
				await updateSessionStatus(userId, nextSession.id, 'error');
			} catch (statusError) {
				console.error('Unable to mark session generation error', statusError);
			}
			return json(
				{
					error: 'enqueue_failed',
					message: 'We could not start generating that lesson. Please try again.'
				},
				{ status: 500 }
			);
		}

		await setCurrentSessionId(userId, nextSession.id);

		return json({ nextSessionId: nextSession.id, status: nextSession.status });
	}

	return json(
		{ error: 'unsupported_action', message: 'Unsupported next-lesson action' },
		{ status: 400 }
	);
};
