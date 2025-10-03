import { error } from '@sveltejs/kit';
import { marked } from 'marked';
import { z } from 'zod';
import { getFirebaseAdminFirestore } from '$lib/server/utils/firebaseAdmin';
import type { PageServerLoad } from './$types';

marked.setOptions({ breaks: true, gfm: true });

const paramsSchema = z.object({
	id: z.string().trim().min(1, 'Problem id is required')
});

const trimmed = z.string().transform((value) => value.trim());
const nonEmpty = trimmed.pipe(z.string().min(1));
const optional = z.string().optional().transform((value) => value?.trim() ?? '');

const listOfStrings = z
	.array(trimmed)
	.default([])
	.transform((items) => items.map((item) => item.trim()).filter((item) => item.length > 0));

const exampleSchema = z.object({
	label: nonEmpty,
	input: nonEmpty,
	output: nonEmpty,
	explanation: optional
});

const approachSchema = z.object({
	title: nonEmpty,
	overview: nonEmpty,
	steps: listOfStrings,
	timeComplexity: nonEmpty,
	spaceComplexity: nonEmpty,
	keyIdeas: listOfStrings
});

const firestoreProblemSchema = z
	.object({
		slug: nonEmpty,
		title: nonEmpty,
		summary: nonEmpty,
		summaryBullets: listOfStrings,
		difficulty: z.enum(['easy', 'medium', 'hard']),
		primaryTopic: nonEmpty,
		topics: listOfStrings,
		tags: listOfStrings,
		tasks: listOfStrings,
		constraints: listOfStrings,
		edgeCases: listOfStrings,
		hints: listOfStrings,
		followUpIdeas: listOfStrings,
		examples: z.array(exampleSchema).default([]),
		solution: z.object({
			optimal: approachSchema,
			alternatives: z.array(approachSchema).default([])
		}),
		source: z.object({
			path: nonEmpty,
			markdown: z.string()
		}),
		metadataVersion: z.number().int().nonnegative(),
		starterCode: z.string().optional().nullable()
        }).loose();

type FirestoreProblem = z.infer<typeof firestoreProblemSchema>;

type SerializableProblem = {
	id: string;
	title: string;
	summary: string;
	summaryBullets: readonly string[];
	difficulty: 'easy' | 'medium' | 'hard';
	primaryTopic: string;
	topics: readonly string[];
	tags: readonly string[];
	tasks: readonly string[];
	constraints: readonly string[];
	edgeCases: readonly string[];
	hints: readonly string[];
	followUpIdeas: readonly string[];
	examples: FirestoreProblem['examples'];
	solution: FirestoreProblem['solution'];
	metadataVersion: number;
	starterCode: string;
	sourcePath: string;
	sourceMarkdown: string;
	markdownHtml: string;
};

function renderMarkdown(markdown: string): string {
	const parsed = marked.parse(markdown);
	return typeof parsed === 'string' ? parsed : '';
}

function toProblem(doc: FirestoreProblem): SerializableProblem {
	const {
		slug,
		title,
		summary,
		summaryBullets,
		difficulty,
		primaryTopic,
		topics,
		tags,
		tasks,
		constraints,
		edgeCases,
		hints,
		followUpIdeas,
		examples,
		solution,
		source,
		metadataVersion,
		starterCode
	} = doc;

	return {
		id: slug,
		title,
		summary,
		summaryBullets,
		difficulty,
		primaryTopic,
		topics,
		tags,
		tasks,
		constraints,
		edgeCases,
		hints,
		followUpIdeas,
		examples,
		solution,
		metadataVersion,
		starterCode: starterCode ?? '',
		sourcePath: source.path,
		sourceMarkdown: source.markdown,
		markdownHtml: renderMarkdown(source.markdown)
	};
}

export const load: PageServerLoad = async ({ params }) => {
	const { id } = paramsSchema.parse(params);
	const firestore = getFirebaseAdminFirestore();
	const snapshot = await firestore.collection('code').doc(id).get();

	if (!snapshot.exists) {
		throw error(404, { message: `Problem ${id} not found` });
	}

	const raw = snapshot.data();
	if (!raw) {
		throw error(500, { message: `Problem ${id} has no data` });
	}

	const parsed = firestoreProblemSchema.parse({ slug: snapshot.id, ...raw });
	const problem = toProblem(parsed);

	return { problem };
};
