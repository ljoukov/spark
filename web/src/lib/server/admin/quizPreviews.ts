import { renderMarkdownOptional } from '$lib/server/markdown';
import type { QuizChoiceOption, QuizDefinition, QuizQuestion } from '$lib/types/quiz';
import { z } from 'zod';

export const slugSchema = z.enum([
	'latex-1',
	'latex-2',
	'latex-3',
	'code-1',
	'free-text-1',
	'free-text-grading-1'
]);

export type PreviewSlug = z.infer<typeof slugSchema>;

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
			description: 'Type-answer rendering for LaTeX-heavy prompts.',
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
					marks: 3,
					markScheme:
						'1 mark: identify N is too small for 11 digits; 1 mark: estimate magnitude (~10^9); 1 mark: state need at least 10^10.',
					correctFeedback: {
						message: 'Correct.'
					}
				}
			]
		}
	},
	'free-text-grading-1': {
		title: 'Free-text grading (biology)',
		description: 'Multi-mark free-text with a mark scheme.',
		quiz: {
			id: 'admin-free-text-grading-1',
			title: 'Infection & response',
			description: 'Type-answer grading example with mark scheme bullets.',
			progressKey: 'admin-free-text-grading-1',
			topic: 'Biology',
			gradingPrompt: 'Use GCSE Biology standards and award marks per scheme.',
			questions: [
				{
					id: 'q-grade-1',
					kind: 'type-answer',
					prompt:
						'Compare the initial symptoms of HIV infection with the later stages of the disease (AIDS). Explain why there is a delay between infection and the onset of AIDS.',
					answer:
						'Initial HIV symptoms are often mild or flu-like (fever, sore throat, rash) or absent. In the later AIDS stage, the immune system is badly weakened so opportunistic infections and cancers occur, with severe symptoms and weight loss. The delay happens because HIV slowly destroys T helper cells over years; the immune system initially keeps the virus in check, and AIDS only develops once T cell levels fall very low.',
					hint: 'Contrast early flu-like symptoms with opportunistic infections, and link the delay to gradual T cell loss.',
					marks: 6,
					markScheme:
						'1 mark: early HIV symptoms are mild/flu-like or short-lived.\\n1 mark: HIV attacks immune system/T helper cells/white blood cells.\\n1 mark: viral load rises over time and T helper cells fall.\\n1 mark: AIDS stage involves opportunistic infections/cancers and severe symptoms.\\n1 mark: delay because immune system initially controls HIV.\\n1 mark: AIDS appears once immunity is too weak (very low T helper cell count).',
					correctFeedback: {
						message: 'Cover early symptoms, immune system decline, and opportunistic infections.'
					}
				}
			]
		}
	}
};

function withHtml(question: QuizQuestion): QuizQuestion {
	const promptHtml = renderMarkdownOptional(question.prompt);
	const hintHtml = renderMarkdownOptional(question.hint);
	const renderAnswer = (answer?: string) => {
		if (!answer) {
			return undefined;
		}
		const hasLatex = /\\[a-zA-Z]+/.test(answer);
		const hasDollar = answer.includes('$');
		const candidate = !hasDollar && hasLatex ? `$${answer}$` : answer;
		return renderMarkdownOptional(candidate);
	};
	const renderFeedback = (message: string) => renderMarkdownOptional(message);

	switch (question.kind) {
		case 'multiple-choice': {
			const options = question.options.map((option: QuizChoiceOption) => ({
				...option,
				textHtml: renderMarkdownOptional(option.text)
			}));
			const explanationHtml = renderMarkdownOptional(question.explanation);
			return {
				...question,
				promptHtml,
				hintHtml,
				explanationHtml,
				correctFeedback: {
					...question.correctFeedback,
					messageHtml: renderFeedback(question.correctFeedback.message)
				},
				options
			};
		}
		case 'type-answer': {
			return {
				...question,
				promptHtml,
				hintHtml,
				answerHtml: renderAnswer(question.answer),
				correctFeedback: {
					...question.correctFeedback,
					messageHtml: renderFeedback(question.correctFeedback.message)
				}
			};
		}
		case 'info-card': {
			return {
				...question,
				promptHtml,
				hintHtml,
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

export function getPreview(slug: PreviewSlug): PreviewEntry {
	return previews[slug];
}

export function getPreviewWithHtml(slug: PreviewSlug): PreviewEntry {
	const preview = previews[slug];
	return {
		...preview,
		quiz: withHtmlQuiz(preview.quiz)
	};
}
