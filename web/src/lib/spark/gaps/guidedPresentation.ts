import type {
	SparkLearningGap,
	SparkLearningGapGuidedPresentation,
	SparkLearningGapStep
} from '@spark/schemas';

type GapInput = Pick<SparkLearningGap, 'cardQuestion' | 'steps'>;

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function freeTextSteps(
	steps: SparkLearningGapStep[]
): Extract<SparkLearningGapStep, { kind: 'free_text' }>[] {
	return steps.filter(
		(step): step is Extract<SparkLearningGapStep, { kind: 'free_text' }> =>
			step.kind === 'free_text'
	);
}

function modelAnswerStep(
	steps: SparkLearningGapStep[]
): Extract<SparkLearningGapStep, { kind: 'model_answer' }> | undefined {
	return steps.find(
		(step): step is Extract<SparkLearningGapStep, { kind: 'model_answer' }> =>
			step.kind === 'model_answer'
	);
}

function memoryChainStep(
	steps: SparkLearningGapStep[]
): Extract<SparkLearningGapStep, { kind: 'memory_chain' }> | undefined {
	return steps.find(
		(step): step is Extract<SparkLearningGapStep, { kind: 'memory_chain' }> =>
			step.kind === 'memory_chain'
	);
}

function fallbackFinalAnswer(gap: GapInput): string {
	const model = modelAnswerStep(gap.steps)?.body;
	if (model) {
		return model;
	}
	const freeTextModels = freeTextSteps(gap.steps).map((step) => step.modelAnswer);
	if (freeTextModels.length > 0) {
		return freeTextModels.join(' ');
	}
	return gap.cardQuestion;
}

function fallbackMemoryChain(gap: GapInput): string {
	const memory = memoryChainStep(gap.steps)?.body;
	if (memory) {
		return memory;
	}
	const labels = gap.steps
		.map((step) => step.label ?? '')
		.map((label) => normalizeWhitespace(label))
		.filter((label) => label.length > 0)
		.slice(0, 6);
	if (labels.length >= 2) {
		return labels.join(' -> ');
	}
	return freeTextSteps(gap.steps)
		.map((step) => step.expectedAnswer)
		.map((answer) => normalizeWhitespace(answer))
		.filter((answer) => answer.length > 0)
		.slice(0, 6)
		.join(' -> ');
}

function fallbackHint(index: number): string {
	if (index === 0) {
		return 'What fact from the question starts the chain?';
	}
	return 'Which change follows from the previous answer?';
}

export function fallbackGuidedPresentation(gap: GapInput): SparkLearningGapGuidedPresentation {
	const finalAnswer = fallbackFinalAnswer(gap);
	const questions = freeTextSteps(gap.steps)
		.slice(0, 8)
		.map((step, index) => ({
			id: `guided-${step.id || (index + 1).toString()}`,
			question: step.prompt,
			expectedAnswer: step.expectedAnswer,
			hint: fallbackHint(index),
			maxMarks: step.maxMarks
		}));
	const safeQuestions =
		questions.length >= 2
			? questions
			: [
					{
						id: 'guided-1',
						question: gap.cardQuestion,
						expectedAnswer: finalAnswer,
						hint: 'What key idea should the answer include?',
						maxMarks: 1
					},
					{
						id: 'guided-2',
						question: 'How should that idea be linked into a complete answer?',
						expectedAnswer: finalAnswer,
						hint: 'What cause-and-effect wording makes the answer clear?',
						maxMarks: 1
					}
				];
	return {
		question: gap.cardQuestion,
		instructions: 'Answer each guiding question in a short phrase.',
		questions: safeQuestions,
		memoryChain: fallbackMemoryChain(gap) || finalAnswer,
		answerPrompt: 'Now combine those ideas into a GCSE model answer.',
		modelAnswer: finalAnswer,
		maxMarks: Math.min(
			8,
			Math.max(
				1,
				safeQuestions.reduce((total, question) => total + (question.maxMarks ?? 1), 0)
			)
		)
	};
}
