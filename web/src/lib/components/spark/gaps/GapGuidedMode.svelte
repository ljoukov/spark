<script lang="ts">
	import { browser } from '$app/environment';
	import {
		AnnotatedTextPanel,
		type AnnotatedTextDocument,
		type AnnotatedTextTheme
	} from '$lib/components/annotated-text';
	import { MarkdownContent } from '$lib/components/markdown/index.js';
	import type {
		SparkLearningGapGuidedPresentation,
		SparkTutorGuidedGradeResult,
		SparkTutorGuidedState
	} from '@spark/schemas';
	import { tick, untrack } from 'svelte';
	import { z } from 'zod';

	type GuidedQuestion = SparkLearningGapGuidedPresentation['questions'][number];
	type GuidedPhase = 'questions' | 'memory' | 'compose' | 'feedback' | 'model';
	type JudgedStatus = 'correct' | 'partial' | 'incorrect';
	type GuidedFieldStatus = 'idle' | 'judging' | JudgedStatus | 'error';
	type GuidedFieldResult = {
		status: GuidedFieldStatus;
		feedback: string;
	};
	type GuidedFieldAttempt = {
		answer: string;
		result: JudgedStatus;
		feedback: string;
	};
	type GradeResult = SparkTutorGuidedGradeResult & { document: AnnotatedTextDocument };
	type Props = {
		gapId: string;
		subjectLabel: string;
		presentation: SparkLearningGapGuidedPresentation;
		initialState?: SparkTutorGuidedState | null;
		fieldGradeEndpoint?: string;
		finalGradeEndpoint?: string;
		modalLayout?: boolean;
		showStageNavigation?: boolean;
		copyGuard?: boolean;
		phase?: GuidedPhase;
		onPhaseChange?: (phase: GuidedPhase) => void;
		onProgressChange?: (state: SparkTutorGuidedState) => void;
		onDone: () => void;
	};

	const annotationSchema = z.object({
		id: z.string().min(1),
		start: z.number().int().nonnegative(),
		end: z.number().int().nonnegative(),
		type: z.string().min(1),
		label: z.string().min(1),
		comment: z.string().min(1)
	});
	const annotationTypeSchema = z.object({
		label: z.string().optional(),
		lightColor: z.string().min(1),
		lightBackground: z.string().min(1),
		lightBorderColor: z.string().min(1),
		darkColor: z.string().min(1),
		darkBackground: z.string().min(1),
		darkBorderColor: z.string().min(1)
	});
	const annotatedDocumentSchema = z.object({
		heading: z.string().min(1),
		description: z.string().min(1),
		text: z.string(),
		annotations: z.array(annotationSchema),
		annotationTypes: z.record(z.string(), annotationTypeSchema)
	});
	const guidedGradeResponseSchema = z.object({
		status: z.literal('ok'),
		awardedMarks: z.number().int().nonnegative(),
		maxMarks: z.number().int().positive(),
		summary: z.string().min(1),
		document: annotatedDocumentSchema
	});
	const guidedFieldGradeResponseSchema = z.object({
		status: z.literal('ok'),
		result: z.enum(['correct', 'partial', 'incorrect']),
		feedback: z.string().min(1)
	});

	let {
		gapId,
		subjectLabel,
		presentation,
		initialState = null,
		fieldGradeEndpoint,
		finalGradeEndpoint,
		modalLayout = false,
		showStageNavigation = false,
		copyGuard = false,
		phase = $bindable<GuidedPhase>('questions'),
		onPhaseChange,
		onProgressChange,
		onDone
	}: Props = $props();

	let answers = $state<Record<string, string>>({});
	let fieldResults = $state<Record<string, GuidedFieldResult>>({});
	let lastChecked = $state<Record<string, string>>({});
	let fieldAttempts = $state<Record<string, GuidedFieldAttempt[]>>({});
	let writtenAnswer = $state('');
	let gradeResult = $state<GradeResult | null>(null);
	let grading = $state(false);
	let errorMessage = $state('');
	let theme = $state<AnnotatedTextTheme>('light');
	let lastPresentationKey = $state('');
	let maxVisitedPhaseIndex = $state(0);

	const presentationKey = $derived(
		`${gapId}:${presentation.questions.map((question) => question.id).join('|')}`
	);
	const answeredAllQuestions = $derived(
		presentation.questions.every((question) => answerValue(question.id).trim().length > 0)
	);
	const judgingGuidedFields = $derived(
		presentation.questions.some((question) => fieldResultFor(question.id).status === 'judging')
	);
	const writtenAnswerReady = $derived(writtenAnswer.trim().length > 0);
	const fullMarks = $derived(
		gradeResult ? gradeResult.awardedMarks >= gradeResult.maxMarks : false
	);
	const phaseOrder: GuidedPhase[] = ['questions', 'memory', 'compose', 'feedback', 'model'];
	const currentPhaseIndex = $derived(phaseIndex(phase));
	const canGoPreviousStage = $derived(currentPhaseIndex > 0);
	const canGoNextVisitedStage = $derived(currentPhaseIndex < maxVisitedPhaseIndex);
	const memoryParts = $derived(
		presentation.memoryChain
			.split(/\s*(?:->|→|;|\|)\s*/u)
			.map((part) => part.trim())
			.filter((part) => part.length > 0)
	);

	$effect(() => {
		const key = presentationKey;
		if (key !== lastPresentationKey) {
			resetState();
			lastPresentationKey = key;
		}
	});

	$effect(() => {
		const nextPhase = phase;
		untrack(() => {
			onPhaseChange?.(nextPhase);
		});
	});

	$effect(() => {
		const progressState: SparkTutorGuidedState = {
			phase,
			maxVisitedPhaseIndex,
			answers,
			writtenAnswer,
			fieldResults,
			lastChecked,
			fieldAttempts,
			gradeResult
		};
		untrack(() => {
			onProgressChange?.(progressState);
		});
	});

	$effect(() => {
		if (!browser) {
			return;
		}

		const updateTheme = (): void => {
			const explicitTheme = document.documentElement.getAttribute('data-theme');
			if (explicitTheme === 'light') {
				theme = 'light';
				return;
			}
			if (explicitTheme === 'dark') {
				theme = 'dark';
				return;
			}
			theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		};

		updateTheme();
		const observer = new MutationObserver(() => {
			updateTheme();
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme', 'class']
		});
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		media.addEventListener('change', updateTheme);
		return () => {
			observer.disconnect();
			media.removeEventListener('change', updateTheme);
		};
	});

	function createAnswerMap(): Record<string, string> {
		return Object.fromEntries(presentation.questions.map((question) => [question.id, '']));
	}

	function createFieldResultMap(): Record<string, GuidedFieldResult> {
		return Object.fromEntries(
			presentation.questions.map((question): [string, GuidedFieldResult] => [
				question.id,
				{ status: 'idle', feedback: '' }
			])
		);
	}

	function createFieldAttemptMap(): Record<string, GuidedFieldAttempt[]> {
		return Object.fromEntries(
			presentation.questions.map((question): [string, GuidedFieldAttempt[]] => [question.id, []])
		);
	}

	function resetState(): void {
		const initialAnswers = initialState?.answers ?? {};
		const initialFieldResults = initialState?.fieldResults ?? {};
		const initialLastChecked = initialState?.lastChecked ?? {};
		const initialFieldAttempts = initialState?.fieldAttempts ?? {};
		answers = { ...createAnswerMap(), ...initialAnswers };
		fieldResults = { ...createFieldResultMap(), ...initialFieldResults };
		lastChecked = { ...createAnswerMap(), ...initialLastChecked };
		fieldAttempts = { ...createFieldAttemptMap(), ...initialFieldAttempts };
		writtenAnswer = initialState?.writtenAnswer ?? '';
		gradeResult = initialState?.gradeResult ?? null;
		grading = false;
		errorMessage = '';
		maxVisitedPhaseIndex = Math.max(initialState?.maxVisitedPhaseIndex ?? 0, phaseIndex(phase));
	}

	function answerValue(questionId: string): string {
		return answers[questionId] ?? '';
	}

	function fieldResultFor(questionId: string): GuidedFieldResult {
		return fieldResults[questionId] ?? { status: 'idle', feedback: '' };
	}

	function fieldAttemptsFor(questionId: string): GuidedFieldAttempt[] {
		return fieldAttempts[questionId] ?? [];
	}

	function setFieldResult(questionId: string, result: GuidedFieldResult): void {
		fieldResults = { ...fieldResults, [questionId]: result };
	}

	function updateAnswer(questionId: string, value: string): void {
		answers = { ...answers, [questionId]: value };
		if (lastChecked[questionId] !== value.trim()) {
			setFieldResult(questionId, { status: 'idle', feedback: '' });
		}
	}

	function recordFieldAttempt(questionId: string, attempt: GuidedFieldAttempt): void {
		const current = fieldAttemptsFor(questionId);
		const lastAttempt = current[current.length - 1];
		if (
			lastAttempt?.answer === attempt.answer &&
			lastAttempt.result === attempt.result &&
			lastAttempt.feedback === attempt.feedback
		) {
			return;
		}
		fieldAttempts = {
			...fieldAttempts,
			[questionId]: [...current, attempt].slice(-6)
		};
	}

	function inputId(questionId: string): string {
		return `gap-guided-${gapId}-${questionId}`;
	}

	function phaseIndex(value: GuidedPhase): number {
		const index = phaseOrder.indexOf(value);
		return index === -1 ? 0 : index;
	}

	function setGuidedPhase(value: GuidedPhase): void {
		phase = value;
		maxVisitedPhaseIndex = Math.max(maxVisitedPhaseIndex, phaseIndex(value));
		errorMessage = '';
	}

	function goPreviousStage(): void {
		if (!canGoPreviousStage) {
			return;
		}
		setGuidedPhase(phaseOrder[currentPhaseIndex - 1] ?? 'questions');
	}

	function goNextVisitedStage(): void {
		if (!canGoNextVisitedStage) {
			return;
		}
		setGuidedPhase(phaseOrder[currentPhaseIndex + 1] ?? phase);
	}

	function blockClipboard(event: ClipboardEvent): void {
		if (!copyGuard) {
			return;
		}
		event.preventDefault();
	}

	async function judgeGuidedField(questionId: string): Promise<GuidedFieldStatus> {
		const answer = answerValue(questionId).trim();
		if (!answer) {
			setFieldResult(questionId, { status: 'idle', feedback: '' });
			return 'idle';
		}

		const previous = fieldResultFor(questionId);
		if (
			lastChecked[questionId] === answer &&
			previous.status !== 'idle' &&
			previous.status !== 'error' &&
			previous.status !== 'judging'
		) {
			return previous.status;
		}

		setFieldResult(questionId, { status: 'judging', feedback: 'Checking...' });

		try {
			const response = await fetch(
				fieldGradeEndpoint ?? `/api/spark/gaps/${gapId}/guided-field-grade`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						questionId,
						answer,
						answers,
						previousAttempts: fieldAttemptsFor(questionId)
					})
				}
			);
			if (!response.ok) {
				throw new Error(`Guided field grade request failed with ${response.status.toString()}`);
			}
			const parsed = guidedFieldGradeResponseSchema.parse(await response.json());
			setFieldResult(questionId, { status: parsed.result, feedback: parsed.feedback });
			lastChecked = { ...lastChecked, [questionId]: answer };
			recordFieldAttempt(questionId, {
				answer,
				result: parsed.result,
				feedback: parsed.feedback
			});
			return parsed.result;
		} catch (error) {
			console.error('Failed to grade guided field answer', error);
			setFieldResult(questionId, {
				status: 'error',
				feedback: 'Could not check this answer.'
			});
			return 'error';
		}
	}

	async function focusGuidedField(questionId: string): Promise<void> {
		await tick();
		document.getElementById(inputId(questionId))?.focus();
	}

	async function handleFieldKeydown(
		event: KeyboardEvent,
		question: GuidedQuestion,
		index: number
	): Promise<void> {
		if (event.key !== 'Enter') {
			return;
		}
		event.preventDefault();
		await judgeGuidedField(question.id);
		const nextQuestion = presentation.questions[index + 1];
		if (nextQuestion) {
			await focusGuidedField(nextQuestion.id);
			return;
		}
		if (answeredAllQuestions) {
			await goToMemory();
		}
	}

	async function goToMemory(event?: SubmitEvent): Promise<void> {
		event?.preventDefault();
		if (!answeredAllQuestions || judgingGuidedFields) {
			return;
		}
		for (const question of presentation.questions) {
			await judgeGuidedField(question.id);
		}
		setGuidedPhase('memory');
	}

	function goToCompose(): void {
		setGuidedPhase('compose');
	}

	function retryAnswer(): void {
		setGuidedPhase('compose');
		errorMessage = '';
		gradeResult = null;
	}

	async function submitWrittenAnswer(event?: SubmitEvent): Promise<void> {
		event?.preventDefault();
		const answer = writtenAnswer.trim();
		if (!answer || grading) {
			return;
		}
		grading = true;
		errorMessage = '';
		try {
			const response = await fetch(finalGradeEndpoint ?? `/api/spark/gaps/${gapId}/guided-grade`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					answer,
					guidedAnswers: answers
				})
			});
			if (!response.ok) {
				throw new Error(`Guided grade request failed with ${response.status.toString()}`);
			}
			const parsed = guidedGradeResponseSchema.parse(await response.json());
			gradeResult = {
				awardedMarks: parsed.awardedMarks,
				maxMarks: parsed.maxMarks,
				summary: parsed.summary,
				document: parsed.document
			};
			setGuidedPhase('feedback');
		} catch (error) {
			console.error('Failed to grade guided gap answer', error);
			errorMessage = 'Could not check this answer right now. Try again in a moment.';
		} finally {
			grading = false;
		}
	}

	function fieldInputClass(questionId: string): string {
		return `gap-guided-short-input gap-guided-short-input--${fieldResultFor(questionId).status}`;
	}

	function fieldFeedbackText(question: GuidedQuestion): string {
		const result = fieldResultFor(question.id);
		if (result.status === 'idle') {
			return plainSingleLine(question.hint ?? '');
		}
		if (result.status === 'judging') {
			return 'Checking...';
		}
		return plainSingleLine(result.feedback);
	}

	function plainSingleLine(value: string): string {
		return value.replace(/\s+/g, ' ').trim();
	}
</script>

<section
	class={`gap-guided-stage ${modalLayout ? 'is-modal' : ''} ${copyGuard ? 'is-copy-guarded' : ''}`}
	oncopy={blockClipboard}
	oncut={blockClipboard}
	onpaste={blockClipboard}
>
	<div class="gap-guided-card">
		<header class="gap-guided-header">
			<div>
				<span>{subjectLabel}</span>
				<div class="gap-guided-title" role="heading" aria-level="1">
					<MarkdownContent markdown={presentation.question} />
				</div>
			</div>
			{#if showStageNavigation}
				<div class="gap-guided-header-actions" aria-label="Answer-builder navigation">
					<button
						type="button"
						class="gap-guided-nav-button"
						disabled={!canGoPreviousStage}
						aria-label="Previous step"
						onclick={goPreviousStage}
					>
						&lt;
					</button>
					<button
						type="button"
						class="gap-guided-nav-button"
						disabled={!canGoNextVisitedStage}
						aria-label="Next visited step"
						onclick={goNextVisitedStage}
					>
						&gt;
					</button>
				</div>
			{/if}
		</header>

		<div class="gap-guided-body">
			{#if phase === 'questions'}
				<div class="gap-guided-section-bar">
					<strong>Build the answer</strong>
					<span>{answeredAllQuestions ? 'Ready' : 'In progress'}</span>
				</div>

				<form class="gap-guided-questions" onsubmit={(event) => void goToMemory(event)}>
					{#each presentation.questions as question, index (question.id)}
						<label class="gap-guided-question" for={inputId(question.id)}>
							<span class="gap-guided-number">{(index + 1).toString()}</span>
							<div class="gap-guided-question-body">
								<div class="gap-guided-question-text">
									<MarkdownContent markdown={question.question} />
								</div>
								<textarea
									id={inputId(question.id)}
									class={fieldInputClass(question.id)}
									rows="1"
									value={answerValue(question.id)}
									oninput={(event) => {
										updateAnswer(question.id, (event.currentTarget as HTMLTextAreaElement).value);
									}}
									onblur={() => {
										void judgeGuidedField(question.id);
									}}
									onkeydown={(event) => {
										void handleFieldKeydown(event, question, index);
									}}
									placeholder="Type a short answer"
									aria-label={plainSingleLine(question.question)}
								></textarea>
								<small
									class={`gap-guided-field-feedback gap-guided-field-feedback--${fieldResultFor(question.id).status}`}
								>
									{fieldFeedbackText(question)}
								</small>
							</div>
						</label>
					{/each}

					<footer class="gap-guided-footer">
						<span>
							{judgingGuidedFields
								? 'Checking your answer...'
								: answeredAllQuestions
									? 'All parts are filled.'
									: 'Fill every field to continue.'}
						</span>
						<button
							class="gap-guided-button"
							disabled={!answeredAllQuestions || judgingGuidedFields}
						>
							{judgingGuidedFields ? 'Checking' : 'Next'}
						</button>
					</footer>
				</form>
			{:else if phase === 'memory'}
				<section class="gap-guided-objective">
					<span>Memory chain</span>
					<p>Keep this short chain in mind before writing the full answer.</p>
				</section>

				<div class="gap-guided-memory">
					{#if memoryParts.length > 1}
						{#each memoryParts as part, index (`memory-${index}`)}
							<span>{part}</span>
						{/each}
					{:else}
						<p>{presentation.memoryChain}</p>
					{/if}
				</div>

				<footer class="gap-guided-footer">
					<span>Now turn the chain into full sentences.</span>
					<button class="gap-guided-button" type="button" onclick={goToCompose}>Next</button>
				</footer>
			{:else if phase === 'compose'}
				<section class="gap-guided-objective">
					<span>Write your answer</span>
					<p>{presentation.answerPrompt ?? 'Now combine those ideas into a GCSE model answer.'}</p>
				</section>

				<form class="gap-guided-compose" onsubmit={submitWrittenAnswer}>
					<label for={`gap-guided-answer-${gapId}`}>Your answer</label>
					<textarea
						id={`gap-guided-answer-${gapId}`}
						class="gap-guided-answer-input"
						rows="5"
						value={writtenAnswer}
						oninput={(event) => {
							writtenAnswer = (event.currentTarget as HTMLTextAreaElement).value;
						}}
						placeholder="Write the answer in complete sentences."
						aria-describedby={errorMessage ? `gap-guided-error-${gapId}` : undefined}
					></textarea>
					{#if errorMessage}
						<p id={`gap-guided-error-${gapId}`} class="gap-guided-error">{errorMessage}</p>
					{/if}
					<footer class="gap-guided-footer">
						<span
							>{grading
								? 'Checking your answer...'
								: 'Use the memory chain, but write naturally.'}</span
						>
						<button class="gap-guided-button" disabled={!writtenAnswerReady || grading}>
							{grading ? 'Checking' : 'Check answer'}
						</button>
					</footer>
				</form>
			{:else if phase === 'feedback' && gradeResult}
				<section class="gap-guided-objective">
					<span>Your feedback</span>
					<p>
						{gradeResult.summary}
						<strong>{gradeResult.awardedMarks.toString()}/{gradeResult.maxMarks.toString()}</strong>
					</p>
				</section>

				<div class="gap-guided-feedback-panel">
					<AnnotatedTextPanel document={gradeResult.document} {theme} />
				</div>

				<footer class="gap-guided-footer">
					<span
						>{fullMarks ? 'That is a full-mark answer.' : 'Use the notes, then improve it.'}</span
					>
					{#if fullMarks}
						<button
							class="gap-guided-button"
							type="button"
							onclick={() => {
								setGuidedPhase('model');
							}}
						>
							Next
						</button>
					{:else}
						<button class="gap-guided-button" type="button" onclick={retryAnswer}>Try again</button>
					{/if}
				</footer>
			{:else}
				<section class="gap-guided-objective">
					<span>Model answer</span>
					<p>Compare your final version with this model answer.</p>
				</section>

				<aside class="gap-guided-model">
					<span>Model answer</span>
					<p>{presentation.modelAnswer}</p>
				</aside>

				<footer class="gap-guided-footer">
					<span>Done for this gap.</span>
					<button class="gap-guided-button" type="button" onclick={onDone}>Done</button>
				</footer>
			{/if}
		</div>
	</div>
</section>

<style>
	.gap-guided-stage {
		width: min(1040px, calc(100% - 48px));
		min-height: 100dvh;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top, 0px) + 4.55rem) 0 2rem;
		color: #17211b;
	}

	.gap-guided-stage.is-modal {
		width: 100%;
		min-height: 0;
		padding: 0;
	}

	.gap-guided-stage.is-copy-guarded {
		-webkit-user-select: none;
		user-select: none;
	}

	.gap-guided-stage.is-copy-guarded textarea {
		-webkit-user-select: text;
		user-select: text;
	}

	.gap-guided-card {
		--sheet-color: #27745d;
		--sheet-color-08: rgba(39, 116, 93, 0.08);
		--sheet-color-14: rgba(39, 116, 93, 0.14);
		--sheet-color-30: rgba(39, 116, 93, 0.3);
		--sheet-color-60: rgba(39, 116, 93, 0.6);
		width: min(980px, 100%);
		margin: 0 auto;
		overflow: hidden;
		border: 1px solid rgba(23, 33, 27, 0.16);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.96);
		box-shadow: 0 22px 70px -48px rgba(15, 23, 42, 0.5);
	}

	.gap-guided-stage.is-modal .gap-guided-card {
		width: 100%;
		box-shadow: none;
	}

	.gap-guided-header {
		position: relative;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		overflow: hidden;
		padding: 1.2rem 2rem 1.1rem;
		background: var(--sheet-color);
		color: #ffffff;
	}

	.gap-guided-header-actions {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex: 0 0 auto;
	}

	.gap-guided-nav-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.15rem;
		height: 2.15rem;
		border: 1px solid rgba(255, 255, 255, 0.34);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.14);
		color: #ffffff;
		font: inherit;
		font-size: 1.05rem;
		font-weight: 900;
		line-height: 1;
		cursor: pointer;
	}

	.gap-guided-nav-button:disabled {
		cursor: not-allowed;
		opacity: 0.42;
	}

	.gap-guided-header::before,
	.gap-guided-header::after {
		content: '';
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
	}

	.gap-guided-header::before {
		top: -34px;
		right: -30px;
		width: 118px;
		height: 118px;
	}

	.gap-guided-header::after {
		right: 60px;
		bottom: -24px;
		width: 82px;
		height: 82px;
		background: rgba(255, 255, 255, 0.06);
	}

	.gap-guided-header > * {
		position: relative;
		z-index: 1;
	}

	.gap-guided-header span,
	.gap-guided-objective span,
	.gap-guided-model span {
		display: block;
		font-size: 0.94rem;
		font-weight: 700;
	}

	.gap-guided-header span {
		margin-bottom: 0.35rem;
		color: rgba(255, 255, 255, 0.72);
	}

	.gap-guided-title {
		font-size: clamp(1.18rem, 1.7vw, 1.55rem);
		font-weight: 400;
		line-height: 1.28;
		overflow-wrap: anywhere;
		--markdown-heading: #ffffff;
		--markdown-link: #ffffff;
		--markdown-strong: #ffffff;
		--markdown-text: #ffffff;
	}

	.gap-guided-title :global(.markdown-content) {
		font-weight: 400;
		line-height: 1.28;
	}

	.gap-guided-title :global(.markdown-content > * + *) {
		margin-top: 0.5rem;
	}

	.gap-guided-title :global(.markdown-content h1),
	.gap-guided-title :global(.markdown-content h2),
	.gap-guided-title :global(.markdown-content h3),
	.gap-guided-title :global(.markdown-content h4) {
		margin: 0;
		font-size: 1em;
		font-weight: 500;
		line-height: 1.28;
	}

	.gap-guided-title :global(.markdown-content p) {
		margin: 0;
	}

	.gap-guided-title :global(.markdown-content strong) {
		font-weight: 500;
	}

	.gap-guided-title :global(.markdown-content .katex-display) {
		margin: 0.45rem 0 0;
	}

	.gap-guided-title :global(.markdown-content .katex) {
		font-size: 0.98em;
	}

	.gap-guided-body {
		padding: 1.2rem 2rem 1.45rem;
	}

	.gap-guided-objective {
		margin-bottom: 0.85rem;
		padding-left: 1rem;
		border-left: 4px solid var(--sheet-color);
	}

	.gap-guided-objective span {
		margin-bottom: 0.15rem;
		color: var(--sheet-color);
	}

	.gap-guided-objective p {
		margin: 0;
		font-size: 0.94rem;
		line-height: 1.55;
	}

	.gap-guided-objective strong {
		display: inline-block;
		margin-left: 0.45rem;
		color: var(--sheet-color);
		font-weight: 800;
	}

	.gap-guided-section-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border: 1.5px solid var(--sheet-color-30);
		border-bottom: 0;
		border-radius: 8px 8px 0 0;
		background: var(--sheet-color-14);
		padding: 0.75rem 1.1rem;
		font-size: 0.94rem;
	}

	.gap-guided-section-bar strong {
		font-weight: 700;
	}

	.gap-guided-section-bar span {
		color: rgba(23, 33, 27, 0.66);
	}

	.gap-guided-questions {
		border: 1.5px solid var(--sheet-color-30);
		border-radius: 0 0 8px 8px;
		background: #ffffff;
	}

	.gap-guided-question {
		display: grid;
		grid-template-columns: 48px minmax(0, 1fr);
		column-gap: 0.75rem;
		align-items: start;
		padding: 0.82rem 1.1rem;
		border-bottom: 1px dashed rgba(23, 33, 27, 0.13);
	}

	.gap-guided-question:last-of-type {
		border-bottom: 0;
	}

	.gap-guided-number {
		display: inline-flex;
		width: 28px;
		height: 28px;
		align-items: center;
		justify-content: center;
		margin-top: 0.1rem;
		border-radius: 999px;
		background: var(--sheet-color);
		color: #ffffff;
		font-size: 14px;
		font-weight: 800;
		line-height: 1;
	}

	.gap-guided-question-body {
		display: grid;
		min-width: 0;
		grid-template-columns: minmax(12rem, 0.95fr) minmax(13rem, 1fr);
		gap: 0.5rem 0.9rem;
		align-items: start;
	}

	.gap-guided-question-text {
		font-size: 1rem;
		font-weight: 400;
		line-height: 1.45;
		--markdown-heading: #17211b;
		--markdown-link: var(--sheet-color);
		--markdown-strong: #17211b;
		--markdown-text: #17211b;
	}

	.gap-guided-question-text :global(.markdown-content) {
		font-weight: 400;
		line-height: 1.45;
	}

	.gap-guided-question-text :global(.markdown-content > * + *) {
		margin-top: 0.38rem;
	}

	.gap-guided-question-text :global(.markdown-content h1),
	.gap-guided-question-text :global(.markdown-content h2),
	.gap-guided-question-text :global(.markdown-content h3),
	.gap-guided-question-text :global(.markdown-content h4) {
		margin: 0;
		font-size: 1em;
		font-weight: 600;
		line-height: 1.4;
	}

	.gap-guided-question-text :global(.markdown-content p) {
		margin: 0;
	}

	.gap-guided-question-text :global(.markdown-content strong) {
		font-weight: 600;
	}

	.gap-guided-question-text :global(.markdown-content .katex-display) {
		margin: 0.35rem 0;
	}

	.gap-guided-question-text :global(.markdown-content .katex) {
		font-size: 0.98em;
	}

	.gap-guided-field-feedback {
		display: block;
		grid-column: 2;
		min-height: 1.45rem;
		color: rgba(23, 33, 27, 0.62);
		font-size: 0.78rem;
		font-weight: 550;
		line-height: 1.35;
	}

	.gap-guided-short-input,
	.gap-guided-answer-input {
		width: 100%;
		border: 0;
		border-bottom: 2px solid var(--sheet-color-60);
		border-radius: 4px 4px 0 0;
		background: rgba(255, 255, 255, 0.62);
		color: #17211b;
		font: inherit;
		line-height: 1.4;
		resize: vertical;
		transition:
			background 0.18s ease,
			border-color 0.18s ease,
			color 0.18s ease;
	}

	.gap-guided-short-input {
		min-height: 2.5rem;
		padding: 0.42rem 0.5rem 0.34rem;
		font-weight: 550;
		field-sizing: content;
		overflow: hidden;
		resize: none;
	}

	.gap-guided-answer-input {
		min-height: 10rem;
		border: 2px solid rgba(39, 116, 93, 0.28);
		border-radius: 8px;
		padding: 0.85rem 1rem;
		background: #ffffff;
		box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.04);
	}

	.gap-guided-short-input::placeholder,
	.gap-guided-answer-input::placeholder {
		color: rgba(23, 33, 27, 0.58);
		opacity: 1;
	}

	.gap-guided-short-input:focus,
	.gap-guided-answer-input:focus {
		border-color: var(--sheet-color);
		background: var(--sheet-color-08);
		box-shadow: none;
		outline: 2px solid rgba(39, 116, 93, 0.16);
		outline-offset: 2px;
	}

	.gap-guided-short-input--judging {
		border-color: #36587a;
		background: #eef6fa;
		color: #284863;
	}

	.gap-guided-short-input--correct {
		border-color: #1f8d62;
		background: #edf9f3;
		color: #176444;
	}

	.gap-guided-short-input--partial {
		border-color: #a76b16;
		background: #fff7df;
		color: #765014;
	}

	.gap-guided-short-input--incorrect,
	.gap-guided-short-input--error {
		border-color: #ad4d33;
		background: #fff0eb;
		color: #8b3d28;
	}

	.gap-guided-field-feedback--correct {
		color: #1f8d62;
	}

	.gap-guided-field-feedback--partial {
		color: #a76b16;
	}

	.gap-guided-field-feedback--incorrect,
	.gap-guided-field-feedback--error {
		color: #ad4d33;
	}

	.gap-guided-memory {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem 1.12rem;
		align-items: center;
		border: 1.5px solid var(--sheet-color-30);
		border-radius: 8px;
		background: #ffffff;
		padding: 1.15rem;
	}

	.gap-guided-memory span {
		position: relative;
		display: inline-flex;
		align-items: center;
		min-height: 2.5rem;
		border: 1.5px solid var(--sheet-color-30);
		border-radius: 8px;
		background: var(--sheet-color-08);
		color: #17211b;
		padding: 0.48rem 0.75rem;
		font-weight: 800;
		line-height: 1.25;
	}

	.gap-guided-memory span:not(:last-child)::after {
		content: '→';
		position: absolute;
		right: -0.98rem;
		color: var(--sheet-color);
		font-weight: 900;
	}

	.gap-guided-memory p {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		line-height: 1.55;
	}

	.gap-guided-compose {
		display: grid;
		gap: 0.6rem;
	}

	.gap-guided-compose label {
		color: var(--sheet-color);
		font-size: 0.88rem;
		font-weight: 800;
	}

	.gap-guided-feedback-panel {
		border: 1.5px solid var(--sheet-color-30);
		border-radius: 8px;
		background: #ffffff;
		padding: 1rem;
	}

	.gap-guided-error {
		margin: 0;
		color: #ad4d33;
		font-size: 0.9rem;
		font-weight: 700;
	}

	.gap-guided-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.05rem;
		padding: 0.8rem 1.1rem 0.95rem;
		border-top: 1px solid #dfe7e1;
		color: rgba(23, 33, 27, 0.66);
		font-size: 0.94rem;
	}

	.gap-guided-button {
		margin-left: auto;
		min-height: 40px;
		min-width: 116px;
		border: 0;
		border-radius: 8px;
		background: var(--sheet-color);
		color: #ffffff;
		padding: 0 1rem;
		font: inherit;
		font-size: 0.94rem;
		font-weight: 700;
		box-shadow: 0 3px 12px var(--sheet-color-30);
		cursor: pointer;
	}

	.gap-guided-button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.gap-guided-model {
		margin-top: 1.2rem;
		padding: 1rem 1.1rem;
		border: 1.5px solid #1f8d62;
		border-radius: 8px;
		background: #edf9f3;
	}

	.gap-guided-model span {
		margin-bottom: 0.35rem;
		color: #176444;
	}

	.gap-guided-model p {
		margin: 0;
		font-size: 1rem;
		line-height: 1.55;
	}

	:global([data-theme='dark'] .gap-guided-card),
	:global(:root:not([data-theme='light']) .gap-guided-card) {
		--sheet-color: #68c79d;
		--sheet-color-08: rgba(104, 199, 157, 0.08);
		--sheet-color-14: rgba(104, 199, 157, 0.14);
		--sheet-color-30: rgba(104, 199, 157, 0.3);
		--sheet-color-60: rgba(104, 199, 157, 0.6);
		border-color: rgba(126, 208, 167, 0.16);
		background: #18211c;
		color: #f4f1ea;
	}

	:global([data-theme='dark'] .gap-guided-header),
	:global(:root:not([data-theme='light']) .gap-guided-header) {
		background: #247257;
	}

	:global([data-theme='dark'] .gap-guided-questions),
	:global(:root:not([data-theme='light']) .gap-guided-questions),
	:global([data-theme='dark'] .gap-guided-memory),
	:global(:root:not([data-theme='light']) .gap-guided-memory),
	:global([data-theme='dark'] .gap-guided-feedback-panel),
	:global(:root:not([data-theme='light']) .gap-guided-feedback-panel) {
		border-color: rgba(104, 199, 157, 0.34);
		background: #111713;
	}

	:global([data-theme='dark'] .gap-guided-section-bar),
	:global(:root:not([data-theme='light']) .gap-guided-section-bar) {
		border-color: rgba(104, 199, 157, 0.34);
		background: rgba(104, 199, 157, 0.14);
	}

	:global([data-theme='dark'] .gap-guided-question),
	:global(:root:not([data-theme='light']) .gap-guided-question) {
		border-bottom-color: rgba(126, 208, 167, 0.14);
	}

	:global([data-theme='dark'] .gap-guided-short-input),
	:global(:root:not([data-theme='light']) .gap-guided-short-input),
	:global([data-theme='dark'] .gap-guided-answer-input),
	:global(:root:not([data-theme='light']) .gap-guided-answer-input) {
		border-color: rgba(104, 199, 157, 0.58);
		background: #111713;
		background-color: #111713;
		color: #f4f1ea;
		color-scheme: dark;
	}

	:global([data-theme='dark']) .gap-guided-short-input,
	:global(:root:not([data-theme='light'])) .gap-guided-short-input,
	:global([data-theme='dark']) .gap-guided-answer-input,
	:global(:root:not([data-theme='light'])) .gap-guided-answer-input {
		border-color: rgba(104, 199, 157, 0.58);
		background: #111713;
		background-color: #111713;
		color: #f4f1ea;
		color-scheme: dark;
	}

	:global([data-theme='dark'] .gap-guided-short-input::placeholder),
	:global(:root:not([data-theme='light']) .gap-guided-short-input::placeholder),
	:global([data-theme='dark'] .gap-guided-answer-input::placeholder),
	:global(:root:not([data-theme='light']) .gap-guided-answer-input::placeholder) {
		color: rgba(216, 226, 218, 0.7);
	}

	:global([data-theme='dark']) .gap-guided-short-input::placeholder,
	:global(:root:not([data-theme='light'])) .gap-guided-short-input::placeholder,
	:global([data-theme='dark']) .gap-guided-answer-input::placeholder,
	:global(:root:not([data-theme='light'])) .gap-guided-answer-input::placeholder {
		color: rgba(216, 226, 218, 0.7);
	}

	:global([data-theme='dark'] .gap-guided-short-input:focus),
	:global(:root:not([data-theme='light']) .gap-guided-short-input:focus),
	:global([data-theme='dark'] .gap-guided-answer-input:focus),
	:global(:root:not([data-theme='light']) .gap-guided-answer-input:focus) {
		background: rgba(104, 199, 157, 0.1);
		outline-color: rgba(104, 199, 157, 0.22);
	}

	:global([data-theme='dark'] .gap-guided-short-input--judging),
	:global(:root:not([data-theme='light']) .gap-guided-short-input--judging) {
		border-color: #6aa5c8;
		background: rgba(59, 130, 168, 0.14);
		color: #d7eef8;
	}

	:global([data-theme='dark'] .gap-guided-short-input--correct),
	:global(:root:not([data-theme='light']) .gap-guided-short-input--correct) {
		border-color: #6fd29f;
		background: rgba(31, 141, 98, 0.16);
		color: #d8f8e6;
	}

	:global([data-theme='dark'] .gap-guided-short-input--partial),
	:global(:root:not([data-theme='light']) .gap-guided-short-input--partial) {
		border-color: #d8a64b;
		background: rgba(167, 107, 22, 0.17);
		color: #ffe3a3;
	}

	:global([data-theme='dark'] .gap-guided-short-input--incorrect),
	:global(:root:not([data-theme='light']) .gap-guided-short-input--incorrect),
	:global([data-theme='dark'] .gap-guided-short-input--error),
	:global(:root:not([data-theme='light']) .gap-guided-short-input--error) {
		border-color: #dc795f;
		background: rgba(173, 77, 51, 0.18);
		color: #ffd6ca;
	}

	:global([data-theme='dark'] .gap-guided-memory span),
	:global(:root:not([data-theme='light']) .gap-guided-memory span) {
		border-color: rgba(104, 199, 157, 0.34);
		background: rgba(104, 199, 157, 0.12);
		color: #f4f1ea;
	}

	:global([data-theme='dark'] .gap-guided-question-text),
	:global(:root:not([data-theme='light']) .gap-guided-question-text) {
		--markdown-heading: #f4f1ea;
		--markdown-link: #9be4bd;
		--markdown-strong: #f4f1ea;
		--markdown-text: #f4f1ea;
	}

	:global([data-theme='dark'] .gap-guided-field-feedback),
	:global(:root:not([data-theme='light']) .gap-guided-field-feedback),
	:global([data-theme='dark'] .gap-guided-objective p),
	:global(:root:not([data-theme='light']) .gap-guided-objective p),
	:global([data-theme='dark'] .gap-guided-section-bar span),
	:global(:root:not([data-theme='light']) .gap-guided-section-bar span),
	:global([data-theme='dark'] .gap-guided-footer),
	:global(:root:not([data-theme='light']) .gap-guided-footer) {
		border-top-color: rgba(126, 208, 167, 0.14);
		color: #d8e2da;
	}

	:global([data-theme='dark'] .gap-guided-model),
	:global(:root:not([data-theme='light']) .gap-guided-model) {
		border-color: rgba(111, 210, 159, 0.58);
		background: #1b2a21;
	}

	:global([data-theme='dark'] .gap-guided-model span),
	:global(:root:not([data-theme='light']) .gap-guided-model span) {
		color: #8ce0b5;
	}

	@media (max-width: 760px) {
		.gap-guided-stage {
			width: min(100% - 18px, 1040px);
			padding-top: calc(env(safe-area-inset-top, 0px) + 4.6rem);
			padding-bottom: 20px;
		}

		.gap-guided-header,
		.gap-guided-footer {
			flex-direction: column;
			align-items: flex-start;
		}

		.gap-guided-header,
		.gap-guided-body {
			padding-right: 1rem;
			padding-left: 1rem;
		}

		.gap-guided-question {
			grid-template-columns: 38px minmax(0, 1fr);
			padding-right: 0.9rem;
			padding-left: 0.9rem;
		}

		.gap-guided-question-body {
			grid-template-columns: minmax(0, 1fr);
		}

		.gap-guided-field-feedback {
			grid-column: 1;
		}

		.gap-guided-button {
			margin-left: 0;
		}
	}
</style>
