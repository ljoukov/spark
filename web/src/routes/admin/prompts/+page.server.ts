import type { Schema } from '@google/genai';
import type { PageServerLoad } from './$types';
import {
	buildGenerationPrompt,
	buildExtensionPrompt,
	QUIZ_RESPONSE_SCHEMA
} from '$lib/server/llm/quizPrompts';
import {
	buildJudgePrompt,
	buildAuditPrompt,
	AUDIT_RESPONSE_SCHEMA,
	JUDGE_RESPONSE_SCHEMA
} from '$lib/server/llm/eval/judge';
import type { QuizGeneration } from '$lib/llm/schemas';

type PromptVariable = { name: string; description: string };

type PromptDescriptor = {
	id: string;
	title: string;
	description: string;
	models: string[];
	usedBy: string;
	variables: PromptVariable[];
	notes: string[];
	example: string;
	schema?: { title: string; definition: Schema };
};

const previewQuiz: QuizGeneration = {
	quizTitle: 'Preview Quiz',
	summary: 'Lightweight quiz shell used to document prompt context.',
	mode: 'extraction',
	subject: 'Physics',
	board: 'AQA',
	syllabusAlignment: 'Preview only',
	questionCount: 1,
	questions: [
		{
			id: 'preview-question-1',
			prompt: 'Example question for documenting prompts.',
			answer: 'Preview answer',
			explanation: 'Preview explanation',
			type: 'short_answer',
			topic: 'Sample topic',
			difficulty: 'foundation',
			skillFocus: 'Prompt documentation'
		}
	]
};

export const load: PageServerLoad = async () => {
	const prompts: PromptDescriptor[] = [
		{
			id: 'quiz-generation-extraction',
			title: 'Quiz generation — extraction mode',
			description:
				'Used when source documents already contain question/answer pairs that we refine.',
			models: ['gemini-2.5-flash'],
			usedBy: 'generateQuizFromSource (mode: "extraction")',
			variables: [
				{
					name: 'questionCount',
					description: 'Inserted into the instructions to cap the number of returned items.'
				},
				{
					name: 'subject',
					description:
						'Optional subject line included when we provide a subject focus (uses caller value).'
				},
				{
					name: 'board',
					description:
						'Optional exam board line included when the caller sets an exam board context.'
				}
			],
			notes: [
				'Inline source files from the request are attached as additional parts and are not shown here.'
			],
			example: buildGenerationPrompt({
				mode: 'extraction',
				questionCount: 10,
				subject: '{{subject}}',
				board: '{{board}}',
				sourceFiles: []
			}),
			schema: { title: 'Quiz response schema', definition: QUIZ_RESPONSE_SCHEMA }
		},
		{
			id: 'quiz-generation-synthesis',
			title: 'Quiz generation — synthesis mode',
			description:
				'Used when we synthesise new questions from study notes without existing question text.',
			models: ['gemini-2.5-flash'],
			usedBy: 'generateQuizFromSource (mode: "synthesis")',
			variables: [
				{
					name: 'questionCount',
					description: 'Controls the exact number of questions returned.'
				},
				{
					name: 'subject',
					description: 'Optional subject hint appended when provided.'
				},
				{
					name: 'board',
					description: 'Optional exam board hint appended when provided.'
				}
			],
			notes: [
				'Inline source files from the request are attached as additional parts and are not shown here.'
			],
			example: buildGenerationPrompt({
				mode: 'synthesis',
				questionCount: 10,
				subject: '{{subject}}',
				board: '{{board}}',
				sourceFiles: []
			}),
			schema: { title: 'Quiz response schema', definition: QUIZ_RESPONSE_SCHEMA }
		},
		{
			id: 'quiz-extension',
			title: 'Quiz extension',
			description:
				'Asks the model to extend an existing quiz with new questions while avoiding duplication.',
			models: ['gemini-2.5-flash'],
			usedBy: 'extendQuizWithMoreQuestions',
			variables: [
				{
					name: 'additionalQuestionCount',
					description: 'Determines how many new questions the model must return.'
				}
			],
			notes: [
				'Inline source files are attached as separate parts, followed by a <PAST_QUIZES> block listing previous prompts.',
				'The preview quiz shown here only demonstrates the structure passed to the model.'
			],
			example: buildExtensionPrompt({
				additionalQuestionCount: 4,
				subject: previewQuiz.subject,
				board: previewQuiz.board
			}),
			schema: { title: 'Quiz response schema', definition: QUIZ_RESPONSE_SCHEMA }
		},
		{
			id: 'quiz-judge',
			title: 'Quiz judging rubric',
			description: 'Guides Gemini when scoring a generated quiz against our quality rubric.',
			models: ['gemini-2.5-pro'],
			usedBy: 'judgeQuiz',
			variables: [
				{
					name: 'rubricSummary',
					description: 'Optional additional rubric notes appended when provided by the caller.'
				}
			],
			notes: [
				'The candidate quiz JSON and source files are attached as extra parts for judging.',
				'This prompt always runs on gemini-2.5-pro.'
			],
			example: buildJudgePrompt({
				rubricSummary: '{{rubricSummary}}',
				sourceFiles: [],
				candidateQuiz: previewQuiz
			}),
			schema: { title: 'Judge verdict schema', definition: JUDGE_RESPONSE_SCHEMA }
		},
		{
			id: 'quiz-audit',
			title: 'Judge audit prompt',
			description: 'Second-pass audit performed by a pro model on the judge output.',
			models: ['gemini-2.5-pro'],
			usedBy: 'auditJudgeDecision',
			variables: [],
			notes: [
				'The judge verdict JSON and the candidate quiz JSON are attached as additional context.',
				'This prompt always runs on gemini-2.5-pro for higher reasoning capacity.'
			],
			example: buildAuditPrompt(),
			schema: { title: 'Audit response schema', definition: AUDIT_RESPONSE_SCHEMA }
		}
	];

	return { prompts };
};
