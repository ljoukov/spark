import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { renderMarkdownOptional } from '$lib/server/markdown';
import type { QuizChoiceOption, QuizDefinition, QuizQuestion } from '$lib/types/quiz';
import { z } from 'zod';

const slugSchema = z.enum(['latex-1', 'latex-2', 'latex-3', 'code-1', 'free-text-1']);
type PreviewSlug = z.infer<typeof slugSchema>;

type PreviewEntry = {
	title: string;
	description: string;
	quiz: QuizDefinition;
};

const sequencePrompt = String.raw`The sequence $(x_n)$ of positive real numbers satisfies the relationship
[
x_{n-1}x_nx_{n+1}=1
\quad\text{for all } n\ge 2.
]
If $x_1=1$ and $x_2=2$, what are the values of the next few terms? What can you say about the sequence? What happens for other starting values?

The sequence $(y_n)$ satisfies the relationship
[
y_{n-1}y_{n+1}+y_n=1
\quad\text{for all } n\ge 2.
]
If $y_1=1$ and $y_2=2$, what are the values of the next few terms? What can you say about the sequence? What happens for other starting values?`;

const previews: Record<PreviewSlug, PreviewEntry> = {
	'latex-1': {
		title: 'LaTeX block prompt',
		description: 'Recurrence sequences with bracket-style display math blocks.',
		quiz: {
			id: 'admin-latex-1',
			title: 'Sequences & recurrences',
			description: 'Display-math block rendering in prompts.',
			progressKey: 'admin-latex-1',
			topic: 'Sequences',
			questions: [
				{
					id: 'q-seq-1',
					kind: 'type-answer',
					prompt: sequencePrompt,
					answer: '1, 2, 1/2, 1, 2, 1/2, … (period 3)',
					acceptableAnswers: ['period 3', 'periodic with period 3'],
					hint: String.raw`Start with $x_3=\frac{1}{x_1 x_2}$, then keep applying the recurrence.`,
					explanation: String.raw`For $x_n$,
$$
x_3=\frac{1}{x_1 x_2}=\frac{1}{2},\quad
x_4=\frac{1}{x_2 x_3}=1,\quad
x_5=\frac{1}{x_3 x_4}=2.
$$
So the sequence cycles with period 3. For $y_n$, the recurrence yields $y_3=-1$, $y_4=1$, $y_5=0$, after which the sequence becomes underdetermined (any $y_7$ works).`,
					correctFeedback: {
						message: 'Nice work — the recurrence locks into a 3-cycle for the x-sequence.'
					}
				}
			]
		}
	},
	'latex-2': {
		title: 'MCQ with LaTeX answers',
		description: 'Quadratic roots with inline math in the answer options.',
		quiz: {
			id: 'admin-latex-2',
			title: 'Quadratic roots',
			description: 'Inline math in multiple-choice options.',
			progressKey: 'admin-latex-2',
			topic: 'Algebra',
			questions: [
				{
					id: 'q-mcq-1',
					kind: 'multiple-choice',
					prompt: String.raw`Solve the quadratic:
$$
x^2 - 5x + 6 = 0.
$$
Which pair is correct?`,
					options: [
						{ id: 'a', label: 'A', text: String.raw`$x=2$ and $x=3$` },
						{ id: 'b', label: 'B', text: String.raw`$x=-2$ and $x=-3$` },
						{ id: 'c', label: 'C', text: String.raw`$x=1$ and $x=6$` },
						{ id: 'd', label: 'D', text: String.raw`$x=3$ and $x=5$` }
					],
					correctOptionId: 'a',
					hint: String.raw`Factor the polynomial as $(x-2)(x-3)=0$.`,
					explanation: String.raw`The factors are $(x-2)(x-3)$, so the roots are $x=2$ and $x=3$.`,
					correctFeedback: {
						message: 'Exactly — the factor pairs lead to two real roots.'
					}
				}
			]
		}
	},
	'latex-3': {
		title: 'MCQ with display math',
		description: 'Definite integral prompt with display math in explanation.',
		quiz: {
			id: 'admin-latex-3',
			title: 'Definite integrals',
			description: 'Display math in prompt and explanation.',
			progressKey: 'admin-latex-3',
			topic: 'Calculus',
			questions: [
				{
					id: 'q-mcq-2',
					kind: 'multiple-choice',
					prompt: String.raw`Evaluate the definite integral
$$
\int_0^{\pi} \sin x \, dx.
$$
Choose the exact value.`,
					options: [
						{ id: 'a', label: 'A', text: String.raw`$0$` },
						{ id: 'b', label: 'B', text: String.raw`$1$` },
						{ id: 'c', label: 'C', text: String.raw`$2$` },
						{ id: 'd', label: 'D', text: String.raw`$-2$` }
					],
					correctOptionId: 'c',
					hint: String.raw`Use the antiderivative $-\cos x$.`,
					explanation: String.raw`Compute
$$
\int_0^{\pi} \sin x \, dx = [-\cos x]_0^{\pi} = 2.
$$`,
					correctFeedback: {
						message: 'Correct — the signed area from 0 to π equals 2.'
					}
				}
			]
		}
	},
	'code-1': {
		title: 'Python prompt + short answers',
		description: 'Multiline Python snippet in the prompt with concise responses.',
		quiz: {
			id: 'admin-code-1',
			title: 'Python lists',
			description: 'Code block rendering inside quiz prompts.',
			progressKey: 'admin-code-1',
			topic: 'Python',
			questions: [
				{
					id: 'q-code-1',
					kind: 'multiple-choice',
					prompt: [
						'Consider the Python code:',
						'',
						'```python',
						'data = [1, 2, 3]',
						'data.append(data[-1] * 2)',
						'data[1] = data[1] + data[0]',
						'print(data)',
						'```',
						'',
						'What is printed?'
					].join('\n'),
					options: [
						{ id: 'a', label: 'A', text: '[1, 3, 3, 6]' },
						{ id: 'b', label: 'B', text: '[1, 2, 3, 6]' },
						{ id: 'c', label: 'C', text: '[1, 3, 3, 4]' },
						{ id: 'd', label: 'D', text: '[1, 2, 4, 6]' }
					],
					correctOptionId: 'a',
					hint: 'Track the list after each line.',
					explanation:
						String.raw`After ` +
						'`append`' +
						`: \`[1, 2, 3, 6]\`. Then update index 1 to \`3\`, so the final list is \`[1, 3, 3, 6]\`.`,
					correctFeedback: {
						message: 'Yes — the append runs before the in-place update.'
					}
				},
				{
					id: 'q-code-2',
					kind: 'multiple-choice',
					prompt: [
						'Now consider this snippet:',
						'',
						'```python',
						'total = 0',
						'i = 0',
						'while i < 3:',
						'    total += i',
						'    i += 1',
						'print(total)',
						'```',
						'',
						'What is printed?'
					].join('\n'),
					options: [
						{ id: 'a', label: 'A', text: '3' },
						{ id: 'b', label: 'B', text: '6' },
						{ id: 'c', label: 'C', text: '4' },
						{ id: 'd', label: 'D', text: '2' }
					],
					correctOptionId: 'a',
					hint: 'Sum 0 + 1 + 2 before the loop exits.',
					explanation: 'The loop adds 0, 1, then 2. The total is 3.',
					correctFeedback: {
						message: 'Correct — indentation controls the loop body.'
					}
				}
			]
		}
	},
	'free-text-1': {
		title: 'Free-text math check',
		description: 'Type-answer prompt with LaTeX display blocks.',
		quiz: {
			id: 'admin-free-text-1',
			title: 'Number theory prompt',
			description: 'Type-answer rendering for LaTeX-heavy explanations.',
			progressKey: 'admin-free-text-1',
			topic: 'Number theory',
			questions: [
				{
					id: 'q-type-1',
					kind: 'type-answer',
					prompt: String.raw`For $k=11$, we need an 11-digit number $N$ such that:
$$N(10^{11}+1) \text{ is a square}.$$
Since $10^{11}+1 = 121\cdot (\text{Reduced } M)$, this becomes:
$$N\cdot (\text{Reduced } M) \text{ is a square}.$$
So we need:
$$N=(\text{Reduced } M)\cdot s^2.$$

If we choose $s=1$, is $N$ an 11-digit number?`,
					hint: 'Estimate the magnitude of $N$ before counting digits.',
					answer: 'No',
					correctFeedback: {
						message: 'Correct.'
					},
					explanation: String.raw`$N$ would be about $8.26\times 10^8$, which is only 9 digits. We need at least $10^{10}$.`
				}
			]
		}
	}
};

function withHtml(question: QuizQuestion): QuizQuestion {
	const promptHtml = renderMarkdownOptional(question.prompt);
	const hintHtml = renderMarkdownOptional(question.hint);
	const explanationHtml = renderMarkdownOptional(question.explanation);

	switch (question.kind) {
		case 'multiple-choice': {
			const options = question.options.map((option: QuizChoiceOption) => ({
				...option,
				textHtml: renderMarkdownOptional(option.text)
			}));
			return {
				...question,
				promptHtml,
				hintHtml,
				explanationHtml,
				options
			};
		}
		case 'type-answer': {
			return {
				...question,
				promptHtml,
				hintHtml,
				explanationHtml
			};
		}
		case 'info-card': {
			return {
				...question,
				promptHtml,
				hintHtml,
				explanationHtml,
				bodyHtml: renderMarkdownOptional(question.body)
			};
		}
	}
}

function withHtmlQuiz(quiz: QuizDefinition): QuizDefinition {
	return {
		...quiz,
		questions: quiz.questions.map((question) => withHtml(question))
	};
}

export const load: PageServerLoad = async ({ params }) => {
	const parsed = slugSchema.safeParse(params.slug);
	if (!parsed.success) {
		throw error(404, 'Unknown preview');
	}
	const slug = parsed.data;
	const preview = previews[slug];
	if (!preview) {
		throw error(404, 'Unknown preview');
	}
	return {
		slug,
		title: preview.title,
		description: preview.description,
		quiz: withHtmlQuiz(preview.quiz)
	};
};
