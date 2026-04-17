<script lang="ts">
	import { tick } from 'svelte';
	import { z } from 'zod';
	import type { SparkLearningGapInlinePresentation } from '@spark/schemas';

	type Blank = SparkLearningGapInlinePresentation['blanks'][number];
	type JudgedStatus = 'correct' | 'partial' | 'incorrect';
	type InlineStatus = 'idle' | 'judging' | JudgedStatus | 'error';
	type InlineResult = {
		status: InlineStatus;
		feedback: string;
	};
	type InlineAttempt = {
		answer: string;
		result: JudgedStatus;
		feedback: string;
	};
	type Props = {
		gapId: string;
		subjectLabel: string;
		presentation: SparkLearningGapInlinePresentation;
	};

	const gradeResponseSchema = z.object({
		status: z.literal('ok'),
		result: z.enum(['correct', 'partial', 'incorrect']),
		feedback: z.string().min(1)
	});

	let { gapId, subjectLabel, presentation }: Props = $props();

	let answers = $state<Record<string, string>>({});
	let results = $state<Record<string, InlineResult>>({});
	let lastChecked = $state<Record<string, string>>({});
	let attempts = $state<Record<string, InlineAttempt[]>>({});
	let submitted = $state(false);
	let lastPresentationKey = $state('');

	const presentationKey = $derived(
		`${gapId}:${presentation.blanks.map((blank) => blank.id).join('|')}`
	);
	const complete = $derived(
		presentation.blanks.every((blank) => answerValue(blank.id).trim().length > 0)
	);
	const judging = $derived(
		presentation.blanks.some((blank) => resultFor(blank.id).status === 'judging')
	);
	const submittedSummary = $derived(buildSubmittedSummary());

	$effect(() => {
		const key = presentationKey;
		if (key !== lastPresentationKey) {
			resetState();
			lastPresentationKey = key;
		}
	});

	function createAnswerMap(): Record<string, string> {
		return Object.fromEntries(presentation.blanks.map((blank) => [blank.id, '']));
	}

	function createResultMap(): Record<string, InlineResult> {
		return Object.fromEntries(
			presentation.blanks.map((blank): [string, InlineResult] => [
				blank.id,
				{ status: 'idle', feedback: '' }
			])
		);
	}

	function createAttemptMap(): Record<string, InlineAttempt[]> {
		return Object.fromEntries(
			presentation.blanks.map((blank): [string, InlineAttempt[]] => [blank.id, []])
		);
	}

	function resetState(): void {
		answers = createAnswerMap();
		results = createResultMap();
		lastChecked = createAnswerMap();
		attempts = createAttemptMap();
		submitted = false;
	}

	function answerValue(blankId: string): string {
		return answers[blankId] ?? '';
	}

	function resultFor(blankId: string): InlineResult {
		return results[blankId] ?? { status: 'idle', feedback: '' };
	}

	function attemptsFor(blankId: string): InlineAttempt[] {
		return attempts[blankId] ?? [];
	}

	function setResult(blankId: string, result: InlineResult): void {
		results = { ...results, [blankId]: result };
	}

	function updateAnswer(blankId: string, value: string): void {
		answers = { ...answers, [blankId]: value };
		submitted = false;
		if (lastChecked[blankId] !== value.trim()) {
			setResult(blankId, { status: 'idle', feedback: '' });
		}
	}

	function recordAttempt(blankId: string, attempt: InlineAttempt): void {
		const current = attemptsFor(blankId);
		const lastAttempt = current[current.length - 1];
		if (
			lastAttempt?.answer === attempt.answer &&
			lastAttempt.result === attempt.result &&
			lastAttempt.feedback === attempt.feedback
		) {
			return;
		}
		attempts = {
			...attempts,
			[blankId]: [...current, attempt].slice(-6)
		};
	}

	async function judgeBlank(blankId: string): Promise<InlineStatus> {
		const answer = answerValue(blankId).trim();
		if (!answer) {
			setResult(blankId, { status: 'idle', feedback: '' });
			return 'idle';
		}

		const previous = resultFor(blankId);
		if (
			lastChecked[blankId] === answer &&
			previous.status !== 'idle' &&
			previous.status !== 'error' &&
			previous.status !== 'judging'
		) {
			return previous.status;
		}

		setResult(blankId, { status: 'judging', feedback: 'Checking...' });

		try {
			const response = await fetch(`/api/spark/gaps/${gapId}/inline-grade`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					blankId,
					answer,
					answers,
					previousAttempts: attemptsFor(blankId)
				})
			});
			if (!response.ok) {
				throw new Error(`Inline grade request failed with ${response.status.toString()}`);
			}
			const parsed = gradeResponseSchema.parse(await response.json());
			setResult(blankId, { status: parsed.result, feedback: parsed.feedback });
			lastChecked = { ...lastChecked, [blankId]: answer };
			recordAttempt(blankId, {
				answer,
				result: parsed.result,
				feedback: parsed.feedback
			});
			return parsed.result;
		} catch (error) {
			console.error('Failed to grade inline gap blank', error);
			setResult(blankId, {
				status: 'error',
				feedback: 'Could not check this answer.'
			});
			return 'error';
		}
	}

	async function focusBlank(blankId: string): Promise<void> {
		await tick();
		document.getElementById(inputId(blankId))?.focus();
	}

	async function handleKeydown(event: KeyboardEvent, blank: Blank, index: number): Promise<void> {
		if (event.key !== 'Enter') {
			return;
		}
		event.preventDefault();
		await judgeBlank(blank.id);
		const nextBlank = presentation.blanks[index + 1];
		if (nextBlank) {
			await focusBlank(nextBlank.id);
			return;
		}
		if (complete) {
			await submitSheet();
		}
	}

	async function submitSheet(event?: SubmitEvent): Promise<void> {
		event?.preventDefault();
		if (!complete) {
			return;
		}
		for (const blank of presentation.blanks) {
			await judgeBlank(blank.id);
		}
		submitted = true;
	}

	function inputId(blankId: string): string {
		return `gap-inline-${gapId}-${blankId}`;
	}

	function inputClass(blankId: string): string {
		return `gap-inline-input gap-inline-input--${resultFor(blankId).status}`;
	}

	function feedbackText(blankId: string): string {
		const result = resultFor(blankId);
		if (result.status === 'judging') {
			return 'Checking...';
		}
		return result.feedback;
	}

	function buildSubmittedSummary(): string {
		if (!submitted) {
			return '';
		}
		const correctCount = presentation.blanks.filter(
			(blank) => resultFor(blank.id).status === 'correct'
		).length;
		if (correctCount === presentation.blanks.length) {
			return 'All blanks checked. Compare with the model answer.';
		}
		return `${correctCount.toString()} of ${presentation.blanks.length.toString()} blanks are correct so far.`;
	}
</script>

<section class="gap-inline-stage">
	<form class="gap-inline-card" onsubmit={submitSheet}>
		<header class="gap-inline-header">
			<div>
				<span>{subjectLabel}</span>
				<h1>{presentation.question}</h1>
			</div>
			<strong>{presentation.blanks.length.toString()} short answers</strong>
		</header>

		<div class="gap-inline-body">
			<section class="gap-inline-objective">
				<span>Complete the explanation</span>
				<p>{presentation.instructions ?? 'Fill each blank with the short answer that completes the chain.'}</p>
			</section>

			<div class="gap-inline-section-bar">
				<strong>A. Fill in the blanks</strong>
				<span>{submitted ? 'Submitted' : 'Ready'}</span>
			</div>

			<div class="gap-inline-questions">
				{#each presentation.blanks as blank, index (blank.id)}
					<label class="gap-inline-question" for={inputId(blank.id)}>
						<span class="gap-inline-number">{(index + 1).toString()}</span>
						<span class="gap-inline-marks">[{(blank.maxMarks ?? 1).toString()} mark]</span>
						<span class="gap-inline-question-body">
							<span class="gap-inline-row">
								<span>{blank.before}</span>
								<span class="gap-inline-field">
									<textarea
										id={inputId(blank.id)}
										class={inputClass(blank.id)}
										rows="1"
										value={answerValue(blank.id)}
										oninput={(event) => {
											updateAnswer(blank.id, (event.currentTarget as HTMLTextAreaElement).value);
										}}
										onblur={() => {
											void judgeBlank(blank.id);
										}}
										onkeydown={(event) => {
											void handleKeydown(event, blank, index);
										}}
										placeholder={blank.prompt ?? 'answer'}
										aria-label={`${blank.before} blank`}
									></textarea>
									<small class={`gap-inline-feedback gap-inline-feedback--${resultFor(blank.id).status}`}>
										{feedbackText(blank.id)}
									</small>
								</span>
								<span>{blank.after}</span>
							</span>
						</span>
					</label>
				{/each}
			</div>

			<footer class="gap-inline-footer">
				{#if submittedSummary}
					<span>{submittedSummary}</span>
				{/if}
				<button class="gap-inline-submit" disabled={!complete || judging}>
					{submitted ? 'Submitted' : judging ? 'Checking' : 'Submit'}
				</button>
			</footer>

			{#if submitted}
				<aside class="gap-inline-model">
					<span>Model answer</span>
					<p>{presentation.modelAnswer}</p>
				</aside>
			{/if}
		</div>
	</form>
</section>

<style>
	.gap-inline-stage {
		width: min(1040px, calc(100% - 48px));
		min-height: 100dvh;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top, 0px) + 5rem) 0 2.5rem;
		color: #17211b;
	}

	.gap-inline-card {
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

	.gap-inline-header {
		position: relative;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		overflow: hidden;
		padding: 1.45rem 2rem 1.35rem;
		background: var(--sheet-color);
		color: #ffffff;
	}

	.gap-inline-header::before,
	.gap-inline-header::after {
		content: '';
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
	}

	.gap-inline-header::before {
		top: -34px;
		right: -30px;
		width: 118px;
		height: 118px;
	}

	.gap-inline-header::after {
		right: 60px;
		bottom: -24px;
		width: 82px;
		height: 82px;
		background: rgba(255, 255, 255, 0.06);
	}

	.gap-inline-header > * {
		position: relative;
		z-index: 1;
	}

	.gap-inline-header span,
	.gap-inline-objective span,
	.gap-inline-model span {
		display: block;
		font-size: 0.94rem;
		font-weight: 700;
	}

	.gap-inline-header span {
		margin-bottom: 0.35rem;
		color: rgba(255, 255, 255, 0.72);
	}

	.gap-inline-header h1 {
		margin: 0;
		font-size: clamp(1.45rem, 2.2vw, 1.9rem);
		font-weight: 900;
		line-height: 1.16;
		overflow-wrap: anywhere;
	}

	.gap-inline-header strong {
		flex-shrink: 0;
		margin-top: 0.15rem;
		color: rgba(255, 255, 255, 0.82);
		font-size: 0.94rem;
		text-align: right;
		white-space: nowrap;
	}

	.gap-inline-body {
		padding: 1.5rem 2rem 2rem;
	}

	.gap-inline-objective {
		margin-bottom: 1rem;
		padding-left: 1rem;
		border-left: 4px solid var(--sheet-color);
	}

	.gap-inline-objective span {
		margin-bottom: 0.15rem;
		color: var(--sheet-color);
	}

	.gap-inline-objective p {
		margin: 0;
		font-size: 0.94rem;
		line-height: 1.55;
	}

	.gap-inline-section-bar {
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

	.gap-inline-section-bar strong {
		font-weight: 700;
	}

	.gap-inline-section-bar span {
		color: rgba(23, 33, 27, 0.66);
	}

	.gap-inline-questions {
		border: 1.5px solid var(--sheet-color-30);
		border-radius: 0 0 8px 8px;
		background: #ffffff;
	}

	.gap-inline-question {
		display: grid;
		grid-template-columns: 48px minmax(0, 1fr) auto;
		column-gap: 0.75rem;
		align-items: start;
		padding: 1rem 1.1rem;
		border-bottom: 1px dashed rgba(23, 33, 27, 0.13);
	}

	.gap-inline-question:last-child {
		border-bottom: 0;
	}

	.gap-inline-number {
		display: inline-flex;
		width: 28px;
		height: 28px;
		align-items: center;
		justify-content: center;
		margin-top: 0.15rem;
		border-radius: 999px;
		background: var(--sheet-color);
		color: #ffffff;
		font-size: 14px;
		font-weight: 800;
		line-height: 1;
	}

	.gap-inline-marks {
		grid-column: 3;
		grid-row: 1;
		flex-shrink: 0;
		margin-top: 0.25rem;
		color: var(--sheet-color);
		font-size: 0.92rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.gap-inline-question-body {
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
	}

	.gap-inline-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: flex-start;
		font-size: 1rem;
		line-height: 1.55;
	}

	.gap-inline-field {
		display: inline-flex;
		width: min(18.5rem, 100%);
		min-height: 4.3rem;
		flex-direction: column;
	}

	.gap-inline-input {
		width: 100%;
		min-height: 2.5rem;
		border: 0;
		border-bottom: 2px solid var(--sheet-color-60);
		border-radius: 4px 4px 0 0;
		background: rgba(255, 255, 255, 0.62);
		color: #17211b;
		font: inherit;
		font-weight: 650;
		line-height: 1.3;
		padding: 0.42rem 0.5rem 0.34rem;
		field-sizing: content;
		overflow: hidden;
		resize: none;
		transition:
			background 0.18s ease,
			border-color 0.18s ease,
			color 0.18s ease;
	}

	.gap-inline-input::placeholder {
		color: rgba(23, 33, 27, 0.62);
		font-size: 0.875rem;
		font-weight: 600;
		opacity: 1;
	}

	.gap-inline-input:focus {
		border-color: var(--sheet-color);
		background: var(--sheet-color-08);
		box-shadow: none;
		outline: 2px solid rgba(39, 116, 93, 0.16);
		outline-offset: 2px;
	}

	.gap-inline-input--judging {
		border-color: #36587a;
		background: #eef6fa;
		color: #284863;
	}

	.gap-inline-input--correct {
		border-color: #1f8d62;
		background: #edf9f3;
		color: #176444;
	}

	.gap-inline-input--partial {
		border-color: #a76b16;
		background: #fff7df;
		color: #765014;
	}

	.gap-inline-input--incorrect,
	.gap-inline-input--error {
		border-color: #ad4d33;
		background: #fff0eb;
		color: #8b3d28;
	}

	.gap-inline-feedback {
		display: block;
		min-height: 1.45rem;
		margin-top: 0.24rem;
		color: rgba(23, 33, 27, 0.62);
		font-size: 0.76rem;
		font-weight: 650;
		line-height: 1.25;
	}

	.gap-inline-feedback--correct {
		color: #1f8d62;
	}

	.gap-inline-feedback--partial {
		color: #a76b16;
	}

	.gap-inline-feedback--incorrect,
	.gap-inline-feedback--error {
		color: #ad4d33;
	}

	.gap-inline-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #dfe7e1;
		color: rgba(23, 33, 27, 0.66);
		font-size: 0.94rem;
	}

	.gap-inline-submit {
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

	.gap-inline-submit:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.gap-inline-model {
		margin-top: 1.2rem;
		padding: 1rem 1.1rem;
		border: 1.5px solid #1f8d62;
		border-radius: 8px;
		background: #edf9f3;
	}

	.gap-inline-model span {
		margin-bottom: 0.35rem;
		color: #176444;
	}

	.gap-inline-model p {
		margin: 0;
		font-size: 1rem;
		line-height: 1.55;
	}

	:global([data-theme='dark'] .gap-inline-card),
	:global(:root:not([data-theme='light']) .gap-inline-card) {
		--sheet-color: #68c79d;
		--sheet-color-08: rgba(104, 199, 157, 0.08);
		--sheet-color-14: rgba(104, 199, 157, 0.14);
		--sheet-color-30: rgba(104, 199, 157, 0.3);
		--sheet-color-60: rgba(104, 199, 157, 0.6);
		border-color: rgba(126, 208, 167, 0.16);
		background: #18211c;
		color: #f4f1ea;
	}

	:global([data-theme='dark'] .gap-inline-header),
	:global(:root:not([data-theme='light']) .gap-inline-header) {
		background: #247257;
	}

	:global([data-theme='dark'] .gap-inline-questions),
	:global(:root:not([data-theme='light']) .gap-inline-questions) {
		border-color: rgba(104, 199, 157, 0.34);
		background: #111713;
	}

	:global([data-theme='dark'] .gap-inline-section-bar),
	:global(:root:not([data-theme='light']) .gap-inline-section-bar) {
		border-color: rgba(104, 199, 157, 0.34);
		background: rgba(104, 199, 157, 0.14);
	}

	:global([data-theme='dark'] .gap-inline-question),
	:global(:root:not([data-theme='light']) .gap-inline-question) {
		border-bottom-color: rgba(126, 208, 167, 0.14);
	}

	:global([data-theme='dark'] .gap-inline-input),
	:global(:root:not([data-theme='light']) .gap-inline-input) {
		border-bottom-color: rgba(104, 199, 157, 0.58);
		background: rgba(17, 23, 19, 0.78);
		color: #f4f1ea;
	}

	:global([data-theme='dark'] .gap-inline-input::placeholder),
	:global(:root:not([data-theme='light']) .gap-inline-input::placeholder) {
		color: rgba(216, 226, 218, 0.58);
	}

	:global([data-theme='dark'] .gap-inline-input:focus),
	:global(:root:not([data-theme='light']) .gap-inline-input:focus) {
		background: rgba(104, 199, 157, 0.1);
		outline-color: rgba(104, 199, 157, 0.22);
	}

	:global([data-theme='dark'] .gap-inline-input--judging),
	:global(:root:not([data-theme='light']) .gap-inline-input--judging) {
		border-color: #6aa5c8;
		background: rgba(59, 130, 168, 0.14);
		color: #d7eef8;
	}

	:global([data-theme='dark'] .gap-inline-input--correct),
	:global(:root:not([data-theme='light']) .gap-inline-input--correct) {
		border-color: #6fd29f;
		background: rgba(31, 141, 98, 0.16);
		color: #d8f8e6;
	}

	:global([data-theme='dark'] .gap-inline-input--partial),
	:global(:root:not([data-theme='light']) .gap-inline-input--partial) {
		border-color: #d8a64b;
		background: rgba(167, 107, 22, 0.17);
		color: #ffe3a3;
	}

	:global([data-theme='dark'] .gap-inline-input--incorrect),
	:global(:root:not([data-theme='light']) .gap-inline-input--incorrect),
	:global([data-theme='dark'] .gap-inline-input--error),
	:global(:root:not([data-theme='light']) .gap-inline-input--error) {
		border-color: #dc795f;
		background: rgba(173, 77, 51, 0.18);
		color: #ffd6ca;
	}

	:global([data-theme='dark'] .gap-inline-feedback),
	:global(:root:not([data-theme='light']) .gap-inline-feedback) {
		color: rgba(216, 226, 218, 0.62);
	}

	:global([data-theme='dark'] .gap-inline-objective p),
	:global(:root:not([data-theme='light']) .gap-inline-objective p),
	:global([data-theme='dark'] .gap-inline-section-bar span),
	:global(:root:not([data-theme='light']) .gap-inline-section-bar span),
	:global([data-theme='dark'] .gap-inline-footer),
	:global(:root:not([data-theme='light']) .gap-inline-footer) {
		border-top-color: rgba(126, 208, 167, 0.14);
		color: #d8e2da;
	}

	:global([data-theme='dark'] .gap-inline-model),
	:global(:root:not([data-theme='light']) .gap-inline-model) {
		border-color: rgba(111, 210, 159, 0.58);
		background: #1b2a21;
	}

	:global([data-theme='dark'] .gap-inline-model span),
	:global(:root:not([data-theme='light']) .gap-inline-model span) {
		color: #8ce0b5;
	}

	@media (max-width: 680px) {
		.gap-inline-stage {
			width: min(100% - 18px, 1040px);
			padding-top: calc(env(safe-area-inset-top, 0px) + 4.6rem);
			padding-bottom: 20px;
		}

		.gap-inline-header,
		.gap-inline-footer {
			flex-direction: column;
			align-items: flex-start;
		}

		.gap-inline-header,
		.gap-inline-body {
			padding-right: 1rem;
			padding-left: 1rem;
		}

		.gap-inline-question {
			grid-template-columns: 38px minmax(0, 1fr);
		}

		.gap-inline-marks {
			grid-column: 2;
			grid-row: 2;
			margin-top: 0.35rem;
		}

		.gap-inline-field {
			width: 100%;
		}

		.gap-inline-submit {
			margin-left: 0;
		}
	}
</style>
