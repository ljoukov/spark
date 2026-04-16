<script lang="ts">
	import { page } from '$app/stores';
	import { tick } from 'svelte';
	import { fromStore } from 'svelte/store';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		FINAL_ANSWER,
		GAP_BLANKS,
		GAP_HINT_QUESTIONS,
		GAP_WORDS,
		GCSE_FINAL_ANSWER,
		GCSE_IDEA_CHAIN,
		GUIDE_STEPS,
		GUIDE_VARIANTS,
		ORIGINAL_QUESTION,
		READING_KEY_KNOWLEDGE,
		READING_KEY_SENTENCES,
		READING_OUTLINE,
		SHORT_QUESTION,
		type GapBlank,
		type GuideStep,
		type GuideVariant,
		type GuideVariantId
	} from '$lib/spark/guides/knowledgeGapGuide';

	type CompletedAnswer = {
		step: GuideStep;
		studentAnswer: string;
		mode: 'answered' | 'revealed';
		correct?: boolean;
	};

	type GapAnswers = Record<string, string | null>;
	type TypedGapTarget = 'sheet' | 'hinted' | 'minimal';
	type TypedGapAnswers = Record<string, string>;
	type PromptedSheetStatus = 'idle' | 'judging' | 'correct' | 'partial' | 'incorrect' | 'error';
	type PromptedSheetResult = {
		status: PromptedSheetStatus;
		feedback: string;
	};
	type PromptedSheetResults = Record<string, PromptedSheetResult>;
	type PromptedSheetJudgedStatus = 'correct' | 'partial' | 'incorrect';
	type PromptedSheetAttempt = {
		answer: string;
		result: PromptedSheetJudgedStatus;
		feedback: string;
	};
	type PromptedSheetAttempts = Record<string, PromptedSheetAttempt[]>;

	const pageSnapshot = fromStore(page);
	const requestedId = $derived(pageSnapshot.current.params.id ?? 'v1');
	const variant = $derived(resolveVariant(requestedId));

	let lastVariantId = $state<GuideVariantId | null>(null);

	let ladderEntries = $state<CompletedAnswer[]>([]);
	let ladderDraft = $state('');
	let ladderFinalDraft = $state('');
	let ladderShowModel = $state(false);

	let choiceEntries = $state<CompletedAnswer[]>([]);
	let selectedChoiceId = $state<string | null>(null);
	let choiceFeedback = $state<string | null>(null);
	let choiceFinalDraft = $state('');
	let choiceShowModel = $state(false);

	let coachEntries = $state<CompletedAnswer[]>([]);
	let coachDraft = $state('');
	let coachFinalDraft = $state('');
	let coachShowModel = $state(false);

	let builderEntries = $state<CompletedAnswer[]>([]);
	let builderDraft = $state('');
	let builderFinalDraft = $state('');
	let builderShowModel = $state(false);

	let fillAnswers = $state<GapAnswers>(createEmptyGapAnswers());
	let fillSelectedWordId = $state<string | null>(null);
	let fillShowModel = $state(false);

	let stampAnswers = $state<GapAnswers>(createEmptyGapAnswers());
	let stampSelectedWordId = $state<string | null>(null);
	let stampShowModel = $state(false);

	let sheetTypedAnswers = $state<TypedGapAnswers>(createEmptyTypedGapAnswers());
	let sheetTypedSubmitted = $state(false);
	let hintedTypedAnswers = $state<TypedGapAnswers>(createEmptyTypedGapAnswers());
	let hintedTypedSubmitted = $state(false);
	let minimalTypedAnswers = $state<TypedGapAnswers>(createEmptyTypedGapAnswers());
	let minimalTypedSubmitted = $state(false);
	let promptedSheetAnswers = $state<TypedGapAnswers>(createEmptyTypedGapAnswers());
	let promptedSheetResults = $state<PromptedSheetResults>(createEmptyPromptedSheetResults());
	let promptedSheetLastChecked = $state<TypedGapAnswers>(createEmptyTypedGapAnswers());
	let promptedSheetAttempts = $state<PromptedSheetAttempts>(createEmptyPromptedSheetAttempts());
	let promptedSheetSubmitted = $state(false);

	let climbEntries = $state<CompletedAnswer[]>([]);
	let climbDraft = $state('');
	let climbFinalDraft = $state('');
	let climbShowModel = $state(false);

	let labEntries = $state<CompletedAnswer[]>([]);
	let labSelectedOptionId = $state<string | null>(null);
	let labFinalDraft = $state('');
	let labShowModel = $state(false);

	let importedScrollCount = $state(0);
	let importedRevealCount = $state(0);
	let importedRevealDraft = $state('');

	const ladderCurrentStep = $derived(GUIDE_STEPS[ladderEntries.length] ?? null);
	const ladderComplete = $derived(ladderEntries.length >= GUIDE_STEPS.length);
	const choiceCurrentStep = $derived(GUIDE_STEPS[choiceEntries.length] ?? null);
	const choiceComplete = $derived(choiceEntries.length >= GUIDE_STEPS.length);
	const coachCurrentStep = $derived(GUIDE_STEPS[coachEntries.length] ?? null);
	const coachComplete = $derived(coachEntries.length >= GUIDE_STEPS.length);
	const builderCurrentStep = $derived(GUIDE_STEPS[builderEntries.length] ?? null);
	const builderComplete = $derived(builderEntries.length >= GUIDE_STEPS.length);
	const fillComplete = $derived(isGapComplete(fillAnswers));
	const stampComplete = $derived(isGapComplete(stampAnswers));
	const sheetTypedComplete = $derived(isTypedGapComplete('sheet'));
	const hintedTypedComplete = $derived(isTypedGapComplete('hinted'));
	const minimalTypedComplete = $derived(isTypedGapComplete('minimal'));
	const promptedSheetComplete = $derived(isPromptedSheetComplete());
	const promptedSheetJudging = $derived(hasPromptedSheetJudging());
	const climbCurrentStep = $derived(GUIDE_STEPS[climbEntries.length] ?? null);
	const climbComplete = $derived(climbEntries.length >= GUIDE_STEPS.length);
	const labCurrentStep = $derived(GUIDE_STEPS[labEntries.length] ?? null);
	const labComplete = $derived(labEntries.length >= GUIDE_STEPS.length);
	const importedScrollComplete = $derived(importedScrollCount >= GUIDE_STEPS.length);
	const importedRevealComplete = $derived(importedRevealCount >= GUIDE_STEPS.length);
	const fillUsedWordIds = $derived(usedWordIds(fillAnswers));
	const stampUsedWordIds = $derived(usedWordIds(stampAnswers));

	$effect(() => {
		const id = variant.id;
		if (lastVariantId !== id) {
			resetState();
			lastVariantId = id;
		}
	});

	function resolveVariant(id: string): GuideVariant {
		return GUIDE_VARIANTS.find((entry) => entry.id === id) ?? GUIDE_VARIANTS[0]!;
	}

	function createEmptyGapAnswers(): GapAnswers {
		return Object.fromEntries(GAP_BLANKS.map((blank) => [blank.id, null]));
	}

	function createEmptyTypedGapAnswers(): TypedGapAnswers {
		return Object.fromEntries(GAP_BLANKS.map((blank) => [blank.id, '']));
	}

	function createEmptyPromptedSheetResults(): PromptedSheetResults {
		return Object.fromEntries(
			GAP_BLANKS.map((blank) => [blank.id, { status: 'idle', feedback: '' }])
		);
	}

	function createEmptyPromptedSheetAttempts(): PromptedSheetAttempts {
		return Object.fromEntries(
			GAP_BLANKS.map((blank): [string, PromptedSheetAttempt[]] => [blank.id, []])
		);
	}

	function resetState(): void {
		ladderEntries = [];
		ladderDraft = '';
		ladderFinalDraft = '';
		ladderShowModel = false;
		choiceEntries = [];
		selectedChoiceId = null;
		choiceFeedback = null;
		choiceFinalDraft = '';
		choiceShowModel = false;
		coachEntries = [];
		coachDraft = '';
		coachFinalDraft = '';
		coachShowModel = false;
		builderEntries = [];
		builderDraft = '';
		builderFinalDraft = '';
		builderShowModel = false;
		fillAnswers = createEmptyGapAnswers();
		fillSelectedWordId = null;
		fillShowModel = false;
		stampAnswers = createEmptyGapAnswers();
		stampSelectedWordId = null;
		stampShowModel = false;
		sheetTypedAnswers = createEmptyTypedGapAnswers();
		sheetTypedSubmitted = false;
		hintedTypedAnswers = createEmptyTypedGapAnswers();
		hintedTypedSubmitted = false;
		minimalTypedAnswers = createEmptyTypedGapAnswers();
		minimalTypedSubmitted = false;
		promptedSheetAnswers = createEmptyTypedGapAnswers();
		promptedSheetResults = createEmptyPromptedSheetResults();
		promptedSheetLastChecked = createEmptyTypedGapAnswers();
		promptedSheetAttempts = createEmptyPromptedSheetAttempts();
		promptedSheetSubmitted = false;
		climbEntries = [];
		climbDraft = '';
		climbFinalDraft = '';
		climbShowModel = false;
		labEntries = [];
		labSelectedOptionId = null;
		labFinalDraft = '';
		labShowModel = false;
		importedScrollCount = 0;
		importedRevealCount = 0;
		importedRevealDraft = '';
	}

	function progressStyle(count: number): string {
		return `--guide-progress:${Math.round((count / GUIDE_STEPS.length) * 100).toString()}%`;
	}

	function completeLadderStep(event: SubmitEvent): void {
		event.preventDefault();
		const step = ladderCurrentStep;
		const studentAnswer = ladderDraft.trim();
		if (!step || studentAnswer.length === 0) {
			return;
		}
		ladderEntries = [...ladderEntries, { step, studentAnswer, mode: 'answered' }];
		ladderDraft = '';
	}

	function revealLadderStep(): void {
		const step = ladderCurrentStep;
		if (!step) {
			return;
		}
		ladderEntries = [...ladderEntries, { step, studentAnswer: 'I need a hint', mode: 'revealed' }];
		ladderDraft = '';
	}

	function submitChoice(event: SubmitEvent): void {
		event.preventDefault();
		const step = choiceCurrentStep;
		if (!step || !selectedChoiceId) {
			return;
		}
		const selectedOption = step.options.find((option) => option.id === selectedChoiceId);
		if (!selectedOption) {
			return;
		}
		const correct = selectedChoiceId === step.correctOptionId;
		choiceEntries = [
			...choiceEntries,
			{ step, studentAnswer: selectedOption.label, mode: 'answered', correct }
		];
		choiceFeedback = correct
			? 'Good. Pin that evidence.'
			: 'Use the corrected evidence on the board.';
		selectedChoiceId = null;
	}

	function skipChoice(): void {
		const step = choiceCurrentStep;
		if (!step) {
			return;
		}
		choiceEntries = [...choiceEntries, { step, studentAnswer: 'Show me', mode: 'revealed' }];
		choiceFeedback = 'Pinned the corrected evidence.';
		selectedChoiceId = null;
	}

	function submitCoachStep(event: SubmitEvent): void {
		event.preventDefault();
		const step = coachCurrentStep;
		const studentAnswer = coachDraft.trim();
		if (!step || studentAnswer.length === 0) {
			return;
		}
		coachEntries = [...coachEntries, { step, studentAnswer, mode: 'answered' }];
		coachDraft = '';
	}

	function revealCoachStep(): void {
		const step = coachCurrentStep;
		if (!step) {
			return;
		}
		coachEntries = [...coachEntries, { step, studentAnswer: 'I am stuck', mode: 'revealed' }];
		coachDraft = '';
	}

	function submitBuilderStep(event: SubmitEvent): void {
		event.preventDefault();
		const step = builderCurrentStep;
		const studentAnswer = builderDraft.trim();
		if (!step || studentAnswer.length === 0) {
			return;
		}
		builderEntries = [...builderEntries, { step, studentAnswer, mode: 'answered' }];
		builderDraft = '';
	}

	function revealBuilderStep(): void {
		const step = builderCurrentStep;
		if (!step) {
			return;
		}
		builderEntries = [
			...builderEntries,
			{ step, studentAnswer: 'Use the answer part', mode: 'revealed' }
		];
		builderDraft = '';
	}

	function submitClimbStep(event: SubmitEvent): void {
		event.preventDefault();
		const step = climbCurrentStep;
		const studentAnswer = climbDraft.trim();
		if (!step || studentAnswer.length === 0) {
			return;
		}
		climbEntries = [...climbEntries, { step, studentAnswer, mode: 'answered' }];
		climbDraft = '';
	}

	function revealClimbStep(): void {
		const step = climbCurrentStep;
		if (!step) {
			return;
		}
		climbEntries = [...climbEntries, { step, studentAnswer: 'Show checkpoint', mode: 'revealed' }];
		climbDraft = '';
	}

	function submitLabStep(event: SubmitEvent): void {
		event.preventDefault();
		const step = labCurrentStep;
		if (!step || !labSelectedOptionId) {
			return;
		}
		const selectedOption = step.options.find((option) => option.id === labSelectedOptionId);
		if (!selectedOption) {
			return;
		}
		const correct = labSelectedOptionId === step.correctOptionId;
		labEntries = [
			...labEntries,
			{ step, studentAnswer: selectedOption.label, mode: 'answered', correct }
		];
		labSelectedOptionId = null;
	}

	function revealLabPoint(): void {
		const step = labCurrentStep;
		if (!step) {
			return;
		}
		labEntries = [...labEntries, { step, studentAnswer: 'Run test', mode: 'revealed' }];
		labSelectedOptionId = null;
	}

	function revealImportedScrollStep(index: number): void {
		if (index > importedScrollCount) {
			return;
		}
		importedScrollCount = Math.max(importedScrollCount, index + 1);
	}

	function revealImportedAnswerPiece(): void {
		importedRevealCount = Math.min(importedRevealCount + 1, GUIDE_STEPS.length);
		importedRevealDraft = '';
	}

	function usedWordIds(answers: GapAnswers): string[] {
		return Object.values(answers).filter((value): value is string => value !== null);
	}

	function isGapComplete(answers: GapAnswers): boolean {
		return GAP_BLANKS.every((blank) => answers[blank.id] !== null);
	}

	function typedAnswersFor(target: TypedGapTarget): TypedGapAnswers {
		if (target === 'sheet') {
			return sheetTypedAnswers;
		}
		if (target === 'hinted') {
			return hintedTypedAnswers;
		}
		return minimalTypedAnswers;
	}

	function isTypedGapComplete(target: TypedGapTarget): boolean {
		const answers = typedAnswersFor(target);
		return GAP_BLANKS.every((blank) => (answers[blank.id] ?? '').trim().length > 0);
	}

	function typedGapValue(target: TypedGapTarget, blankId: string): string {
		return typedAnswersFor(target)[blankId] ?? '';
	}

	function updateTypedGap(target: TypedGapTarget, blankId: string, value: string): void {
		if (target === 'sheet') {
			sheetTypedAnswers = { ...sheetTypedAnswers, [blankId]: value };
			sheetTypedSubmitted = false;
			return;
		}
		if (target === 'hinted') {
			hintedTypedAnswers = { ...hintedTypedAnswers, [blankId]: value };
			hintedTypedSubmitted = false;
			return;
		}
		minimalTypedAnswers = { ...minimalTypedAnswers, [blankId]: value };
		minimalTypedSubmitted = false;
	}

	function submitTypedGaps(event: SubmitEvent, target: TypedGapTarget): void {
		event.preventDefault();
		if (!isTypedGapComplete(target)) {
			return;
		}
		if (target === 'sheet') {
			sheetTypedSubmitted = true;
			return;
		}
		if (target === 'hinted') {
			hintedTypedSubmitted = true;
			return;
		}
		minimalTypedSubmitted = true;
	}

	function revealTypedGaps(target: TypedGapTarget): void {
		const answers = Object.fromEntries(GAP_BLANKS.map((blank) => [blank.id, blank.answer]));
		if (target === 'sheet') {
			sheetTypedAnswers = answers;
			sheetTypedSubmitted = true;
			return;
		}
		if (target === 'hinted') {
			hintedTypedAnswers = answers;
			hintedTypedSubmitted = true;
			return;
		}
		minimalTypedAnswers = answers;
		minimalTypedSubmitted = true;
	}

	function resetTypedGaps(target: TypedGapTarget): void {
		if (target === 'sheet') {
			sheetTypedAnswers = createEmptyTypedGapAnswers();
			sheetTypedSubmitted = false;
			return;
		}
		if (target === 'hinted') {
			hintedTypedAnswers = createEmptyTypedGapAnswers();
			hintedTypedSubmitted = false;
			return;
		}
		minimalTypedAnswers = createEmptyTypedGapAnswers();
		minimalTypedSubmitted = false;
	}

	function isTypedGapSubmitted(target: TypedGapTarget): boolean {
		if (target === 'sheet') {
			return sheetTypedSubmitted;
		}
		if (target === 'hinted') {
			return hintedTypedSubmitted;
		}
		return minimalTypedSubmitted;
	}

	function isTypedGapCorrect(target: TypedGapTarget, blank: GapBlank): boolean {
		return typedGapValue(target, blank.id).trim().toLowerCase() === blank.answer.toLowerCase();
	}

	function typedGapInputClass(target: TypedGapTarget, blank: GapBlank): string {
		const classes = [
			'sheet-inline-input',
			target === 'hinted'
				? 'sheet-inline-input--hinted'
				: target === 'minimal'
					? 'minimal-fill-input'
					: 'sheet-inline-input--compact'
		];
		if (isTypedGapSubmitted(target)) {
			classes.push(isTypedGapCorrect(target, blank) ? 'is-correct' : 'is-needs-work');
		}
		return classes.join(' ');
	}

	function typedGapPlaceholder(target: TypedGapTarget, blank: GapBlank): string {
		if (target === 'hinted') {
			return GAP_HINT_QUESTIONS[blank.id] ?? 'Use the clue';
		}
		if (target === 'minimal') {
			return '';
		}
		return 'answer';
	}

	function promptedSheetValue(blankId: string): string {
		return promptedSheetAnswers[blankId] ?? '';
	}

	function promptedSheetResult(blankId: string): PromptedSheetResult {
		return promptedSheetResults[blankId] ?? { status: 'idle', feedback: '' };
	}

	function isPromptedSheetComplete(): boolean {
		return GAP_BLANKS.every((blank) => promptedSheetValue(blank.id).trim().length > 0);
	}

	function hasPromptedSheetJudging(): boolean {
		return GAP_BLANKS.some((blank) => promptedSheetResult(blank.id).status === 'judging');
	}

	function updatePromptedSheetGap(blankId: string, value: string): void {
		promptedSheetAnswers = { ...promptedSheetAnswers, [blankId]: value };
		promptedSheetSubmitted = false;
		if (promptedSheetLastChecked[blankId] !== value.trim()) {
			promptedSheetResults = {
				...promptedSheetResults,
				[blankId]: { status: 'idle', feedback: '' }
			};
		}
	}

	function promptedSheetInputClass(blankId: string): string {
		return `prompted-sheet-input prompted-sheet-input--${promptedSheetResult(blankId).status}`;
	}

	function promptedSheetFeedback(blankId: string): string {
		const result = promptedSheetResult(blankId);
		if (result.status === 'judging') {
			return 'Checking...';
		}
		return result.feedback;
	}

	function setPromptedSheetResult(blankId: string, result: PromptedSheetResult): void {
		promptedSheetResults = { ...promptedSheetResults, [blankId]: result };
	}

	function promptedSheetPreviousAttempts(blankId: string): PromptedSheetAttempt[] {
		return promptedSheetAttempts[blankId] ?? [];
	}

	function recordPromptedSheetAttempt(blankId: string, attempt: PromptedSheetAttempt): void {
		const attempts = promptedSheetPreviousAttempts(blankId);
		const lastAttempt = attempts[attempts.length - 1];
		if (
			lastAttempt?.answer === attempt.answer &&
			lastAttempt.result === attempt.result &&
			lastAttempt.feedback === attempt.feedback
		) {
			return;
		}
		promptedSheetAttempts = {
			...promptedSheetAttempts,
			[blankId]: [...attempts, attempt].slice(-6)
		};
	}

	async function judgePromptedSheetBlank(blankId: string): Promise<PromptedSheetStatus> {
		const answer = promptedSheetValue(blankId).trim();
		if (answer.length === 0) {
			setPromptedSheetResult(blankId, { status: 'idle', feedback: '' });
			return 'idle';
		}
		const previous = promptedSheetResult(blankId);
		if (
			promptedSheetLastChecked[blankId] === answer &&
			previous.status !== 'idle' &&
			previous.status !== 'error' &&
			previous.status !== 'judging'
		) {
			return previous.status;
		}

		setPromptedSheetResult(blankId, { status: 'judging', feedback: 'Checking...' });

		try {
			const response = await fetch('/spark/guides/judge', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					blankId,
					answer,
					answers: promptedSheetAnswers,
					previousAttempts: promptedSheetPreviousAttempts(blankId)
				})
			});

			if (!response.ok) {
				throw new Error(`Judge request failed with ${response.status.toString()}`);
			}

			const parsed = (await response.json()) as {
				result?: PromptedSheetStatus;
				feedback?: string;
			};
			const status =
				parsed.result === 'correct' || parsed.result === 'partial' || parsed.result === 'incorrect'
					? parsed.result
					: 'error';
			const feedback =
				typeof parsed.feedback === 'string' && parsed.feedback.trim().length > 0
					? parsed.feedback.trim()
					: status === 'error'
						? 'Could not check this answer.'
						: '';

			setPromptedSheetResult(blankId, { status, feedback });
			promptedSheetLastChecked = { ...promptedSheetLastChecked, [blankId]: answer };
			if (status === 'correct' || status === 'partial' || status === 'incorrect') {
				recordPromptedSheetAttempt(blankId, { answer, result: status, feedback });
			}
			return status;
		} catch {
			setPromptedSheetResult(blankId, {
				status: 'error',
				feedback: 'Could not check this answer.'
			});
			return 'error';
		}
	}

	async function focusPromptedSheetBlank(blankId: string): Promise<void> {
		await tick();
		document.getElementById(`prompted-sheet-${blankId}`)?.focus();
	}

	async function handlePromptedSheetKeydown(
		event: KeyboardEvent,
		blank: GapBlank,
		index: number
	): Promise<void> {
		if (event.key !== 'Enter') {
			return;
		}
		event.preventDefault();
		await judgePromptedSheetBlank(blank.id);
		const nextBlank = GAP_BLANKS[index + 1];
		if (nextBlank) {
			await focusPromptedSheetBlank(nextBlank.id);
			return;
		}
		if (isPromptedSheetComplete()) {
			await submitPromptedSheet();
		}
	}

	async function submitPromptedSheet(event?: SubmitEvent): Promise<void> {
		event?.preventDefault();
		if (!isPromptedSheetComplete()) {
			return;
		}
		for (const blank of GAP_BLANKS) {
			await judgePromptedSheetBlank(blank.id);
		}
		promptedSheetSubmitted = true;
	}

	function labelForWordId(wordId: string | null): string {
		if (!wordId) {
			return '';
		}
		return GAP_WORDS.find((word) => word.id === wordId)?.label ?? '';
	}

	function chooseGapWord(target: 'fill' | 'stamp', wordId: string): void {
		if (target === 'fill') {
			fillSelectedWordId = fillSelectedWordId === wordId ? null : wordId;
			return;
		}
		stampSelectedWordId = stampSelectedWordId === wordId ? null : wordId;
	}

	function placeGapWord(target: 'fill' | 'stamp', blankId: string): void {
		const selected = target === 'fill' ? fillSelectedWordId : stampSelectedWordId;
		if (!selected) {
			return;
		}
		if (target === 'fill') {
			fillAnswers = Object.fromEntries(
				Object.entries(fillAnswers).map(([id, value]) => [id, value === selected ? null : value])
			);
			fillAnswers = { ...fillAnswers, [blankId]: selected };
			fillSelectedWordId = null;
			fillShowModel = false;
			return;
		}
		stampAnswers = Object.fromEntries(
			Object.entries(stampAnswers).map(([id, value]) => [id, value === selected ? null : value])
		);
		stampAnswers = { ...stampAnswers, [blankId]: selected };
		stampSelectedWordId = null;
		stampShowModel = false;
	}

	function clearGapBlank(target: 'fill' | 'stamp', blankId: string): void {
		if (target === 'fill') {
			fillAnswers = { ...fillAnswers, [blankId]: null };
			return;
		}
		stampAnswers = { ...stampAnswers, [blankId]: null };
	}

	function revealGapAnswers(target: 'fill' | 'stamp'): void {
		const unusedWords = [...GAP_WORDS];
		const exactAnswers = Object.fromEntries(
			GAP_BLANKS.map((blank) => {
				const index = unusedWords.findIndex((word) => word.label === blank.answer);
				const word = index >= 0 ? unusedWords.splice(index, 1)[0] : null;
				return [blank.id, word?.id ?? null];
			})
		);
		if (target === 'fill') {
			fillAnswers = exactAnswers;
			fillSelectedWordId = null;
			fillShowModel = true;
			return;
		}
		stampAnswers = exactAnswers;
		stampSelectedWordId = null;
		stampShowModel = true;
	}

	function buildChoiceClass(optionId: string, selectedId: string | null): string {
		return selectedId === optionId ? 'choice-option choice-option--selected' : 'choice-option';
	}

	function buildGapButtonClass(
		wordId: string,
		selectedId: string | null,
		usedIds: string[]
	): string {
		if (usedIds.includes(wordId)) {
			return 'bank-chip bank-chip--used';
		}
		return selectedId === wordId ? 'bank-chip bank-chip--selected' : 'bank-chip';
	}

	function blankText(blank: GapBlank, answers: GapAnswers): string {
		return labelForWordId(answers[blank.id]) || 'blank';
	}
</script>

<svelte:head>
	<title>{variant.name} | Spark guides</title>
</svelte:head>

<section class="guide-detail" data-variant={variant.id}>
	<a
		class="guide-close-button"
		href="/spark/guides"
		aria-label="Back to guide list"
		title="Back to guide list"
	>
		<XIcon class="guide-close-button__icon" />
	</a>

	{#if variant.id === 'v1'}
		<div class="sheet-stage">
			<section class="answer-sheet">
				<div class="answer-sheet__question">
					<strong>{ORIGINAL_QUESTION}</strong>
				</div>
				<div class="sheet-heading sheet-heading--progress-only">
					<strong>{ladderEntries.length.toString()} / {GUIDE_STEPS.length.toString()}</strong>
				</div>
				<div class="progress-track" style={progressStyle(ladderEntries.length)} aria-hidden="true">
					<span></span>
				</div>

				<div class="context-stack" aria-label="Completed evidence">
					{#each ladderEntries as entry, index (entry.step.id)}
						<article class="context-row">
							<span>{(index + 1).toString()}</span>
							<div>
								<p>{entry.step.question}</p>
								<strong>{entry.step.answer}</strong>
							</div>
						</article>
					{/each}
				</div>

				{#if !ladderComplete && ladderCurrentStep}
					<form class="prompt-card prompt-card--focus" onsubmit={completeLadderStep}>
						<p>{ladderCurrentStep.shortLabel}</p>
						<h2>{ladderCurrentStep.question}</h2>
						<small>{ladderCurrentStep.prompt}</small>
						<label>
							<span>Your answer</span>
							<input
								bind:value={ladderDraft}
								autocomplete="off"
								placeholder="Write a short answer"
							/>
						</label>
						<div class="action-row">
							<button class="primary-action" disabled={ladderDraft.trim().length === 0}
								>Add note</button
							>
							<button type="button" class="quiet-action" onclick={revealLadderStep}
								>Show note</button
							>
						</div>
					</form>
				{:else}
					<section class="final-panel">
						<h2>Answer the exam prompt.</h2>
						<textarea
							bind:value={ladderFinalDraft}
							rows="5"
							placeholder="Veins need valves because..."
						></textarea>
						<div class="action-row">
							<button type="button" class="primary-action" onclick={() => (ladderShowModel = true)}>
								Compare with model
							</button>
							<button type="button" class="quiet-action" onclick={resetState}>Start over</button>
						</div>
						{#if ladderShowModel}
							<aside class="model-answer">
								<span>Model answer</span>
								<p>{FINAL_ANSWER}</p>
							</aside>
						{/if}
					</section>
				{/if}
			</section>
		</div>
	{:else if variant.id === 'v2'}
		<div class="pinboard-stage">
			<section class="pinboard">
				<div class="target-question">
					<span>Pin evidence around this question</span>
					<h1>{ORIGINAL_QUESTION}</h1>
				</div>
				<div class="slip-strip" aria-label="Evidence slips">
					{#each GUIDE_STEPS as step, index (step.id)}
						{@const entry = choiceEntries[index]}
						<article class={entry ? 'evidence-slip evidence-slip--filled' : 'evidence-slip'}>
							<span>{(index + 1).toString()}</span>
							<strong>{step.shortLabel}</strong>
							<p>{entry ? step.answer : 'Waiting'}</p>
						</article>
					{/each}
				</div>

				{#if !choiceComplete && choiceCurrentStep}
					<form class="choice-stage" onsubmit={submitChoice}>
						<span>Evidence {(choiceEntries.length + 1).toString()}</span>
						<h2>{choiceCurrentStep.question}</h2>
						<div class="choice-grid">
							{#each choiceCurrentStep.options as option (option.id)}
								<button
									type="button"
									class={buildChoiceClass(option.id, selectedChoiceId)}
									onclick={() => (selectedChoiceId = option.id)}
								>
									{option.label}
								</button>
							{/each}
						</div>
						<div class="action-row">
							<button class="primary-action" disabled={!selectedChoiceId}>Pin slip</button>
							<button type="button" class="quiet-action" onclick={skipChoice}>Show slip</button>
						</div>
						{#if choiceFeedback}
							<p class="inline-feedback">{choiceFeedback}</p>
						{/if}
					</form>
				{:else}
					<section class="final-panel">
						<h2>Use the pinned evidence to answer.</h2>
						<textarea
							bind:value={choiceFinalDraft}
							rows="5"
							placeholder="Write the full biology answer."
						></textarea>
						<div class="action-row">
							<button type="button" class="primary-action" onclick={() => (choiceShowModel = true)}>
								Check model
							</button>
							<button type="button" class="quiet-action" onclick={resetState}>Reset board</button>
						</div>
						{#if choiceShowModel}
							<aside class="model-answer">
								<span>Model answer</span>
								<p>{FINAL_ANSWER}</p>
							</aside>
						{/if}
					</section>
				{/if}
			</section>
		</div>
	{:else if variant.id === 'v3'}
		<div class="transcript-stage">
			<section class="transcript">
				<div class="message-list" aria-label="Guided transcript">
					<article class="coach-message coach-message--question">
						<span>Prompt to solve</span>
						<p>{ORIGINAL_QUESTION}</p>
					</article>
					{#each coachEntries as entry (entry.step.id)}
						<article class="coach-message coach-message--prompt">
							<span>Coach</span>
							<p>{entry.step.question}</p>
						</article>
						<article class="coach-message coach-message--student">
							<span>You</span>
							<p>{entry.studentAnswer}</p>
						</article>
						<article class="coach-message coach-message--takeaway">
							<span>Takeaway</span>
							<p>{entry.step.answer}</p>
						</article>
					{/each}
					{#if !coachComplete && coachCurrentStep}
						<article class="coach-message coach-message--prompt">
							<span>Coach</span>
							<p>{coachCurrentStep.question}</p>
						</article>
					{/if}
				</div>

				{#if !coachComplete && coachCurrentStep}
					<form class="coach-composer" onsubmit={submitCoachStep}>
						<label>
							<span>Your reply</span>
							<input
								bind:value={coachDraft}
								placeholder="Reply in a few words"
								autocomplete="off"
							/>
						</label>
						<button class="primary-action" disabled={coachDraft.trim().length === 0}>Send</button>
						<button type="button" class="quiet-action" onclick={revealCoachStep}
							>Need a nudge</button
						>
					</form>
				{:else}
					<section class="final-panel">
						<h2>Turn the transcript into one answer.</h2>
						<textarea
							bind:value={coachFinalDraft}
							rows="5"
							placeholder="Write it as a GCSE biology explanation."
						></textarea>
						<div class="action-row">
							<button type="button" class="primary-action" onclick={() => (coachShowModel = true)}>
								Show model
							</button>
							<button type="button" class="quiet-action" onclick={resetState}>Restart</button>
						</div>
						{#if coachShowModel}
							<aside class="model-answer">
								<span>Model answer</span>
								<p>{FINAL_ANSWER}</p>
							</aside>
						{/if}
					</section>
				{/if}
			</section>
		</div>
	{:else if variant.id === 'v4'}
		<div class="builder-stage">
			<section class="builder-shell">
				<aside class="builder-rail">
					<div class="rail-question">
						<span>Build toward</span>
						<strong>{SHORT_QUESTION}</strong>
					</div>
					{#each GUIDE_STEPS as step, index (step.id)}
						{@const entry = builderEntries[index]}
						<article
							class={entry
								? 'builder-step builder-step--done'
								: index === builderEntries.length
									? 'builder-step builder-step--active'
									: 'builder-step'}
						>
							<span>{(index + 1).toString()}</span>
							<div>
								<strong>{step.shortLabel}</strong>
								<p>{step.question}</p>
								{#if entry}
									<em>{step.answer}</em>
								{/if}
							</div>
						</article>
					{/each}
				</aside>
				<main class="builder-main">
					<div
						class="progress-track"
						style={progressStyle(builderEntries.length)}
						aria-hidden="true"
					>
						<span></span>
					</div>
					{#if !builderComplete && builderCurrentStep}
						<form class="prompt-card" onsubmit={submitBuilderStep}>
							<p>{builderCurrentStep.prompt}</p>
							<h1>{builderCurrentStep.question}</h1>
							<label>
								<span>Short answer</span>
								<input bind:value={builderDraft} autocomplete="off" placeholder="Type the idea" />
							</label>
							<div class="action-row">
								<button class="primary-action" disabled={builderDraft.trim().length === 0}
									>Unlock part</button
								>
								<button type="button" class="quiet-action" onclick={revealBuilderStep}
									>Reveal part</button
								>
							</div>
						</form>
					{/if}
					<section class="sentence-bank" aria-label="Unlocked answer parts">
						<span>Sentence parts</span>
						<div>
							{#each GUIDE_STEPS as step, index (step.id)}
								<span
									class={index < builderEntries.length
										? 'sentence-chip'
										: 'sentence-chip sentence-chip--locked'}
								>
									{index < builderEntries.length ? step.clause : 'Locked'}
								</span>
							{/each}
						</div>
					</section>
					{#if builderComplete}
						<section class="final-panel">
							<h2>Write the explanation.</h2>
							<textarea
								bind:value={builderFinalDraft}
								rows="5"
								placeholder="Connect the sentence parts."
							></textarea>
							<div class="action-row">
								<button
									type="button"
									class="primary-action"
									onclick={() => (builderShowModel = true)}
								>
									Compare
								</button>
								<button type="button" class="quiet-action" onclick={resetState}>Clear</button>
							</div>
							{#if builderShowModel}
								<aside class="model-answer">
									<span>Model answer</span>
									<p>{FINAL_ANSWER}</p>
								</aside>
							{/if}
						</section>
					{/if}
				</main>
			</section>
		</div>
	{:else if variant.id === 'v5'}
		<div class="gap-stage">
			<section class="gap-sheet">
				<div class="gap-sheet__question">
					<span>Fill the answer to solve</span>
					<h1>{ORIGINAL_QUESTION}</h1>
				</div>
				<div class="gap-paragraph">
					{#each GAP_BLANKS as blank (blank.id)}
						<p>
							{blank.before}
							<button
								type="button"
								class="blank-slot"
								onclick={() => placeGapWord('fill', blank.id)}
							>
								{blankText(blank, fillAnswers)}
							</button>{blank.after}
							{#if fillAnswers[blank.id]}
								<button
									type="button"
									class="clear-blank"
									onclick={() => clearGapBlank('fill', blank.id)}
								>
									clear
								</button>
							{/if}
						</p>
					{/each}
				</div>
				<div class="word-bank">
					<span>Word bank</span>
					{#each GAP_WORDS as word (word.id)}
						<button
							type="button"
							class={buildGapButtonClass(word.id, fillSelectedWordId, fillUsedWordIds)}
							disabled={fillUsedWordIds.includes(word.id)}
							onclick={() => chooseGapWord('fill', word.id)}
						>
							{word.label}
						</button>
					{/each}
				</div>
				<div class="action-row">
					<button
						type="button"
						class="primary-action"
						disabled={!fillComplete}
						onclick={() => (fillShowModel = true)}
					>
						Check full answer
					</button>
					<button type="button" class="quiet-action" onclick={() => revealGapAnswers('fill')}
						>Fill for me</button
					>
				</div>
				{#if fillShowModel}
					<aside class="model-answer">
						<span>Model answer</span>
						<p>{FINAL_ANSWER}</p>
					</aside>
				{/if}
			</section>
		</div>
	{:else if variant.id === 'v6'}
		<div class="stamp-stage">
			<section class="lab-report">
				<header>
					<span>Vein report</span>
					<h1>{ORIGINAL_QUESTION}</h1>
				</header>
				<div class="report-grid">
					<div class="report-lines">
						{#each GAP_BLANKS as blank, index (blank.id)}
							<article class="report-line">
								<span>{(index + 1).toString()}</span>
								<p>
									{blank.before}
									<button
										type="button"
										class="stamp-slot"
										onclick={() => placeGapWord('stamp', blank.id)}
									>
										{blankText(blank, stampAnswers)}
									</button>{blank.after}
								</p>
							</article>
						{/each}
					</div>
					<aside class="stamp-bank">
						<span>Ink stamps</span>
						{#each GAP_WORDS as word (word.id)}
							<button
								type="button"
								class={buildGapButtonClass(word.id, stampSelectedWordId, stampUsedWordIds)}
								disabled={stampUsedWordIds.includes(word.id)}
								onclick={() => chooseGapWord('stamp', word.id)}
							>
								{word.label}
							</button>
						{/each}
					</aside>
				</div>
				<div class="action-row">
					<button
						type="button"
						class="primary-action"
						disabled={!stampComplete}
						onclick={() => (stampShowModel = true)}
					>
						Sign report
					</button>
					<button type="button" class="quiet-action" onclick={() => revealGapAnswers('stamp')}
						>Stamp answers</button
					>
					<button
						type="button"
						class="quiet-action"
						onclick={() => (stampAnswers = createEmptyGapAnswers())}>Clear</button
					>
				</div>
				{#if stampShowModel}
					<aside class="model-answer">
						<span>Signed conclusion</span>
						<p>{FINAL_ANSWER}</p>
					</aside>
				{/if}
			</section>
		</div>
	{:else if variant.id === 'v11' || variant.id === 'v12'}
		{@const typedTarget = variant.id === 'v12' ? 'hinted' : 'sheet'}
		<div class="sheet-inline-stage">
			<form class="sheet-inline-card" onsubmit={(event) => submitTypedGaps(event, typedTarget)}>
				<header class="sheet-inline-header">
					<div>
						<span>Knowledge gap sheet</span>
						<h1>{ORIGINAL_QUESTION}</h1>
					</div>
					<strong>5 short answers</strong>
				</header>

				<div class="sheet-inline-body">
					<section class="sheet-inline-objective">
						<span>Complete the explanation</span>
						<p>
							Type the missing word in each blank, then submit the sheet. These are local prototype
							fields only.
						</p>
					</section>

					<div class="sheet-inline-section-bar">
						<strong>A. Fill in the blanks · 5 marks</strong>
						<span>{isTypedGapSubmitted(typedTarget) ? 'Submitted' : 'Ready'}</span>
					</div>

					<div class="sheet-inline-questions">
						{#each GAP_BLANKS as blank, index (blank.id)}
							<article class="sheet-inline-question">
								<div class="sheet-inline-number">{(index + 1).toString()}</div>
								<div class="sheet-inline-marks">[1 mark]</div>
								<div class="sheet-inline-question-body">
									<div class="sheet-inline-row">
										<span>{blank.before}</span>
										<input
											class={typedGapInputClass(typedTarget, blank)}
											value={typedGapValue(typedTarget, blank.id)}
											oninput={(event) => {
												updateTypedGap(
													typedTarget,
													blank.id,
													(event.currentTarget as HTMLInputElement).value
												);
											}}
											placeholder={typedGapPlaceholder(typedTarget, blank)}
											aria-label={`${blank.before} blank`}
											autocomplete="off"
										/>
										<span>{blank.after}</span>
									</div>
								</div>
							</article>
						{/each}
					</div>

					<footer class="sheet-inline-footer">
						<span>
							{isTypedGapSubmitted(typedTarget)
								? 'Submitted locally. Compare with the model answer.'
								: 'Short answers only. No word bank.'}
						</span>
						<div>
							<button
								type="button"
								class="sheet-inline-secondary"
								onclick={() => revealTypedGaps(typedTarget)}
							>
								Fill for me
							</button>
							<button
								type="button"
								class="sheet-inline-secondary"
								onclick={() => resetTypedGaps(typedTarget)}
							>
								Clear
							</button>
							<button
								class="sheet-inline-submit"
								disabled={typedTarget === 'sheet' ? !sheetTypedComplete : !hintedTypedComplete}
							>
								Submit
							</button>
						</div>
					</footer>

					{#if isTypedGapSubmitted(typedTarget)}
						<aside class="sheet-inline-model">
							<span>Model answer</span>
							<p>{FINAL_ANSWER}</p>
						</aside>
					{/if}
				</div>
			</form>
		</div>
	{:else if variant.id === 'v13'}
		<div class="minimal-fill-stage">
			<form class="minimal-fill-form" onsubmit={(event) => submitTypedGaps(event, 'minimal')}>
				<h1>Fill in the gaps</h1>
				<div class="minimal-fill-lines">
					{#each GAP_BLANKS as blank (blank.id)}
						<p>
							<span>{blank.before}</span>
							<input
								class={typedGapInputClass('minimal', blank)}
								value={typedGapValue('minimal', blank.id)}
								oninput={(event) => {
									updateTypedGap(
										'minimal',
										blank.id,
										(event.currentTarget as HTMLInputElement).value
									);
								}}
								placeholder={typedGapPlaceholder('minimal', blank)}
								aria-label={`${blank.before} blank`}
								autocomplete="off"
							/>
							<span>{blank.after}</span>
						</p>
					{/each}
				</div>
				<button class="minimal-fill-submit" disabled={!minimalTypedComplete}>
					{isTypedGapSubmitted('minimal') ? 'Submitted' : 'Submit'}
				</button>
			</form>
		</div>
	{:else if variant.id === 'v14'}
		<div class="prompted-sheet-stage">
			<form class="prompted-sheet-form" onsubmit={submitPromptedSheet}>
				<header class="prompted-sheet-header">
					<p>{ORIGINAL_QUESTION}</p>
				</header>
				<div class="prompted-sheet-lines">
					{#each GAP_BLANKS as blank, index (blank.id)}
						<label class="prompted-sheet-line" for={`prompted-sheet-${blank.id}`}>
							<span class="prompted-sheet-sentence">
								<span>{blank.before}</span>
								<span class="prompted-sheet-field">
									<input
										id={`prompted-sheet-${blank.id}`}
										class={promptedSheetInputClass(blank.id)}
										value={promptedSheetValue(blank.id)}
										oninput={(event) => {
											updatePromptedSheetGap(
												blank.id,
												(event.currentTarget as HTMLInputElement).value
											);
										}}
										onblur={() => {
											void judgePromptedSheetBlank(blank.id);
										}}
										onkeydown={(event) => {
											void handlePromptedSheetKeydown(event, blank, index);
										}}
										placeholder={GAP_HINT_QUESTIONS[blank.id] ?? 'Use the prompt'}
										aria-label={`${blank.before} blank`}
										autocomplete="off"
									/>
									<small
										class={`prompted-sheet-feedback prompted-sheet-feedback--${promptedSheetResult(blank.id).status}`}
									>
										{promptedSheetFeedback(blank.id)}
									</small>
								</span>
								<span>{blank.after}</span>
							</span>
						</label>
					{/each}
				</div>
				<footer class="prompted-sheet-footer">
					<button
						class="prompted-sheet-submit"
						disabled={!promptedSheetComplete || promptedSheetJudging}
					>
						{promptedSheetSubmitted ? 'Submitted' : promptedSheetJudging ? 'Checking' : 'Submit'}
					</button>
				</footer>
			</form>
		</div>
	{:else if variant.id === 'v15'}
		<div class="reading-stage reading-stage--sheet">
			<article class="reading-sheet">
				<header class="reading-sheet-header">
					<p>{ORIGINAL_QUESTION}</p>
				</header>
				<div class="reading-sheet-grid">
					<section class="reading-block reading-block--large">
						<h1>Key knowledge</h1>
						<ol class="reading-letter-list">
							{#each READING_KEY_KNOWLEDGE as point, index}
								<li>
									<span>{String.fromCharCode(97 + index)}.</span>
									<p>{point}</p>
								</li>
							{/each}
						</ol>
					</section>
					<section class="reading-block">
						<h2>Outline</h2>
						<ol class="reading-letter-list">
							{#each READING_OUTLINE as point, index}
								<li>
									<span>{String.fromCharCode(97 + index)}.</span>
									<p>{point}</p>
								</li>
							{/each}
						</ol>
					</section>
					<section class="reading-block">
						<h2>Key sentences</h2>
						<ol class="reading-letter-list">
							{#each READING_KEY_SENTENCES as sentence, index}
								<li>
									<span>{String.fromCharCode(97 + index)}.</span>
									<p>{sentence}</p>
								</li>
							{/each}
						</ol>
					</section>
				</div>
				<section class="reading-final">
					<h2>Final answer</h2>
					<p>{GCSE_FINAL_ANSWER}</p>
				</section>
			</article>
		</div>
	{:else if variant.id === 'v16'}
		<div class="reading-stage reading-stage--spine">
			<article class="reading-spine">
				<header class="reading-spine-header">
					<p>{ORIGINAL_QUESTION}</p>
					<h1>
						{#each GCSE_IDEA_CHAIN as idea, index}
							<span>{idea}</span>
							{#if index < GCSE_IDEA_CHAIN.length - 1}
								<b aria-hidden="true">→</b>
							{/if}
						{/each}
					</h1>
				</header>
				<div class="spine-track">
					{#each READING_OUTLINE as point, index}
						<section class="spine-node">
							<span>{String.fromCharCode(97 + index)}.</span>
							<p>{point}</p>
						</section>
					{/each}
				</div>
				<div class="spine-support">
					<section>
						<h2>Key sentences</h2>
						{#each READING_KEY_SENTENCES as sentence}
							<p>{sentence}</p>
						{/each}
					</section>
					<section>
						<h2>Final answer</h2>
						<p>{GCSE_FINAL_ANSWER}</p>
					</section>
				</div>
			</article>
		</div>
	{:else if variant.id === 'v17'}
		<div class="reading-stage reading-stage--card">
			<article class="exam-reading-card">
				<div class="exam-reading-main">
					<p>{ORIGINAL_QUESTION}</p>
					<h1>{GCSE_FINAL_ANSWER}</h1>
				</div>
				<div class="exam-reading-grid">
					<section>
						<h2>Key knowledge</h2>
						<ol>
							{#each READING_KEY_KNOWLEDGE as point, index}
								<li>
									<span>{String.fromCharCode(97 + index)}.</span>
									<p>{point}</p>
								</li>
							{/each}
						</ol>
					</section>
					<section>
						<h2>Outline</h2>
						<ol>
							{#each READING_OUTLINE as point, index}
								<li>
									<span>{String.fromCharCode(97 + index)}.</span>
									<p>{point}</p>
								</li>
							{/each}
						</ol>
					</section>
					<section>
						<h2>Key sentences</h2>
						<ol>
							{#each READING_KEY_SENTENCES as sentence, index}
								<li>
									<span>{String.fromCharCode(97 + index)}.</span>
									<p>{sentence}</p>
								</li>
							{/each}
						</ol>
					</section>
				</div>
			</article>
		</div>
	{:else if variant.id === 'v7'}
		<div class="climb-stage">
			<section class="climb-map">
				<div class="heart-target">
					<span>Destination</span>
					<h1>{SHORT_QUESTION}</h1>
				</div>
				<div class="climb-path">
					<span class="path-line" aria-hidden="true"></span>
					{#each GUIDE_STEPS as step, index (step.id)}
						{@const entry = climbEntries[index]}
						<article
							class={entry
								? 'climb-node climb-node--done'
								: index === climbEntries.length
									? 'climb-node climb-node--active'
									: 'climb-node'}
						>
							<span>{(index + 1).toString()}</span>
							<strong>{step.shortLabel}</strong>
							{#if entry}
								<p>{step.answer}</p>
							{/if}
						</article>
					{/each}
				</div>
				{#if !climbComplete && climbCurrentStep}
					<form class="climb-card" onsubmit={submitClimbStep}>
						<span>Checkpoint {(climbEntries.length + 1).toString()}</span>
						<h2>{climbCurrentStep.question}</h2>
						<input
							bind:value={climbDraft}
							placeholder="Answer to keep climbing"
							autocomplete="off"
						/>
						<div class="action-row">
							<button class="primary-action" disabled={climbDraft.trim().length === 0}>Climb</button
							>
							<button type="button" class="quiet-action" onclick={revealClimbStep}
								>Show checkpoint</button
							>
						</div>
					</form>
				{:else}
					<section class="final-panel climb-final">
						<h2>You reached the heart. Write the answer.</h2>
						<textarea
							bind:value={climbFinalDraft}
							rows="5"
							placeholder="Use the path from legs to heart."
						></textarea>
						<div class="action-row">
							<button type="button" class="primary-action" onclick={() => (climbShowModel = true)}>
								Show model
							</button>
							<button type="button" class="quiet-action" onclick={resetState}>Restart climb</button>
						</div>
						{#if climbShowModel}
							<aside class="model-answer">
								<span>Model answer</span>
								<p>{FINAL_ANSWER}</p>
							</aside>
						{/if}
					</section>
				{/if}
			</section>
		</div>
	{:else if variant.id === 'v8'}
		<div class="lab-stage">
			<section class="flow-lab">
				<header>
					<span>Experiment prompt</span>
					<h1>{ORIGINAL_QUESTION}</h1>
				</header>
				<div class="flow-board">
					<aside class="condition-strip condition-strip--vein">
						<span>Vein conditions</span>
						<strong>low pressure</strong>
						<p>Blood has to return upward from the legs.</p>
					</aside>
					<div class="vessel-diagram" aria-label="Blood flow comparison">
						<div class="vessel vessel--vein">
							<span class="blood-dot blood-dot--one"></span>
							<span class="blood-dot blood-dot--two"></span>
							<strong>Vein return</strong>
						</div>
						<div class="vessel vessel--artery">
							<span class="blood-dot blood-dot--three"></span>
							<span class="blood-dot blood-dot--four"></span>
							<strong>Artery push</strong>
						</div>
					</div>
					<aside class="condition-strip condition-strip--artery">
						<span>Artery conditions</span>
						<strong>high pressure</strong>
						<p>Blood is driven forward from the heart.</p>
					</aside>
				</div>
				<div class="lab-timeline">
					{#each GUIDE_STEPS as step, index (step.id)}
						{@const entry = labEntries[index]}
						<span class={entry ? 'timeline-chip timeline-chip--done' : 'timeline-chip'}>
							{entry ? step.answer : step.shortLabel}
						</span>
					{/each}
				</div>
				{#if !labComplete && labCurrentStep}
					<form class="lab-task" onsubmit={submitLabStep}>
						<span>Stress point {(labEntries.length + 1).toString()}</span>
						<h2>{labCurrentStep.question}</h2>
						<div class="choice-grid">
							{#each labCurrentStep.options as option (option.id)}
								<button
									type="button"
									class={buildChoiceClass(option.id, labSelectedOptionId)}
									onclick={() => (labSelectedOptionId = option.id)}
								>
									{option.label}
								</button>
							{/each}
						</div>
						<div class="action-row">
							<button class="primary-action" disabled={!labSelectedOptionId}>Run test</button>
							<button type="button" class="quiet-action" onclick={revealLabPoint}
								>Resolve point</button
							>
						</div>
					</form>
				{:else}
					<section class="final-panel lab-final">
						<h2>Write the lab conclusion.</h2>
						<textarea
							bind:value={labFinalDraft}
							rows="5"
							placeholder="Explain the difference between veins and arteries."
						></textarea>
						<div class="action-row">
							<button type="button" class="primary-action" onclick={() => (labShowModel = true)}>
								Show conclusion
							</button>
							<button type="button" class="quiet-action" onclick={resetState}>Reset lab</button>
						</div>
						{#if labShowModel}
							<aside class="model-answer">
								<span>Lab conclusion</span>
								<p>{FINAL_ANSWER}</p>
							</aside>
						{/if}
					</section>
				{/if}
			</section>
		</div>
	{:else if variant.id === 'v9'}
		<div class="import-stage">
			<section class="design-b">
				<div class="db-header">
					<div class="db-label">Your challenge</div>
					<div class="db-q">{ORIGINAL_QUESTION}</div>
				</div>
				<div class="db-steps">
					{#each GUIDE_STEPS as step, index (step.id)}
						<div class={index > importedScrollCount ? 'db-step db-locked' : 'db-step'}>
							<div class="db-line-col">
								<div
									class={index < importedScrollCount
										? 'db-circle done'
										: index === importedScrollCount
											? 'db-circle active'
											: 'db-circle'}
								>
									{(index + 1).toString()}
								</div>
								{#if index < GUIDE_STEPS.length - 1}
									<div class={index < importedScrollCount ? 'db-vline done' : 'db-vline'}></div>
								{/if}
							</div>
							<div class="db-content">
								<div class="db-sq">{step.question}</div>
								<button
									type="button"
									class={index < importedScrollCount
										? 'db-answer-reveal revealed'
										: 'db-answer-reveal'}
									onclick={() => revealImportedScrollStep(index)}
								>
									{index < importedScrollCount ? step.answer : 'Tap to reveal the key idea'}
								</button>
							</div>
						</div>
					{/each}
				</div>
				{#if importedScrollComplete}
					<div class="db-final" style="display:block">
						<div class="db-final-label">Complete answer</div>
						<div class="db-final-text">{FINAL_ANSWER}</div>
					</div>
				{/if}
			</section>
		</div>
	{:else}
		<div class="import-stage">
			<section class="panel on imported-panel">
				<div class="d2-bq">{ORIGINAL_QUESTION}</div>
				<div class="d2-reveal">
					<div class="d2-reveal-lbl">Unlock the answer — one piece at a time</div>
					<div class="d2-rtxt">
						Veins need
						<span class={importedRevealCount >= 5 ? 'd2-blank on' : 'd2-blank'}>valves</span>
						because their blood must
						<span class={importedRevealCount >= 1 ? 'd2-blank on' : 'd2-blank'}
							>return to the heart</span
						>, often travelling
						<span class={importedRevealCount >= 2 ? 'd2-blank on' : 'd2-blank'}>upward</span>
						against
						<span class={importedRevealCount >= 3 ? 'd2-blank on' : 'd2-blank'}>gravity</span>,
						preventing
						<span class={importedRevealCount >= 4 ? 'd2-blank on' : 'd2-blank'}>backflow</span>.
						Arteries do not need them because blood moves under
						<span class={importedRevealCount >= 6 ? 'd2-blank on' : 'd2-blank'}
							>high heart pressure</span
						>.
					</div>
				</div>
				<div class="d2-dots">
					{#each GUIDE_STEPS as step, index (step.id)}
						<div
							class={index < importedRevealCount
								? 'd2-dot done'
								: index === importedRevealCount
									? 'd2-dot active'
									: 'd2-dot'}
						></div>
					{/each}
				</div>
				{#if !importedRevealComplete}
					<div class="d2-qcard">
						<div class="d2-stp">Step {(importedRevealCount + 1).toString()} of 6</div>
						<div class="d2-q">{GUIDE_STEPS[importedRevealCount]?.question}</div>
						<div class="d2-irow">
							<input
								class="inp"
								type="text"
								bind:value={importedRevealDraft}
								placeholder="Your answer..."
							/>
							<button class="btn-te" type="button" onclick={revealImportedAnswerPiece}>Go</button>
						</div>
						<div class="d2-fb">
							{#if importedRevealDraft.trim().length > 0}
								Ready to unlock the next part.
							{/if}
						</div>
					</div>
				{:else}
					<div class="d2-done">Complete — the full explanation is now unlocked above.</div>
				{/if}
			</section>
		</div>
	{/if}
</section>

<style>
	.guide-detail {
		--ink: var(--foreground);
		--muted: color-mix(in srgb, var(--foreground) 68%, transparent);
		--line: color-mix(in srgb, var(--border) 88%, transparent);
		--paper: var(--card);
		--wash: color-mix(in srgb, var(--card) 96%, var(--background));
		--mint: color-mix(in srgb, #dbeafe 72%, var(--card));
		--teal: #36587a;
		--coral: #4d7aa5;
		--yellow: #e8f2fb;
		--green: #2f6f58;
		--red: #7a4a3b;
		--shadow: 0 22px 70px -48px rgba(15, 23, 42, 0.45);
		position: relative;
		width: 100%;
		height: 100dvh;
		min-height: 100dvh;
		overflow: auto;
		background: transparent;
		color: var(--ink);
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif,
			'Apple Color Emoji', 'Segoe UI Emoji';
		letter-spacing: 0;
	}

	.guide-detail *,
	.guide-detail *::before,
	.guide-detail *::after {
		box-sizing: border-box;
		letter-spacing: 0;
	}

	.guide-close-button {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 0.9rem);
		right: calc(env(safe-area-inset-right, 0px) + 1rem);
		z-index: 30;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: 2px solid rgba(255, 255, 255, 0.65);
		border-radius: 9999px;
		background: color-mix(in srgb, var(--app-content-bg) 68%, transparent);
		color: var(--foreground);
		text-decoration: none;
		box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
		backdrop-filter: blur(18px);
	}

	:global([data-theme='dark'] .guide-close-button),
	:global(:root:not([data-theme='light']) .guide-close-button) {
		background: color-mix(in srgb, rgba(6, 11, 25, 0.72) 100%, transparent);
	}

	.guide-close-button:hover {
		background: color-mix(in srgb, var(--app-content-bg) 82%, transparent);
	}

	.guide-close-button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}

	:global(.guide-close-button__icon) {
		width: 1rem;
		height: 1rem;
	}

	.sheet-stage,
	.pinboard-stage,
	.transcript-stage,
	.builder-stage,
	.gap-stage,
	.stamp-stage,
	.sheet-inline-stage,
	.minimal-fill-stage,
	.prompted-sheet-stage,
	.reading-stage,
	.climb-stage,
	.lab-stage {
		width: min(1040px, calc(100% - 48px));
		min-height: 100dvh;
		margin: 0 auto;
		padding: 4.25rem 0 2.5rem;
	}

	.import-stage {
		--font-sans:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif,
			'Apple Color Emoji', 'Segoe UI Emoji';
		--font-serif: Georgia, 'Times New Roman', serif;
		--border-radius-md: 8px;
		--border-radius-lg: 8px;
		--color-background-primary: #ffffff;
		--color-background-secondary: #f4f6f8;
		--color-border-secondary: #d5dbe2;
		--color-border-tertiary: #e6e9ed;
		--color-text-primary: #172231;
		--color-text-secondary: #536170;
		--color-text-tertiary: #8a96a3;
		--am: #ba7517;
		--am-bg: #faeeda;
		--am-bd: #ef9f27;
		--te: #0f6e56;
		--te-bg: #e1f5ee;
		--te-bd: #1d9e75;
		--pu: #534ab7;
		--pu-bg: #eeedfe;
		--pu-bd: #7f77dd;
		width: min(900px, calc(100% - 48px));
		min-height: 100dvh;
		margin: 0 auto;
		padding: 3.5rem 0 2.5rem;
	}

	.answer-sheet,
	.pinboard,
	.transcript,
	.builder-shell,
	.gap-sheet,
	.lab-report,
	.climb-map,
	.flow-lab {
		border: 1px solid rgba(24, 33, 49, 0.16);
		border-radius: 8px;
		background: color-mix(in srgb, var(--card) 94%, transparent);
		box-shadow: var(--shadow);
	}

	.answer-sheet {
		max-width: 900px;
		margin: 0 auto;
	}

	.pinboard {
		max-width: 960px;
		margin: 0 auto;
	}

	.answer-sheet,
	.pinboard,
	.transcript,
	.gap-sheet,
	.lab-report,
	.flow-lab {
		padding: 1.5rem;
	}

	.answer-sheet__question,
	.target-question,
	.gap-sheet__question,
	.rail-question,
	.heart-target,
	.flow-lab > header,
	.lab-report > header {
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-left: 4px solid var(--coral);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.88);
	}

	.answer-sheet__question,
	.target-question,
	.gap-sheet__question,
	.flow-lab > header,
	.lab-report > header {
		padding: 1rem 1.1rem;
	}

	.target-question span,
	.gap-sheet__question span,
	.rail-question span,
	.heart-target span,
	.flow-lab > header span,
	.lab-report > header span,
	.prompt-card > p,
	.choice-stage > span,
	.word-bank > span,
	.stamp-bank > span,
	.sentence-bank > span,
	.climb-card > span,
	.lab-task > span,
	.model-answer span {
		display: block;
		margin-bottom: 8px;
		color: var(--teal);
		font-size: 0.76rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.answer-sheet__question strong,
	.target-question h1,
	.gap-sheet__question h1,
	.rail-question strong,
	.heart-target h1,
	.flow-lab > header h1,
	.lab-report > header h1 {
		display: block;
		margin: 0;
		color: var(--ink);
		font-size: clamp(1.1rem, 1.65vw, 1.32rem);
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	.sheet-heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 20px;
		margin-top: 1.25rem;
	}

	.sheet-heading--progress-only {
		justify-content: flex-end;
	}

	.prompt-card h1,
	.prompt-card h2,
	.choice-stage h2,
	.final-panel h2,
	.climb-card h2,
	.lab-task h2 {
		margin: 0;
		color: var(--ink);
		line-height: 1.08;
	}

	.sheet-heading > strong {
		flex: 0 0 auto;
		padding: 8px 12px;
		border: 1px solid rgba(49, 117, 95, 0.24);
		border-radius: 8px;
		background: #f2fbf7;
		color: var(--green);
	}

	.progress-track {
		height: 8px;
		margin: 1rem 0 1.1rem;
		border-radius: 8px;
		background: rgba(24, 33, 49, 0.1);
		overflow: hidden;
	}

	.progress-track span {
		display: block;
		width: var(--guide-progress);
		height: 100%;
		border-radius: 8px;
		background: linear-gradient(90deg, var(--teal), var(--yellow), var(--coral));
		transition: width 0.2s ease;
	}

	.context-stack {
		display: grid;
		gap: 10px;
	}

	.context-row,
	.builder-step,
	.report-line {
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr);
		gap: 12px;
		align-items: start;
		padding: 0.75rem;
		border: 1px solid rgba(24, 33, 49, 0.12);
		border-radius: 8px;
		background: rgba(244, 251, 250, 0.9);
	}

	.context-row > span,
	.builder-step > span,
	.report-line > span,
	.evidence-slip > span,
	.climb-node > span {
		display: inline-flex;
		width: 26px;
		height: 26px;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		background: var(--ink);
		color: #ffffff;
		font-weight: 600;
	}

	.context-row p,
	.context-row strong,
	.builder-step p,
	.builder-step strong,
	.builder-step em,
	.evidence-slip p,
	.evidence-slip strong,
	.coach-message p,
	.report-line p {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.context-row p,
	.builder-step p {
		color: var(--muted);
		line-height: 1.4;
	}

	.context-row strong,
	.builder-step em {
		display: block;
		margin-top: 4px;
		color: var(--green);
		font-style: normal;
	}

	.prompt-card,
	.choice-stage,
	.final-panel,
	.climb-card,
	.lab-task {
		margin-top: 1rem;
		padding: 1.25rem;
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.92);
	}

	.prompt-card--focus {
		max-width: 760px;
	}

	.prompt-card h1,
	.prompt-card h2,
	.choice-stage h2,
	.climb-card h2,
	.lab-task h2 {
		font-size: clamp(1.18rem, 1.7vw, 1.42rem);
		letter-spacing: -0.01em;
	}

	.prompt-card small {
		display: block;
		margin-top: 10px;
		color: var(--muted);
		font-size: 0.95rem;
		line-height: 1.45;
	}

	label {
		display: grid;
		gap: 7px;
		margin-top: 18px;
		font-weight: 600;
	}

	input,
	textarea {
		width: 100%;
		border: 1px solid rgba(24, 33, 49, 0.22);
		border-radius: 8px;
		background: #ffffff;
		color: var(--ink);
		font: inherit;
		font-weight: 500;
		line-height: 1.45;
		outline: none;
	}

	input {
		min-height: 46px;
		padding: 0 14px;
	}

	textarea {
		min-height: 150px;
		resize: vertical;
		padding: 14px;
	}

	input:focus,
	textarea:focus {
		border-color: var(--teal);
		box-shadow: 0 0 0 3px rgba(51, 143, 137, 0.16);
	}

	.action-row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 18px;
	}

	button,
	.primary-action,
	.quiet-action {
		min-height: 42px;
		border-radius: 8px;
		font: inherit;
		font-size: 0.94rem;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.48;
	}

	.primary-action {
		border: 1px solid #13202d;
		background: #13202d;
		color: #ffffff;
		padding: 0 16px;
	}

	.quiet-action {
		border: 1px solid rgba(24, 33, 49, 0.18);
		background: #ffffff;
		color: var(--ink);
		padding: 0 14px;
	}

	.model-answer {
		margin-top: 18px;
		padding: 16px;
		border: 1px solid rgba(49, 117, 95, 0.28);
		border-left: 6px solid var(--green);
		border-radius: 8px;
		background: #f2fbf7;
	}

	.model-answer p {
		margin: 0;
		font-size: 1.04rem;
		line-height: 1.55;
	}

	.pinboard {
		display: grid;
		gap: 18px;
	}

	.target-question {
		width: min(720px, 100%);
		justify-self: center;
		text-align: center;
	}

	.slip-strip {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}

	.evidence-slip {
		min-height: 104px;
		padding: 0.75rem;
		border: 1px dashed rgba(24, 33, 49, 0.18);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.74);
	}

	.evidence-slip--filled {
		border-style: solid;
		background: #fff8d7;
		box-shadow: inset 0 -4px 0 rgba(241, 207, 90, 0.58);
	}

	.evidence-slip strong,
	.evidence-slip p {
		display: block;
		margin-top: 10px;
	}

	.choice-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.choice-option {
		min-height: 76px;
		border: 1px solid rgba(24, 33, 49, 0.16);
		background: #ffffff;
		color: var(--ink);
		padding: 0.75rem;
		text-align: left;
		line-height: 1.3;
	}

	.choice-option--selected {
		border-color: var(--teal);
		background: #eaf8f5;
		box-shadow: inset 0 0 0 2px rgba(51, 143, 137, 0.2);
	}

	.inline-feedback {
		margin: 12px 0 0;
		color: var(--green);
		font-weight: 600;
	}

	.transcript {
		max-width: 900px;
		margin: 0 auto;
	}

	.message-list {
		display: grid;
		gap: 12px;
	}

	.coach-message {
		max-width: 100%;
		padding: 14px 16px;
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: #ffffff;
	}

	.coach-message span {
		display: block;
		margin-bottom: 6px;
		color: var(--teal);
		font-size: 0.76rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.coach-message--question {
		border-left: 4px solid var(--coral);
	}

	.coach-message--question p {
		font-size: 1.14rem;
		font-weight: 600;
		line-height: 1.45;
	}

	.coach-message--prompt {
		background: #fbfdff;
	}

	.coach-message--prompt p {
		font-size: 1.05rem;
		font-weight: 500;
		line-height: 1.45;
	}

	.coach-message--student {
		justify-self: end;
		background: #13202d;
		color: #ffffff;
	}

	.coach-message--student span {
		color: var(--yellow);
	}

	.coach-message--takeaway {
		border-left: 4px solid var(--green);
		background: #f2fbf7;
	}

	.coach-composer {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 10px;
		align-items: end;
		margin-top: 18px;
		padding: 14px;
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: #ffffff;
	}

	.coach-composer label {
		margin-top: 0;
	}

	.coach-composer .quiet-action {
		grid-column: 1 / -1;
		justify-self: start;
		min-height: 36px;
	}

	.builder-shell {
		display: grid;
		grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
		gap: 1.25rem;
		padding: 1.5rem;
	}

	.builder-rail {
		display: grid;
		gap: 10px;
		align-content: start;
	}

	.rail-question {
		padding: 14px;
	}

	.builder-step--active {
		border-color: color-mix(in srgb, var(--coral) 38%, var(--border));
		background: color-mix(in srgb, var(--yellow) 56%, var(--card));
	}

	.builder-step--done {
		border-color: color-mix(in srgb, var(--green) 30%, var(--border));
		background: color-mix(in srgb, var(--mint) 52%, var(--card));
	}

	.builder-main {
		min-width: 0;
	}

	.sentence-bank {
		margin-top: 1rem;
		padding: 1rem;
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.9);
	}

	.sentence-bank > div {
		display: flex;
		flex-wrap: wrap;
		gap: 9px;
	}

	.sentence-chip {
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		padding: 6px 9px;
		border: 1px solid rgba(51, 143, 137, 0.34);
		border-radius: 8px;
		background: #eaf8f5;
		color: var(--green);
		font-weight: 600;
		font-size: 0.9rem;
		line-height: 1.25;
	}

	.sentence-chip--locked {
		border-style: dashed;
		background: #ffffff;
		color: rgba(82, 97, 113, 0.75);
	}

	.gap-sheet {
		max-width: 860px;
		margin: 0 auto;
	}

	.gap-paragraph {
		display: grid;
		gap: 0.85rem;
		margin-top: 1.25rem;
		font-size: clamp(1rem, 1.35vw, 1.18rem);
		line-height: 1.45;
	}

	.gap-paragraph p {
		margin: 0;
	}

	.blank-slot,
	.stamp-slot {
		display: inline-flex;
		min-width: 104px;
		min-height: 32px;
		align-items: center;
		justify-content: center;
		margin: 0 4px;
		border: 1px solid rgba(51, 143, 137, 0.44);
		border-radius: 8px;
		background: #eaf8f5;
		color: var(--green);
		vertical-align: baseline;
	}

	.clear-blank {
		min-height: 28px;
		margin-left: 6px;
		padding: 0 8px;
		border: 1px solid rgba(24, 33, 49, 0.14);
		background: #ffffff;
		color: var(--muted);
		font-size: 0.8rem;
	}

	.word-bank,
	.stamp-bank {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 1.25rem;
		padding: 1rem;
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: rgba(255, 248, 215, 0.76);
	}

	.word-bank > span,
	.stamp-bank > span {
		width: 100%;
	}

	.bank-chip {
		border: 1px solid rgba(24, 33, 49, 0.16);
		background: #ffffff;
		color: var(--ink);
		padding: 0 14px;
	}

	.bank-chip--selected {
		border-color: var(--coral);
		background: #fff1ed;
	}

	.bank-chip--used {
		background: #eef2f2;
		color: rgba(82, 97, 113, 0.72);
	}

	.sheet-inline-card {
		--sheet-color: #36587a;
		--sheet-color-08: color-mix(in srgb, var(--sheet-color) 8%, #ffffff);
		--sheet-color-14: color-mix(in srgb, var(--sheet-color) 14%, #ffffff);
		--sheet-color-25: color-mix(in srgb, var(--sheet-color) 25%, transparent);
		--sheet-color-30: color-mix(in srgb, var(--sheet-color) 30%, transparent);
		--sheet-color-60: color-mix(in srgb, var(--sheet-color) 60%, transparent);
		--paper-text: #1a1a1a;
		--paper-text-strong: #111111;
		--paper-text-soft: #555555;
		--paper-text-muted: #666666;
		--paper-placeholder: #8a8a8a;
		--paper-reading-size: 16px;
		--paper-reading-line-height: 1.8;
		max-width: 1024px;
		margin: 0 auto;
		overflow: hidden;
		border: 1px solid rgba(24, 33, 49, 0.16);
		border-radius: 8px;
		background: #ffffff;
		box-shadow: 0 22px 70px -48px rgba(15, 23, 42, 0.55);
		color: var(--paper-text);
		font-family: Georgia, 'Times New Roman', serif;
	}

	.sheet-inline-header {
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

	.sheet-inline-header::before,
	.sheet-inline-header::after {
		content: '';
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
	}

	.sheet-inline-header::before {
		top: -34px;
		right: -30px;
		width: 118px;
		height: 118px;
	}

	.sheet-inline-header::after {
		right: 60px;
		bottom: -24px;
		width: 82px;
		height: 82px;
		background: rgba(255, 255, 255, 0.06);
	}

	.sheet-inline-header > * {
		position: relative;
		z-index: 1;
	}

	.sheet-inline-header span,
	.sheet-inline-objective span,
	.sheet-inline-model span {
		display: block;
		font-size: var(--paper-reading-size);
		font-weight: 700;
	}

	.sheet-inline-header span {
		margin-bottom: 0.35rem;
		color: rgba(255, 255, 255, 0.72);
	}

	.sheet-inline-header h1 {
		margin: 0;
		font-size: clamp(1.45rem, 2.2vw, 1.9rem);
		font-weight: 900;
		line-height: 1.16;
	}

	.sheet-inline-header strong {
		flex-shrink: 0;
		margin-top: 0.15rem;
		color: rgba(255, 255, 255, 0.82);
		font-size: var(--paper-reading-size);
		text-align: right;
	}

	.sheet-inline-body {
		padding: 1.5rem 2rem 2rem;
	}

	.sheet-inline-objective {
		margin-bottom: 1rem;
		padding-left: 1rem;
		border-left: 4px solid var(--sheet-color);
	}

	.sheet-inline-objective span {
		margin-bottom: 0.15rem;
		color: var(--sheet-color);
	}

	.sheet-inline-objective p {
		margin: 0;
		font-size: var(--paper-reading-size);
		line-height: var(--paper-reading-line-height);
	}

	.sheet-inline-section-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0;
		border: 1.5px solid var(--sheet-color-30);
		border-bottom: 0;
		border-radius: 8px 8px 0 0;
		background: var(--sheet-color-14);
		padding: 0.75rem 1.1rem;
		font-size: var(--paper-reading-size);
	}

	.sheet-inline-section-bar strong {
		font-weight: 700;
	}

	.sheet-inline-section-bar span {
		color: var(--paper-text-muted);
	}

	.sheet-inline-questions {
		border: 1.5px solid var(--sheet-color-30);
		border-radius: 0 0 8px 8px;
		background: #ffffff;
	}

	.sheet-inline-question {
		display: grid;
		grid-template-columns: 48px minmax(0, 1fr) auto;
		column-gap: 0.75rem;
		align-items: start;
		padding: 1rem 1.1rem;
		border-bottom: 1px dashed rgba(24, 33, 49, 0.13);
	}

	.sheet-inline-question:last-child {
		border-bottom: 0;
	}

	.sheet-inline-number {
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

	.sheet-inline-marks {
		grid-column: 3;
		grid-row: 1;
		flex-shrink: 0;
		margin-top: 0.25rem;
		color: var(--sheet-color);
		font-size: 0.92rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.sheet-inline-question-body {
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
	}

	.sheet-inline-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		font-size: var(--paper-reading-size);
		line-height: var(--paper-reading-line-height);
	}

	.sheet-inline-input {
		width: auto;
		max-width: 100%;
		border: 0;
		border-bottom: 2px solid var(--sheet-color-60);
		border-radius: 3px 3px 0 0;
		background: transparent;
		padding: 2px 6px;
		outline: none;
		color: var(--paper-text-strong);
		font: inherit;
		font-weight: 600;
		transition:
			border-color 0.2s ease,
			background 0.2s ease;
	}

	.sheet-inline-input--compact {
		width: 150px;
		min-width: 150px;
	}

	.sheet-inline-input--hinted {
		flex: 0 1 25rem;
		width: min(100%, 25rem);
		min-width: min(100%, 20rem);
		padding-block: 4px;
	}

	.sheet-inline-input::placeholder {
		color: var(--paper-placeholder);
		font-weight: 500;
		opacity: 1;
	}

	.sheet-inline-input:focus {
		border-color: var(--sheet-color);
		background: var(--sheet-color-08);
	}

	.sheet-inline-input.is-correct {
		border-color: #22a66e;
		background: #edfdf6;
	}

	.sheet-inline-input.is-needs-work {
		border-color: #c66317;
		background: #fbefe3;
	}

	.sheet-inline-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #e0e0e0;
		color: var(--paper-text-muted);
		font-size: var(--paper-reading-size);
	}

	.sheet-inline-footer > div {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		justify-content: flex-end;
	}

	.sheet-inline-submit,
	.sheet-inline-secondary {
		min-height: 40px;
		border-radius: 8px;
		padding: 0 1rem;
		font: inherit;
		font-size: var(--paper-reading-size);
		font-weight: 700;
		cursor: pointer;
	}

	.sheet-inline-submit {
		border: 0;
		background: var(--sheet-color);
		color: #ffffff;
		box-shadow: 0 3px 12px var(--sheet-color-30);
	}

	.sheet-inline-secondary {
		border: 1.5px solid var(--sheet-color);
		background: #ffffff;
		color: var(--sheet-color);
	}

	.sheet-inline-submit:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.sheet-inline-model {
		margin-top: 1.2rem;
		padding: 1rem 1.1rem;
		border: 1.5px solid #22a66e;
		border-radius: 8px;
		background: #edfdf6;
	}

	.sheet-inline-model span {
		margin-bottom: 0.35rem;
		color: #1a8c5b;
	}

	.sheet-inline-model p {
		margin: 0;
		font-size: var(--paper-reading-size);
		line-height: var(--paper-reading-line-height);
	}

	.minimal-fill-stage {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-top: 2rem;
		padding-bottom: 2rem;
	}

	.minimal-fill-form {
		width: min(860px, 100%);
		color: #171717;
		font-family: Georgia, 'Times New Roman', serif;
	}

	.minimal-fill-form h1 {
		margin: 0 0 2.1rem;
		font-size: clamp(1.45rem, 2vw, 1.9rem);
		font-weight: 700;
		line-height: 1.18;
	}

	.minimal-fill-lines {
		display: grid;
		gap: 1.18rem;
	}

	.minimal-fill-lines p {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: baseline;
		margin: 0;
		font-size: clamp(1.2rem, 1.65vw, 1.46rem);
		line-height: 1.85;
	}

	.minimal-fill-input {
		width: 10.5rem;
		min-width: 10.5rem;
		border-bottom-color: #5c7890;
		border-radius: 0;
		background:
			linear-gradient(#5c7890, #5c7890) left calc(100% - 2px) / 100% 2px no-repeat,
			transparent;
		min-height: 0;
		height: 1.45em;
		padding: 0 0.2rem 0.02rem;
		line-height: 1.2;
		text-align: center;
	}

	.minimal-fill-input:focus {
		background:
			linear-gradient(#36587a, #36587a) left calc(100% - 2px) / 100% 2px no-repeat,
			#f0f7fb;
	}

	.minimal-fill-input.is-correct {
		border-color: #1f8d62;
		background: #edf9f3;
	}

	.minimal-fill-input.is-needs-work {
		border-color: #b65f21;
		background: #fbefe3;
	}

	.minimal-fill-submit {
		min-width: 116px;
		margin-top: 2rem;
		border: 1px solid #182131;
		border-radius: 8px;
		background: #182131;
		color: #ffffff;
		padding: 0 1.2rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
		font-size: 0.95rem;
	}

	.prompted-sheet-stage {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-top: 2.5rem;
		padding-bottom: 3rem;
	}

	.prompted-sheet-form {
		--prompted-sheet-blue: #36587a;
		--prompted-sheet-green: #1f8d62;
		--prompted-sheet-yellow: #a76b16;
		--prompted-sheet-red: #ad4d33;
		width: min(980px, 100%);
		border: 1px solid rgba(24, 33, 49, 0.16);
		border-radius: 8px;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		box-shadow: 0 22px 70px -48px rgba(15, 23, 42, 0.5);
		color: #171717;
		font-family: Georgia, 'Times New Roman', serif;
		padding: 2rem 2.2rem 1.6rem;
	}

	.prompted-sheet-header {
		display: grid;
		gap: 0.65rem;
		margin-bottom: 1.8rem;
		border-left: 5px solid var(--prompted-sheet-blue);
		padding-left: 1rem;
	}

	.prompted-sheet-header p {
		margin: 0;
		color: #4f5f70;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
		font-size: clamp(1.18rem, 1.65vw, 1.45rem);
		font-weight: 650;
		line-height: 1.32;
	}

	.prompted-sheet-lines {
		display: grid;
		gap: 0.7rem;
	}

	.prompted-sheet-line {
		display: block;
		margin: 0;
		font-weight: 400;
	}

	.prompted-sheet-sentence {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: flex-start;
		font-size: clamp(1.12rem, 1.48vw, 1.32rem);
		line-height: 1.52;
	}

	.prompted-sheet-field {
		display: inline-flex;
		width: min(18.5rem, 100%);
		min-height: 4.4rem;
		flex-direction: column;
		justify-content: flex-start;
	}

	.prompted-sheet-input {
		width: 100%;
		min-height: 2.55rem;
		border: 0;
		border-bottom: 2px solid rgba(54, 88, 122, 0.68);
		border-radius: 4px 4px 0 0;
		background: rgba(255, 255, 255, 0.62);
		color: #182131;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1rem;
		font-weight: 650;
		line-height: 1.3;
		padding: 0.42rem 0.5rem 0.34rem;
		transition:
			background 0.18s ease,
			border-color 0.18s ease,
			color 0.18s ease;
	}

	.prompted-sheet-input::placeholder {
		color: rgba(65, 78, 93, 0.82);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.2;
		opacity: 1;
	}

	.prompted-sheet-input:focus {
		border-color: var(--prompted-sheet-blue);
		background: #eef6fa;
		box-shadow: none;
	}

	.prompted-sheet-input--judging {
		border-color: var(--prompted-sheet-blue);
		background: #eef6fa;
		color: #284863;
	}

	.prompted-sheet-input--correct {
		border-color: var(--prompted-sheet-green);
		background: #edf9f3;
		color: #176444;
	}

	.prompted-sheet-input--partial {
		border-color: var(--prompted-sheet-yellow);
		background: #fff7df;
		color: #765014;
	}

	.prompted-sheet-input--incorrect,
	.prompted-sheet-input--error {
		border-color: var(--prompted-sheet-red);
		background: #fff0eb;
		color: #8b3d28;
	}

	.prompted-sheet-feedback {
		display: block;
		min-height: 1.45rem;
		margin-top: 0.24rem;
		color: #637083;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
		font-size: 0.76rem;
		font-weight: 650;
		line-height: 1.25;
	}

	.prompted-sheet-feedback--correct {
		color: var(--prompted-sheet-green);
	}

	.prompted-sheet-feedback--partial {
		color: var(--prompted-sheet-yellow);
	}

	.prompted-sheet-feedback--incorrect,
	.prompted-sheet-feedback--error {
		color: var(--prompted-sheet-red);
	}

	.prompted-sheet-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.9rem;
	}

	.prompted-sheet-submit {
		min-width: 116px;
		border: 1px solid #182131;
		border-radius: 8px;
		background: #182131;
		color: #ffffff;
		padding: 0 1.2rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
		font-size: 0.95rem;
	}

	.reading-stage {
		width: min(1080px, calc(100% - 56px));
		padding-top: 4.5rem;
		color: #182131;
	}

	.reading-sheet,
	.reading-spine,
	.exam-reading-card {
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.94);
		box-shadow: 0 22px 70px -48px rgba(15, 23, 42, 0.45);
	}

	.reading-sheet {
		padding: 1.7rem;
	}

	.reading-sheet-header {
		margin-bottom: 1.45rem;
		border-left: 5px solid #36587a;
		padding-left: 1rem;
	}

	.reading-sheet-header p,
	.reading-spine-header p,
	.exam-reading-main p {
		margin: 0;
		color: #526171;
		font-size: clamp(1rem, 1.35vw, 1.16rem);
		font-weight: 650;
		line-height: 1.45;
	}

	.reading-sheet-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
		gap: 1rem;
	}

	.reading-block,
	.reading-final {
		border: 1px solid rgba(24, 33, 49, 0.12);
		border-radius: 8px;
		background: #ffffff;
		padding: 1.1rem;
	}

	.reading-block--large {
		grid-row: span 2;
		background: #f5fbf8;
	}

	.reading-block h1,
	.reading-block h2,
	.reading-final h2,
	.spine-support h2,
	.exam-reading-grid h2 {
		margin: 0 0 0.9rem;
		color: #182131;
		font-size: 1rem;
		font-weight: 800;
		line-height: 1.2;
	}

	.reading-block h1 {
		font-size: clamp(1.3rem, 2vw, 1.7rem);
	}

	.reading-letter-list,
	.exam-reading-grid ol {
		display: grid;
		gap: 0.78rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.reading-letter-list li,
	.exam-reading-grid li {
		display: grid;
		grid-template-columns: 1.8rem minmax(0, 1fr);
		gap: 0.45rem;
		align-items: start;
	}

	.reading-letter-list span,
	.exam-reading-grid li span,
	.spine-node span {
		color: #36587a;
		font-weight: 800;
	}

	.reading-letter-list p,
	.exam-reading-grid li p,
	.spine-node p {
		margin: 0;
		color: #263445;
		font-size: 1rem;
		line-height: 1.55;
	}

	.reading-final {
		margin-top: 1rem;
		border-color: rgba(47, 111, 88, 0.2);
		background: #eff8f3;
	}

	.reading-final p {
		margin: 0;
		font-size: clamp(1.08rem, 1.55vw, 1.24rem);
		font-weight: 650;
		line-height: 1.58;
	}

	.reading-spine {
		overflow: hidden;
	}

	.reading-spine-header {
		padding: 1.7rem;
		background: #f5fbf8;
	}

	.reading-spine-header h1 {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		align-items: center;
		margin: 1.2rem 0 0;
		font-size: clamp(1.7rem, 3vw, 2.75rem);
		line-height: 1.08;
	}

	.reading-spine-header h1 span {
		color: #182131;
	}

	.reading-spine-header h1 b {
		color: #50708b;
		font-size: 0.82em;
		font-weight: 500;
	}

	.spine-track {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1px;
		background: rgba(24, 33, 49, 0.12);
	}

	.spine-node {
		min-height: 158px;
		background: #ffffff;
		padding: 1.2rem;
	}

	.spine-node span {
		display: block;
		margin-bottom: 1.25rem;
	}

	.spine-node p {
		font-size: clamp(1.05rem, 1.5vw, 1.24rem);
		font-weight: 680;
	}

	.spine-support {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1rem;
		padding: 1rem;
	}

	.spine-support section {
		border: 1px solid rgba(24, 33, 49, 0.12);
		border-radius: 8px;
		padding: 1rem;
	}

	.spine-support p {
		margin: 0;
		color: #263445;
		font-size: 1rem;
		line-height: 1.55;
	}

	.spine-support p + p {
		margin-top: 0.65rem;
	}

	.spine-support section:last-child {
		background: #eff8f3;
	}

	.exam-reading-card {
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		min-height: 640px;
		overflow: hidden;
	}

	.exam-reading-main {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 1.3rem;
		background: #f5fbf8;
		padding: 2.2rem;
	}

	.exam-reading-main h1 {
		margin: 0;
		color: #182131;
		font-size: clamp(1.75rem, 3vw, 2.7rem);
		line-height: 1.14;
	}

	.exam-reading-grid {
		display: grid;
		gap: 1px;
		background: rgba(24, 33, 49, 0.12);
	}

	.exam-reading-grid section {
		display: grid;
		align-content: center;
		background: #ffffff;
		padding: 1.35rem;
	}

	.lab-report {
		max-width: 900px;
		margin: 0 auto;
	}

	.report-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 240px;
		gap: 1rem;
		margin-top: 1.1rem;
		align-items: start;
	}

	.report-lines {
		display: grid;
		gap: 10px;
	}

	.report-line {
		background: #ffffff;
	}

	.report-line p {
		font-size: 1rem;
		line-height: 1.45;
	}

	.stamp-bank {
		align-content: start;
		margin-top: 0;
	}

	.climb-map {
		position: relative;
		display: grid;
		grid-template-columns: minmax(250px, 320px) minmax(0, 1fr);
		gap: 1.25rem;
		padding: 1.5rem;
	}

	.heart-target {
		grid-column: 1 / -1;
		padding: 18px 20px;
	}

	.climb-path {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-left: 22px;
	}

	.path-line {
		position: absolute;
		top: 10px;
		bottom: 10px;
		left: 36px;
		width: 4px;
		border-radius: 9999px;
		background: linear-gradient(0deg, var(--coral), var(--yellow), var(--teal));
	}

	.climb-node {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr);
		gap: 10px;
		align-items: start;
		min-height: 56px;
		padding: 0.55rem 0.65rem;
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.9);
	}

	.climb-node--active {
		background: #fff8d7;
		border-color: rgba(237, 123, 104, 0.6);
	}

	.climb-node--done {
		background: #f2fbf7;
		border-color: rgba(49, 117, 95, 0.32);
	}

	.climb-node p {
		grid-column: 2;
		margin: 0;
		color: var(--green);
		font-weight: 600;
	}

	.climb-card,
	.climb-final {
		margin-top: 0;
		align-self: start;
	}

	.flow-lab {
		display: grid;
		gap: 18px;
	}

	.flow-board {
		display: grid;
		grid-template-columns: minmax(170px, 220px) minmax(0, 1fr) minmax(170px, 220px);
		gap: 16px;
		align-items: start;
	}

	.condition-strip {
		padding: 0.9rem;
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: #ffffff;
	}

	.condition-strip span {
		display: block;
		margin-bottom: 8px;
		color: var(--teal);
		font-weight: 600;
		text-transform: uppercase;
	}

	.condition-strip strong {
		display: block;
		font-size: 1.2rem;
	}

	.condition-strip p {
		margin: 8px 0 0;
		color: var(--muted);
		line-height: 1.45;
	}

	.vessel-diagram {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 18px;
		min-height: 240px;
		padding: 1rem;
		border: 1px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: rgba(244, 251, 250, 0.82);
	}

	.vessel {
		position: relative;
		overflow: hidden;
		border: 3px solid rgba(24, 33, 49, 0.14);
		border-radius: 8px;
		background: linear-gradient(180deg, #fff4f1, #f2fbf7);
	}

	.vessel::before,
	.vessel::after {
		content: '';
		position: absolute;
		left: 50%;
		width: 70%;
		height: 12px;
		transform: translateX(-50%);
		border-radius: 9999px;
		background: rgba(24, 33, 49, 0.14);
	}

	.vessel::before {
		top: 34%;
	}

	.vessel::after {
		top: 62%;
	}

	.vessel--vein::before,
	.vessel--vein::after {
		background: rgba(51, 143, 137, 0.35);
	}

	.vessel--artery::before,
	.vessel--artery::after {
		background: rgba(237, 123, 104, 0.35);
	}

	.vessel strong {
		position: absolute;
		left: 14px;
		bottom: 12px;
	}

	.blood-dot {
		position: absolute;
		left: 50%;
		width: 22px;
		height: 22px;
		border-radius: 9999px;
		background: var(--coral);
		box-shadow: 0 0 0 8px rgba(237, 123, 104, 0.14);
		animation: flow-up 2.8s linear infinite;
	}

	.blood-dot--two {
		animation-delay: -1.4s;
	}

	.blood-dot--three,
	.blood-dot--four {
		background: var(--red);
		animation-name: flow-down;
	}

	.blood-dot--four {
		animation-delay: -1.4s;
	}

	@keyframes flow-up {
		from {
			top: 88%;
		}
		to {
			top: 8%;
		}
	}

	@keyframes flow-down {
		from {
			top: 8%;
		}
		to {
			top: 88%;
		}
	}

	.lab-timeline {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.timeline-chip {
		display: inline-flex;
		align-items: center;
		min-height: 36px;
		padding: 0.45rem 0.7rem;
		border: 1px dashed rgba(24, 33, 49, 0.18);
		border-radius: 8px;
		background: #ffffff;
		color: var(--muted);
		font-weight: 600;
	}

	.timeline-chip--done {
		border-style: solid;
		border-color: rgba(49, 117, 95, 0.3);
		background: #f2fbf7;
		color: var(--green);
	}

	/* Adapted from knowledge_gap_filler_three_designs.html: Design B */
	.design-b {
		padding: 2rem 0 2.5rem;
		max-width: 900px;
		margin: 0 auto;
	}
	.db-header {
		margin-bottom: 1rem;
		padding: 1.05rem 1.25rem;
		border: 0.5px solid #1d9e75;
		border-radius: 8px;
		background: #e1f5ee;
	}
	.db-label {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #0f6e56;
		margin-bottom: 6px;
	}
	.db-q {
		font-size: 1.18rem;
		font-weight: 600;
		color: #04342c;
		line-height: 1.45;
	}
	.db-steps {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 1.05rem 1.1rem 0;
		border: 0.5px solid var(--color-border-secondary);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.88);
	}
	.db-step {
		display: flex;
		gap: 0;
		align-items: stretch;
	}
	.db-line-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 40px;
		flex-shrink: 0;
	}
	.db-circle {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--color-background-secondary);
		border: 2px solid var(--color-border-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-secondary);
		transition: all 0.3s;
		flex-shrink: 0;
	}
	.db-circle.done {
		background: #1d9e75;
		border-color: #1d9e75;
		color: white;
	}
	.db-circle.active {
		background: var(--color-background-primary);
		border-color: #1d9e75;
		color: #0f6e56;
	}
	.db-vline {
		flex: 1;
		width: 2px;
		background: var(--color-border-tertiary);
		margin: 2px 0;
		min-height: 16px;
		transition: background 0.3s;
	}
	.db-vline.done {
		background: #5dcaa5;
	}
	.db-content {
		flex: 1;
		padding: 0 0 1.1rem 1rem;
	}
	.db-sq {
		font-size: 1.02rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin-bottom: 8px;
		padding-top: 4px;
	}
	.db-answer-reveal {
		font-size: 0.95rem;
		min-height: 48px;
		padding: 0.75rem 0.9rem;
		border-radius: 8px;
		background: var(--color-background-secondary);
		color: var(--color-text-secondary);
		border: 0.5px dashed var(--color-border-secondary);
		cursor: pointer;
		font-family: var(--font-sans);
		text-align: left;
		width: 100%;
		transition: all 0.2s;
	}
	.db-answer-reveal.revealed {
		background: #e1f5ee;
		color: #085041;
		border: 0.5px solid #5dcaa5;
		cursor: default;
		font-weight: 500;
	}
	.db-input {
		width: 100%;
		padding: 8px 12px;
		border: 0.5px solid var(--color-border-secondary);
		border-radius: 8px;
		font-size: 13px;
		font-family: var(--font-sans);
		background: var(--color-background-primary);
		color: var(--color-text-primary);
	}
	.db-confirm {
		margin-top: 6px;
		padding: 7px 16px;
		background: #1d9e75;
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: var(--font-sans);
	}
	.db-locked {
		opacity: 0.55;
		pointer-events: none;
	}
	.db-final {
		margin-top: 1rem;
		background: #085041;
		border-radius: 8px;
		padding: 1.25rem;
		display: none;
	}
	.db-final-label {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #9fe1cb;
		margin-bottom: 8px;
	}
	.db-final-text {
		font-size: 15px;
		color: #e1f5ee;
		line-height: 1.6;
	}

	/* Adapted from knowledge_gap_three_ui_designs.html: Design 2 */
	.panel {
		display: none;
		flex-direction: column;
		min-height: auto;
		padding: 2rem 0 2.5rem;
		max-width: 900px;
		margin: 0 auto;
	}
	.panel.on {
		display: flex;
	}
	.d2-bq {
		margin-bottom: 1rem;
		padding: 1rem 1.1rem;
		border: 0.5px solid var(--color-border-secondary);
		border-left: 4px solid var(--te-bd);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.9);
		color: var(--color-text-primary);
		font-size: 1.1rem;
		font-weight: 600;
		line-height: 1.45;
	}
	.d2-reveal {
		border: 0.5px solid var(--te-bd);
		border-radius: var(--border-radius-lg);
		background: var(--te-bg);
		padding: 1.25rem 1.4rem;
		margin-bottom: 1rem;
	}
	.d2-reveal-lbl {
		font-size: 11px;
		color: var(--te);
		font-weight: 500;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		margin-bottom: 12px;
	}
	.d2-rtxt {
		font-family: var(--font-sans);
		font-size: 1.12rem;
		line-height: 1.75;
		color: var(--color-text-primary);
	}
	.d2-blank {
		display: inline;
		color: var(--color-background-primary);
		background: var(--color-background-primary);
		border-radius: 3px;
		padding: 1px 4px;
		border: 0.5px solid var(--te-bd);
		transition:
			color 0.55s ease,
			background 0.55s ease,
			border-color 0.55s ease;
	}
	.d2-blank.on {
		color: var(--te);
		background: transparent;
		border-color: transparent;
	}
	.d2-dots {
		display: flex;
		gap: 6px;
		margin-bottom: 16px;
		justify-content: center;
	}
	.d2-dot {
		height: 3px;
		width: 32px;
		border-radius: 2px;
		background: var(--color-background-secondary);
		border: 0.5px solid var(--color-border-tertiary);
		transition: all 0.3s;
	}
	.d2-dot.active {
		background: var(--te-bd);
		border-color: var(--te-bd);
	}
	.d2-dot.done {
		background: var(--te);
		border-color: var(--te);
	}
	.d2-qcard {
		border: 0.5px solid var(--color-border-secondary);
		border-radius: var(--border-radius-lg);
		background: var(--color-background-primary);
		padding: 20px;
	}
	.d2-stp {
		font-size: 11px;
		color: var(--te);
		font-weight: 500;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		margin-bottom: 10px;
	}
	.d2-q {
		font-size: 1.15rem;
		line-height: 1.5;
		color: var(--color-text-primary);
		margin-bottom: 16px;
		font-weight: 500;
	}
	.d2-irow {
		display: flex;
		gap: 8px;
	}
	.inp {
		padding: 10px 14px;
		border: 0.5px solid var(--color-border-secondary);
		border-radius: var(--border-radius-md);
		background: var(--color-background-secondary);
		font-family: var(--font-sans);
		font-size: 14px;
		color: var(--color-text-primary);
		flex: 1;
	}
	.inp:focus {
		outline: none;
		box-shadow: 0 0 0 2px var(--te-bd);
	}
	.d2-fb {
		margin-top: 12px;
		font-size: 13px;
		color: var(--te);
		font-weight: 500;
		min-height: 18px;
	}
	.d2-done {
		margin-top: 16px;
		padding: 14px 18px;
		border: 0.5px solid var(--te-bd);
		border-radius: var(--border-radius-md);
		background: var(--te-bg);
		text-align: center;
		font-size: 14px;
		color: var(--te);
		font-weight: 500;
	}

	@media (max-width: 980px) {
		.slip-strip {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.builder-shell,
		.climb-map,
		.report-grid,
		.flow-board,
		.reading-sheet-grid,
		.spine-track,
		.spine-support,
		.exam-reading-card {
			grid-template-columns: 1fr;
		}

		.coach-composer {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 680px) {
		.sheet-stage,
		.pinboard-stage,
		.transcript-stage,
		.builder-stage,
		.gap-stage,
		.stamp-stage,
		.sheet-inline-stage,
		.minimal-fill-stage,
		.prompted-sheet-stage,
		.reading-stage,
		.climb-stage,
		.lab-stage {
			width: min(100% - 18px, 1180px);
			padding-top: 58px;
			padding-bottom: 20px;
		}

		.answer-sheet,
		.pinboard,
		.transcript,
		.builder-shell,
		.gap-sheet,
		.sheet-inline-card,
		.lab-report,
		.climb-map,
		.flow-lab {
			padding: 16px;
		}

		.sheet-inline-card {
			padding: 0;
		}

		.sheet-inline-header,
		.sheet-inline-body {
			padding-right: 1rem;
			padding-left: 1rem;
		}

		.sheet-inline-header,
		.sheet-inline-footer {
			flex-direction: column;
			align-items: flex-start;
		}

		.sheet-inline-question {
			grid-template-columns: 38px minmax(0, 1fr);
		}

		.sheet-inline-marks {
			grid-column: 2;
			grid-row: 2;
			margin-top: 0.35rem;
		}

		.sheet-inline-input--compact,
		.sheet-inline-input--hinted {
			flex: 1 1 100%;
			width: 100%;
			min-width: 100%;
		}

		.minimal-fill-stage {
			align-items: flex-start;
			width: min(100% - 32px, 860px);
			padding-top: 34px;
		}

		.minimal-fill-lines p {
			font-size: 1.08rem;
			line-height: 1.7;
		}

		.minimal-fill-input {
			width: 100%;
			min-width: 100%;
			text-align: left;
		}

		.prompted-sheet-stage {
			align-items: flex-start;
			width: min(100% - 20px, 980px);
			padding-top: 58px;
		}

		.prompted-sheet-form {
			padding: 1rem;
		}

		.prompted-sheet-field {
			width: 100%;
			min-height: 4.25rem;
		}

		.reading-stage {
			width: min(100% - 24px, 1080px);
		}

		.reading-sheet,
		.exam-reading-main,
		.exam-reading-grid section,
		.reading-spine-header {
			padding: 1rem;
		}

		.sheet-heading {
			flex-direction: column;
		}

		.context-row,
		.builder-step,
		.report-line,
		.climb-node {
			grid-template-columns: 30px minmax(0, 1fr);
		}

		.slip-strip,
		.choice-grid,
		.vessel-diagram {
			grid-template-columns: 1fr;
		}

		.prompt-card,
		.choice-stage,
		.final-panel,
		.climb-card,
		.lab-task {
			padding: 18px;
		}

		.gap-paragraph {
			font-size: 1.13rem;
		}

		.blank-slot,
		.stamp-slot {
			min-width: 108px;
		}

		.vessel-diagram {
			min-height: 520px;
		}
	}
</style>
