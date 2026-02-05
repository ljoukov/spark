import { LessonProposalSchema, type LessonProposal, type Session } from '@spark/schemas';
import { streamGeminiTextResponse, type GeminiModelId } from '@spark/llm';
import { z } from 'zod';

const NEXT_LESSON_MODEL: GeminiModelId = 'gemini-3-pro-preview';

const GeminiProposalSchema = z.object({
	proposals: z
		.array(
			z.object({
				id: z.string().trim().optional(),
				title: z.string().trim(),
				tagline: z.string().trim(),
				topics: z.array(z.string()).min(1),
				emoji: z.string().trim().optional()
			})
		)
		.min(1)
});

type GeminiProposalResponse = z.infer<typeof GeminiProposalSchema>;
type GeminiProposalItem = GeminiProposalResponse['proposals'][number];

function slugifyId(value: string): string {
	const trimmed = value.trim().toLowerCase();
	const slug = trimmed
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');
	return slug.slice(0, 48);
}

function normalizeTopics(topics: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const topic of topics) {
		const trimmed = topic.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

function normalizeProposal(
	proposal: GeminiProposalItem,
	index: number,
	used: Set<string>
): LessonProposal {
	const title =
		proposal.title.trim().length > 0 ? proposal.title.trim() : `Next lesson ${index + 1}`;
	const tagline = proposal.tagline.trim().length > 0 ? proposal.tagline.trim() : title;
	const topics = normalizeTopics(proposal.topics);
	const emoji =
		proposal.emoji?.trim() && proposal.emoji.trim().length > 0 ? proposal.emoji.trim() : '🚀';
	const baseId = slugifyId(proposal.id ?? title);
	let id = baseId.length > 0 ? baseId : `lesson-${index + 1}`;
	let suffix = 1;
	while (used.has(id)) {
		const fallbackId = baseId.length > 0 ? baseId : `lesson-${index + 1}`;
		id = `${fallbackId}-${suffix}`;
		suffix += 1;
	}
	used.add(id);
	const safeTopics = topics.length > 0 ? topics : [title];
	return LessonProposalSchema.parse({
		id,
		title,
		tagline,
		topics: safeTopics,
		emoji
	});
}

function buildProposalPrompt(session: Session): string {
	const lines: string[] = [];
	lines.push('You are Spark planning three follow-up lessons for a learner.');
	lines.push('Return concise proposals that build on the completed lesson.');
	lines.push(
		'Use JSON only: {"proposals":[{ "id": "...", "title": "...", "tagline": "...", "topics": ["..."], "emoji": "🎯" }]}'
	);
	lines.push(
		'Keep taglines short and catchy, include a bold emoji that matches the tone, and vary the topics.'
	);
	lines.push('');
	lines.push(`Completed lesson: ${session.title}`);
	if (session.summary) {
		lines.push(`Summary: ${session.summary}`);
	} else if (session.tagline) {
		lines.push(`Tagline: ${session.tagline}`);
	}
	if (session.plan.length > 0) {
		lines.push('Plan outline:');
		for (const item of session.plan) {
			const bits = [
				item.title,
				`kind=${item.kind}`,
				item.meta ?? null,
				item.summary ?? null,
				'',
				item.description ?? null
			].filter((value) => value && value.length > 0);
			const detail = bits.join(' • ');
			lines.push(`- ${detail}`);
		}
	}
	lines.push('');
	lines.push('Constraints:');
	lines.push('- Proposals must be distinct and cover different angles or skills.');
	lines.push(
		'- Topics array should be 3–5 short bullet topics that preview what the learner will tackle next.'
	);
	lines.push('- id should be kebab-case and stable for the proposal.');
	lines.push('- Avoid repeating the completed lesson title.');
	return lines.join('\n');
}

export async function generateLessonProposalsForSession(
	session: Session
): Promise<LessonProposal[]> {
	const prompt = buildProposalPrompt(session);

	let parsed: GeminiProposalResponse;
	try {
		const { text } = await streamGeminiTextResponse({
			model: NEXT_LESSON_MODEL,
			parts: [{ text: prompt }],
			config: {
				responseMimeType: 'application/json'
			}
		});
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch (error) {
			throw new Error(`Unable to parse Gemini proposals JSON: ${(error as Error).message}`);
		}
		parsed = GeminiProposalSchema.parse(raw);
	} catch (error) {
		throw new Error(
			`Failed to generate next-lesson proposals: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}

	const usedIds = new Set<string>();
	const normalized: LessonProposal[] = [];
	let index = 0;
	for (const proposal of parsed.proposals) {
		const normalizedProposal = normalizeProposal(proposal, index, usedIds);
		normalized.push(normalizedProposal);
		index += 1;
		if (normalized.length === 3) {
			break;
		}
	}

	if (normalized.length === 0) {
		throw new Error('Gemini returned no usable next-lesson proposals');
	}

	return normalized;
}
