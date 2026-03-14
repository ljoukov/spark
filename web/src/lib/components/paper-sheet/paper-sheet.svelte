<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type {
		PaperSheetAnswers,
		PaperSheetBlank,
		PaperSheetContentSection,
		PaperSheetData,
		PaperSheetHookSection,
		PaperSheetMockReview,
		PaperSheetQuestion,
		PaperSheetQuestionReview,
		PaperSheetQuestionReviewStatus,
		PaperSheetScore
	} from './types';

	type PaperSheetQuestionEntry = {
		sectionId: string;
		question: PaperSheetQuestion;
	};

	function isHookSection(
		section: PaperSheetData['sections'][number]
	): section is PaperSheetHookSection {
		return 'type' in section && section.type === 'hook';
	}

	function isContentSection(
		section: PaperSheetData['sections'][number]
	): section is PaperSheetContentSection {
		return 'id' in section;
	}

	function buildQuestionKey(sectionId: string, questionId: string): string {
		return `${sectionId}:${questionId}`;
	}

	function getQuestionEntries(sheet: PaperSheetData): PaperSheetQuestionEntry[] {
		const questions: PaperSheetQuestionEntry[] = [];
		for (const section of sheet.sections) {
			if (!isContentSection(section) || !section.questions) {
				continue;
			}
			for (const question of section.questions) {
				questions.push({
					sectionId: section.id,
					question
				});
			}
		}
		return questions;
	}

	function totalMarks(sheet: PaperSheetData): number {
		let total = 0;
		for (const entry of getQuestionEntries(sheet)) {
			total += entry.question.marks;
		}
		return total;
	}

	function sectionMarks(section: PaperSheetContentSection): number {
		let total = 0;
		for (const question of section.questions ?? []) {
			total += question.marks;
		}
		return total;
	}

	function buildQuestionNumbers(sheet: PaperSheetData): Record<string, number> {
		const numbers: Record<string, number> = {};
		let counter = 1;
		for (const entry of getQuestionEntries(sheet)) {
			numbers[buildQuestionKey(entry.sectionId, entry.question.id)] = counter;
			counter += 1;
		}
		return numbers;
	}

	function createOpenSections(sheet: PaperSheetData): Record<string, boolean> {
		const open: Record<string, boolean> = {};
		for (const section of sheet.sections) {
			if (isContentSection(section)) {
				open[section.id] = true;
			}
		}
		return open;
	}

	function rgbaFromHex(hex: string, alpha: number): string {
		const normalized = hex.replace('#', '');
		const red = Number.parseInt(normalized.slice(0, 2), 16);
		const green = Number.parseInt(normalized.slice(2, 4), 16);
		const blue = Number.parseInt(normalized.slice(4, 6), 16);
		return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
	}

	function buildPaperThemeStyle(sheet: PaperSheetData): string {
		return [
			`--sheet-color:${sheet.color}`,
			`--sheet-accent:${sheet.accent}`,
			`--sheet-light:${sheet.light}`,
			`--sheet-border:${sheet.border}`,
			`--sheet-color-08:${rgbaFromHex(sheet.color, 0.08)}`,
			`--sheet-color-10:${rgbaFromHex(sheet.color, 0.1)}`,
			`--sheet-color-14:${rgbaFromHex(sheet.color, 0.14)}`,
			`--sheet-color-15:${rgbaFromHex(sheet.color, 0.15)}`,
			`--sheet-color-25:${rgbaFromHex(sheet.color, 0.25)}`,
			`--sheet-color-30:${rgbaFromHex(sheet.color, 0.3)}`,
			`--sheet-color-40:${rgbaFromHex(sheet.color, 0.4)}`,
			`--sheet-color-60:${rgbaFromHex(sheet.color, 0.6)}`
		].join('; ');
	}

	function escapeHtml(value: string): string {
		return value
			.replace(/&/gu, '&amp;')
			.replace(/</gu, '&lt;')
			.replace(/>/gu, '&gt;')
			.replace(/"/gu, '&quot;')
			.replace(/'/gu, '&#39;');
	}

	function renderInlineMarkup(value: string): string {
		const escaped = escapeHtml(value);
		return escaped
			.replace(/\*\*(.*?)\*\*/gu, '<strong>$1</strong>')
			.replace(/\*(.*?)\*/gu, '<em>$1</em>')
			.replace(/\n/gu, '<br />');
	}

	function createScoreTone(score: PaperSheetScore): {
		background: string;
		border: string;
		text: string;
		message: string;
	} {
		const ratio = score.total > 0 ? score.got / score.total : 0;
		if (ratio >= 0.7) {
			return {
				background: '#edfdf6',
				border: '#22a66e',
				text: '#1a8c5b',
				message: 'Mock success state for the preview.'
			};
		}
		if (ratio >= 0.5) {
			return {
				background: '#fffbea',
				border: '#f0b429',
				text: '#b07a00',
				message: 'Mock mixed-result state for the preview.'
			};
		}
		return {
			background: '#fdf0f0',
			border: '#e04040',
			text: '#c03030',
			message: 'Mock revision-needed state for the preview.'
		};
	}

	function createQuestionReview(
		question: PaperSheetQuestion,
		status: PaperSheetQuestionReviewStatus
	): PaperSheetQuestionReview {
		if (status === 'teacher-review') {
			return {
				status,
				note: 'Mock review: this written response stays with teacher marking.'
			};
		}

		if (status === 'correct') {
			switch (question.type) {
				case 'fill':
					return { status, note: 'Mock review: the fill-in layout shows an accepted state.' };
				case 'mcq':
					return { status, note: 'Mock review: the selected option shows a positive outcome.' };
				case 'calc':
					return { status, note: 'Mock review: the calculation row shows a successful state.' };
				case 'match':
					return {
						status,
						note: 'Mock review: the matching layout shows a completed success state.'
					};
				case 'spelling':
					return { status, note: 'Mock review: the spelling row shows an accepted state.' };
				case 'lines':
					return { status, note: 'Mock review: teacher review state.' };
			}
		}

		switch (question.type) {
			case 'fill':
				return { status, note: 'Mock review: the fill-in layout shows a revision prompt.' };
			case 'mcq':
				return { status, note: 'Mock review: the selected option shows a revision state.' };
			case 'calc':
				return { status, note: 'Mock review: the calculation row shows a retry state.' };
			case 'match':
				return { status, note: 'Mock review: the matching layout shows a retry state.' };
			case 'spelling':
				return { status, note: 'Mock review: the spelling row shows a correction state.' };
			case 'lines':
				return { status, note: 'Mock review: teacher review state.' };
		}
	}

	function buildMockReview(sheet: PaperSheetData): PaperSheetMockReview {
		const questions: Record<string, PaperSheetQuestionReview> = {};
		let got = 0;
		let total = 0;
		let teacherReviewMarks = 0;
		let objectiveIndex = 0;

		for (const entry of getQuestionEntries(sheet)) {
			const questionKey = buildQuestionKey(entry.sectionId, entry.question.id);
			const question = entry.question;
			if (question.type === 'lines') {
				teacherReviewMarks += question.marks;
				questions[questionKey] = createQuestionReview(question, 'teacher-review');
				continue;
			}

			total += question.marks;
			const status: PaperSheetQuestionReviewStatus =
				objectiveIndex % 3 === 1 ? 'incorrect' : 'correct';
			if (status === 'correct') {
				got += question.marks;
			}
			questions[questionKey] = createQuestionReview(question, status);
			objectiveIndex += 1;
		}

		return {
			score: { got, total },
			label: 'Mock review score (objective questions only)',
			message: `Demo-only review state. ${teacherReviewMarks} teacher-reviewed marks are excluded from this mock score.`,
			note: 'Preview only. This component shows mocked review feedback for UI validation; it is not checking answer keys.',
			questions
		};
	}

	function resolveReviewColors(status: PaperSheetQuestionReviewStatus | null): {
		border: string;
		background: string;
		text: string;
	} {
		if (status === 'correct') {
			return {
				border: '#22a66e',
				background: '#edfdf6',
				text: '#22a66e'
			};
		}
		if (status === 'incorrect') {
			return {
				border: '#e04040',
				background: '#fdf0f0',
				text: '#e04040'
			};
		}
		if (status === 'teacher-review') {
			return {
				border: '#f0b429',
				background: '#fffbea',
				text: '#b07a00'
			};
		}
		return {
			border: '',
			background: 'transparent',
			text: ''
		};
	}

	function buildTextInputStyle(
		status: PaperSheetQuestionReviewStatus | null,
		minWidth = 100
	): string {
		const colors = resolveReviewColors(status);
		return [
			`min-width:${minWidth}px`,
			`border-bottom-color:${colors.border || rgbaFromHex(sheet.color, 0.6)}`,
			`background:${colors.background}`
		].join('; ');
	}

	function buildMcqOptionStyle(
		selected: boolean,
		status: PaperSheetQuestionReviewStatus | null
	): string {
		const colors = resolveReviewColors(selected ? status : null);
		return [
			`border-color:${colors.border || (selected ? sheet.color : '#d0d0d0')}`,
			`background:${colors.background || (selected ? rgbaFromHex(sheet.color, 0.08) : '#fafafa')}`
		].join('; ');
	}

	function buildMcqRadioStyle(
		selected: boolean,
		status: PaperSheetQuestionReviewStatus | null
	): string {
		const colors = resolveReviewColors(selected ? status : null);
		return [
			`border-color:${colors.border || (selected ? sheet.color : '#bbbbbb')}`,
			`background:${selected ? colors.border || sheet.color : '#ffffff'}`
		].join('; ');
	}

	function buildMatchTermStyle(
		active: boolean,
		hasMatch: boolean,
		status: PaperSheetQuestionReviewStatus | null
	): string {
		const colors = resolveReviewColors(hasMatch ? status : null);
		return [
			`border-color:${active ? sheet.color : colors.border || (hasMatch ? rgbaFromHex(sheet.color, 0.6) : '#d0d0d0')}`,
			`background:${active ? rgbaFromHex(sheet.color, 0.08) : colors.background || (hasMatch ? rgbaFromHex(sheet.color, 0.03) : '#fafafa')}`
		].join('; ');
	}

	function buildMatchValueStyle(taken: boolean, armed: boolean): string {
		const borderColor = taken ? rgbaFromHex(sheet.color, 0.6) : armed ? sheet.color : '#d0d0d0';
		const background = taken
			? rgbaFromHex(sheet.color, 0.03)
			: armed
				? rgbaFromHex(sheet.color, 0.02)
				: '#fafafa';
		const opacity = taken ? '0.6' : '1';
		return [`border-color:${borderColor}`, `background:${background}`, `opacity:${opacity}`].join(
			'; '
		);
	}

	function getFeedbackLabel(status: PaperSheetQuestionReviewStatus): string {
		switch (status) {
			case 'correct':
				return 'Mock OK';
			case 'incorrect':
				return 'Mock Revise';
			case 'teacher-review':
				return 'Teacher Review';
		}
	}

	function getFeedbackClass(status: PaperSheetQuestionReviewStatus): string {
		switch (status) {
			case 'correct':
				return 'is-correct';
			case 'incorrect':
				return 'is-wrong';
			case 'teacher-review':
				return 'is-review';
		}
	}

	function readInputValue(event: Event): string {
		const target = event.currentTarget;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
			return target.value;
		}
		return '';
	}

	let { sheet }: { sheet: PaperSheetData } = $props();

	let answers = $state<PaperSheetAnswers>({});
	let checked = $state(false);
	let review = $state<PaperSheetMockReview | null>(null);
	let openSections = $state<Record<string, boolean>>({});
	let activeMatchTerms = $state<Record<string, string | null>>({});
	let previousSheetSignature = $state<string | null>(null);

	$effect(() => {
		const nextSheetSignature = buildSheetSignature(sheet);
		if (nextSheetSignature === previousSheetSignature) {
			return;
		}
		answers = {};
		checked = false;
		review = null;
		openSections = createOpenSections(sheet);
		activeMatchTerms = {};
		previousSheetSignature = nextSheetSignature;
	});

	const hookSection = $derived.by((): PaperSheetHookSection | null => {
		for (const section of sheet.sections) {
			if (isHookSection(section)) {
				return section;
			}
		}
		return null;
	});

	const contentSections = $derived.by((): PaperSheetContentSection[] => {
		const sections: PaperSheetContentSection[] = [];
		for (const section of sheet.sections) {
			if (isContentSection(section)) {
				sections.push(section);
			}
		}
		return sections;
	});

	const questionNumbers = $derived(buildQuestionNumbers(sheet));
	const totalSheetMarks = $derived(totalMarks(sheet));
	const scoreTone = $derived(review ? createScoreTone(review.score) : null);
	const paperStyle = $derived(buildPaperThemeStyle(sheet));

	function handleCheck(): void {
		review = buildMockReview(sheet);
		checked = true;
	}

	function handleReset(): void {
		answers = {};
		activeMatchTerms = {};
		checked = false;
		review = null;
		openSections = createOpenSections(sheet);
	}

	function toggleSection(sectionId: string): void {
		openSections = {
			...openSections,
			[sectionId]: !openSections[sectionId]
		};
	}

	function isSectionOpen(sectionId: string): boolean {
		return openSections[sectionId] ?? true;
	}

	function updateTextAnswer(key: string, value: string): void {
		answers = {
			...answers,
			[key]: value
		};
	}

	function updateObjectAnswer(key: string, value: Record<string, string>): void {
		answers = {
			...answers,
			[key]: value
		};
	}

	function getTextAnswer(key: string): string {
		const value = answers[key];
		return typeof value === 'string' ? value : '';
	}

	function getObjectAnswer(key: string): Record<string, string> {
		const value = answers[key];
		if (!value || typeof value === 'string') {
			return {};
		}
		return value;
	}

	function updateFillAnswer(questionKey: string, index: number, value: string): void {
		updateTextAnswer(`${questionKey}_${index}`, value);
	}

	function updateSpellingAnswer(questionKey: string, index: number, value: string): void {
		const current = getObjectAnswer(questionKey);
		updateObjectAnswer(questionKey, {
			...current,
			[String(index)]: value
		});
	}

	function selectMatchTerm(questionKey: string, term: string): void {
		if (checked) {
			return;
		}
		const current = activeMatchTerms[questionKey] ?? null;
		activeMatchTerms = {
			...activeMatchTerms,
			[questionKey]: current === term ? null : term
		};
	}

	function assignMatch(questionKey: string, matchValue: string): void {
		if (checked) {
			return;
		}
		const activeTerm = activeMatchTerms[questionKey] ?? null;
		if (!activeTerm) {
			return;
		}

		const current = getObjectAnswer(questionKey);
		const next: Record<string, string> = {};
		for (const [term, selected] of Object.entries(current)) {
			if (selected !== matchValue) {
				next[term] = selected;
			}
		}
		next[activeTerm] = matchValue;

		updateObjectAnswer(questionKey, next);
		activeMatchTerms = {
			...activeMatchTerms,
			[questionKey]: null
		};
	}

	function getQuestionPromptHtml(prompt: string): string {
		return renderInlineMarkup(prompt);
	}

	function getTheoryHtml(theory: string): string {
		return renderInlineMarkup(theory);
	}

	function getBlankConfig(
		question: { blanks: [PaperSheetBlank] | [PaperSheetBlank, PaperSheetBlank] },
		index: 0 | 1
	): PaperSheetBlank | null {
		return question.blanks[index] ?? null;
	}

	function getQuestionReview(questionKey: string): PaperSheetQuestionReview | null {
		return review?.questions[questionKey] ?? null;
	}

	function buildSheetSignature(value: PaperSheetData): string {
		return JSON.stringify(value);
	}
</script>

<div class="paper-sheet" style={paperStyle}>
	<header class="paper-sheet__header">
		<div class="paper-sheet__header-orb paper-sheet__header-orb--large"></div>
		<div class="paper-sheet__header-orb paper-sheet__header-orb--small"></div>

		<div class="paper-sheet__header-row">
			<div>
				<p class="paper-sheet__eyebrow">{sheet.level} · {sheet.subject}</p>
				<h1 class="paper-sheet__title">{sheet.title}</h1>
				<p class="paper-sheet__subtitle">{sheet.subtitle}</p>
			</div>

			<div class="paper-sheet__total-box">
				<p class="paper-sheet__total-label">Total marks</p>
				<p class="paper-sheet__total-value">{totalSheetMarks}</p>
			</div>
		</div>
	</header>

	<div class="paper-sheet__body">
		{#if hookSection}
			<div class="paper-sheet__hook">{hookSection.text}</div>
		{/if}

		{#each contentSections as section (section.id)}
			<section class="paper-sheet__section">
				<button
					type="button"
					class="paper-sheet__section-header"
					aria-expanded={isSectionOpen(section.id)}
					aria-controls={`paper-sheet-section-${sheet.id}-${section.id}`}
					onclick={() => {
						toggleSection(section.id);
					}}
				>
					<span class="paper-sheet__section-id">{section.id}</span>
					<span class="paper-sheet__section-label">{section.label}</span>
					<span class="paper-sheet__section-marks">{sectionMarks(section)} marks</span>
					{#if isSectionOpen(section.id)}
						<ChevronDownIcon class="paper-sheet__section-chevron" aria-hidden="true" />
					{:else}
						<ChevronRightIcon class="paper-sheet__section-chevron" aria-hidden="true" />
					{/if}
				</button>

				<div
					id={`paper-sheet-section-${sheet.id}-${section.id}`}
					class="paper-sheet__section-body"
					hidden={!isSectionOpen(section.id)}
					aria-hidden={!isSectionOpen(section.id)}
				>
					{#if section.theory}
						<div class="paper-sheet__theory sheet-markup">
							{@html getTheoryHtml(section.theory)}
						</div>
					{/if}

					{#if section.infoBox}
						<div class="paper-sheet__info-box">
							<div class="paper-sheet__info-icon" aria-hidden="true">{section.infoBox.icon}</div>
							<div class="paper-sheet__info-copy">
								<p class="paper-sheet__info-title">{section.infoBox.title}</p>
								<p class="paper-sheet__info-text">{section.infoBox.text}</p>
							</div>
						</div>
					{/if}

					{#each section.questions ?? [] as question (`${section.id}-${question.id}`)}
						{@const questionKey = buildQuestionKey(section.id, question.id)}
						{@const questionReview = getQuestionReview(questionKey)}
						{@const reviewStatus = checked ? (questionReview?.status ?? null) : null}

						<div class="paper-sheet__question">
							<div class="paper-sheet__question-number">{questionNumbers[questionKey]}</div>

							<div class="paper-sheet__question-body">
								{#if question.type === 'fill'}
									{@const value0 = getTextAnswer(`${questionKey}_0`)}
									{@const value1 = getTextAnswer(`${questionKey}_1`)}
									{@const blank0 = getBlankConfig(question, 0)}
									{@const blank1 = getBlankConfig(question, 1)}

									<div class="paper-sheet__fill-row">
										<span>{question.prompt}</span>
										<input
											class="paper-sheet__inline-input"
											style={buildTextInputStyle(reviewStatus, blank0?.minWidth ?? 100)}
											value={value0}
											oninput={(event) => {
												updateFillAnswer(questionKey, 0, readInputValue(event));
											}}
											placeholder={blank0?.placeholder ?? '...'}
											readonly={checked}
										/>

										{#if blank1}
											<span>{question.conjunction ?? ''}</span>
											<input
												class="paper-sheet__inline-input"
												style={buildTextInputStyle(reviewStatus, blank1.minWidth ?? 100)}
												value={value1}
												oninput={(event) => {
													updateFillAnswer(questionKey, 1, readInputValue(event));
												}}
												placeholder={blank1.placeholder ?? '...'}
												readonly={checked}
											/>
										{/if}

										<span>{question.after}</span>

										{#if checked && questionReview}
											<span
												class={`paper-sheet__feedback ${getFeedbackClass(questionReview.status)}`}
											>
												{getFeedbackLabel(questionReview.status)}
											</span>
										{/if}
									</div>
								{:else if question.type === 'mcq'}
									{@const selected = getTextAnswer(questionKey)}

									<div class="paper-sheet__prompt">{question.prompt}</div>
									<div class="paper-sheet__mcq-grid">
										{#each question.options as option, optionIndex (`${question.id}-option-${optionIndex}`)}
											{@const selectedOption = selected === option}

											<button
												type="button"
												class={`paper-sheet__mcq-option ${selectedOption ? 'is-selected' : ''}`}
												style={buildMcqOptionStyle(selectedOption, reviewStatus)}
												disabled={checked}
												onclick={() => {
													updateTextAnswer(questionKey, option);
												}}
											>
												<span
													class="paper-sheet__mcq-radio"
													style={buildMcqRadioStyle(selectedOption, reviewStatus)}
												>
													{#if selectedOption}
														<span class="paper-sheet__mcq-radio-dot"></span>
													{/if}
												</span>
												<span class="paper-sheet__mcq-label">{option}</span>
												{#if checked && selectedOption && questionReview}
													<span
														class={`paper-sheet__feedback paper-sheet__feedback--inline ${getFeedbackClass(questionReview.status)}`}
													>
														{getFeedbackLabel(questionReview.status)}
													</span>
												{/if}
											</button>
										{/each}
									</div>
								{:else if question.type === 'lines'}
									{@const textValue = getTextAnswer(questionKey)}

									<div class="paper-sheet__prompt sheet-markup">
										{@html getQuestionPromptHtml(question.prompt)}
									</div>
									<textarea
										class="paper-sheet__lines-input"
										value={textValue}
										rows={question.lines}
										oninput={(event) => {
											updateTextAnswer(questionKey, readInputValue(event));
										}}
										placeholder="Write your answer here..."
										readonly={checked}
									></textarea>
								{:else if question.type === 'calc'}
									{@const calcValue = getTextAnswer(questionKey)}

									<div class="paper-sheet__prompt">{question.prompt}</div>
									{#if question.hint}
										<div class="paper-sheet__hint">Hint: {question.hint}</div>
									{/if}
									<div class="paper-sheet__calc-row">
										<span>{question.inputLabel}</span>
										<input
											class="paper-sheet__inline-input paper-sheet__inline-input--compact"
											style={buildTextInputStyle(reviewStatus)}
											value={calcValue}
											oninput={(event) => {
												updateTextAnswer(questionKey, readInputValue(event));
											}}
											placeholder="..."
											readonly={checked}
										/>
										<span>{question.unit}</span>
										{#if checked && questionReview}
											<span
												class={`paper-sheet__feedback ${getFeedbackClass(questionReview.status)}`}
											>
												{getFeedbackLabel(questionReview.status)}
											</span>
										{/if}
									</div>
								{:else if question.type === 'match'}
									{@const selections = getObjectAnswer(questionKey)}
									{@const activeTerm = activeMatchTerms[questionKey] ?? null}
									{@const takenMatches = Object.values(selections)}

									<div class="paper-sheet__prompt">
										{question.prompt}
										<span class="paper-sheet__prompt-note"
											>(Click a term, then click its meaning)</span
										>
									</div>

									<div class="paper-sheet__match-grid">
										<div class="paper-sheet__match-column">
											{#each question.pairs as pair, pairIndex (`${question.id}-term-${pairIndex}`)}
												{@const isActive = activeTerm === pair.term}
												{@const hasMatch = Boolean(selections[pair.term])}

												<button
													type="button"
													class="paper-sheet__match-button paper-sheet__match-button--term"
													style={buildMatchTermStyle(isActive, hasMatch, reviewStatus)}
													disabled={checked}
													onclick={() => {
														selectMatchTerm(questionKey, pair.term);
													}}
												>
													<span>{pair.term}</span>
													{#if checked && hasMatch && questionReview}
														<span
															class={`paper-sheet__feedback paper-sheet__feedback--inline ${getFeedbackClass(questionReview.status)}`}
														>
															{getFeedbackLabel(questionReview.status)}
														</span>
													{/if}
												</button>
											{/each}
										</div>

										<div class="paper-sheet__match-column">
											{#each question.pairs as pair, pairIndex (`${question.id}-match-${pairIndex}`)}
												{@const taken = takenMatches.includes(pair.match)}

												<button
													type="button"
													class="paper-sheet__match-button"
													style={buildMatchValueStyle(taken, Boolean(activeTerm))}
													disabled={checked || !activeTerm}
													onclick={() => {
														assignMatch(questionKey, pair.match);
													}}
												>
													{pair.match}
												</button>
											{/each}
										</div>
									</div>
								{:else if question.type === 'spelling'}
									{@const spellingAnswers = getObjectAnswer(questionKey)}

									<div class="paper-sheet__prompt">{question.prompt}</div>
									<div class="paper-sheet__spelling-list">
										{#each question.words as word, index (`${question.id}-${index}`)}
											{@const spellingValue = spellingAnswers[String(index)] ?? ''}

											<div class="paper-sheet__spelling-row">
												<span class="paper-sheet__spelling-wrong">{word.wrong}</span>
												<span class="paper-sheet__spelling-arrow">→</span>
												<input
													class="paper-sheet__inline-input paper-sheet__inline-input--wide"
													style={buildTextInputStyle(reviewStatus, 140)}
													value={spellingValue}
													oninput={(event) => {
														updateSpellingAnswer(questionKey, index, readInputValue(event));
													}}
													placeholder="correct spelling..."
													readonly={checked}
												/>
												{#if checked && questionReview}
													<span
														class={`paper-sheet__feedback ${getFeedbackClass(questionReview.status)}`}
													>
														{getFeedbackLabel(questionReview.status)}
													</span>
												{/if}
											</div>
										{/each}
									</div>
								{/if}

								{#if checked && questionReview}
									<p class={`paper-sheet__review-note ${getFeedbackClass(questionReview.status)}`}>
										{questionReview.note}
									</p>
								{/if}
							</div>

							<div class="paper-sheet__question-marks">[{question.marks}m]</div>
						</div>
					{/each}
				</div>
			</section>
		{/each}

		{#if checked && review && scoreTone}
			<div
				class="paper-sheet__score-card"
				style={`background:${scoreTone.background}; border-color:${scoreTone.border};`}
			>
				<p class="paper-sheet__score-label">{review.label}</p>
				<p class="paper-sheet__score-value" style={`color:${scoreTone.text};`}>
					{review.score.got} / {review.score.total}
				</p>
				<p class="paper-sheet__score-message">{scoreTone.message}</p>
				<p class="paper-sheet__score-note">{review.message}</p>
				<p class="paper-sheet__score-note">{review.note}</p>
			</div>
		{/if}

		<div class="paper-sheet__actions">
			{#if checked}
				<button
					type="button"
					class="paper-sheet__action paper-sheet__action--secondary"
					onclick={handleReset}
				>
					Reset Demo
				</button>
			{:else}
				<button
					type="button"
					class="paper-sheet__action paper-sheet__action--primary"
					onclick={handleCheck}
				>
					Show Mock Review
				</button>
			{/if}
		</div>

		<footer class="paper-sheet__footer">
			<span>{sheet.level} · {sheet.subject} · {sheet.title}</span>
			<span>Interactive Tutor Sheet</span>
		</footer>
	</div>
</div>

<style>
	.paper-sheet {
		position: relative;
		overflow: hidden;
		border-radius: 4px;
		background: #ffffff;
		box-shadow:
			0 4px 30px rgba(0, 0, 0, 0.18),
			0 1px 4px rgba(0, 0, 0, 0.1);
		font-family: Georgia, 'Times New Roman', serif;
		color: #1a1a1a;
	}

	.paper-sheet__header {
		position: relative;
		overflow: hidden;
		padding: 28px 32px 24px;
		background: var(--sheet-color);
	}

	.paper-sheet__header-orb {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
	}

	.paper-sheet__header-orb--large {
		top: -30px;
		right: -30px;
		width: 120px;
		height: 120px;
	}

	.paper-sheet__header-orb--small {
		right: 60px;
		bottom: -20px;
		width: 80px;
		height: 80px;
		background: rgba(255, 255, 255, 0.06);
	}

	.paper-sheet__header-row {
		position: relative;
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
	}

	.paper-sheet__eyebrow {
		margin: 0 0 6px;
		font-size: 11px;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.72);
	}

	.paper-sheet__title {
		margin: 0;
		font-size: 28px;
		line-height: 1.1;
		letter-spacing: -0.02em;
		font-weight: 900;
		color: #ffffff;
	}

	.paper-sheet__subtitle {
		margin: 6px 0 0;
		font-size: 12.5px;
		color: rgba(255, 255, 255, 0.76);
	}

	.paper-sheet__total-box {
		flex-shrink: 0;
		text-align: right;
	}

	.paper-sheet__total-label {
		margin: 0 0 4px;
		font-size: 11px;
		color: rgba(255, 255, 255, 0.72);
	}

	.paper-sheet__total-value {
		margin: 0;
		font-size: 32px;
		line-height: 1;
		font-weight: 900;
		color: #ffffff;
	}

	.paper-sheet__body {
		padding: 24px 32px 32px;
	}

	.paper-sheet__hook {
		margin-bottom: 24px;
		padding-left: 16px;
		border-left: 4px solid var(--sheet-accent);
		font-size: 14px;
		line-height: 1.8;
		font-style: italic;
		color: #444444;
	}

	.paper-sheet__section {
		margin-bottom: 24px;
		overflow: hidden;
		border: 1.5px solid var(--sheet-color-30);
		border-radius: 10px;
		background: #ffffff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
	}

	.paper-sheet__section-header {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 12px;
		border: 0;
		border-bottom: 1px solid transparent;
		background: var(--sheet-color-14);
		padding: 12px 18px;
		text-align: left;
		font-family: inherit;
		cursor: pointer;
	}

	.paper-sheet__section-header:hover {
		background: var(--sheet-color-15);
	}

	.paper-sheet__section-id {
		display: flex;
		height: 28px;
		width: 28px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		background: var(--sheet-color);
		color: #ffffff;
		font-size: 14px;
		font-weight: 900;
	}

	.paper-sheet__section-label {
		flex: 1;
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: #1a1a1a;
	}

	.paper-sheet__section-marks {
		font-size: 12px;
		color: #666666;
	}

	.paper-sheet__section-chevron {
		height: 16px;
		width: 16px;
		color: var(--sheet-color);
	}

	.paper-sheet__section-body {
		padding: 16px 18px;
	}

	.paper-sheet__theory {
		margin-bottom: 14px;
		border-left: 3px solid var(--sheet-color);
		border-radius: 0 6px 6px 0;
		background: var(--sheet-color-08);
		padding: 12px 16px;
		font-size: 13.5px;
		line-height: 1.7;
		color: #222222;
	}

	.paper-sheet__info-box {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		margin-bottom: 14px;
		border: 1px solid var(--sheet-color-25);
		border-radius: 8px;
		background: var(--sheet-color-10);
		padding: 10px 14px;
	}

	.paper-sheet__info-icon {
		font-size: 22px;
		line-height: 1;
	}

	.paper-sheet__info-title {
		margin: 0 0 3px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--sheet-color);
	}

	.paper-sheet__info-text {
		margin: 0;
		font-size: 13px;
		line-height: 1.6;
		color: #333333;
	}

	.paper-sheet__question {
		display: flex;
		gap: 12px;
		padding: 14px 0;
		border-bottom: 1px dashed #e0e0e0;
	}

	.paper-sheet__question:last-child {
		border-bottom: 0;
	}

	.paper-sheet__question-number {
		display: flex;
		height: 26px;
		width: 26px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		margin-top: 1px;
		border-radius: 999px;
		background: var(--sheet-color);
		color: #ffffff;
		font-size: 12px;
		font-weight: 800;
	}

	.paper-sheet__question-body {
		flex: 1;
		min-width: 0;
	}

	.paper-sheet__question-marks {
		flex-shrink: 0;
		align-self: flex-start;
		padding-left: 8px;
		margin-top: 2px;
		font-size: 11px;
		line-height: 1;
		font-weight: 700;
		white-space: nowrap;
		color: var(--sheet-color);
	}

	.paper-sheet__prompt {
		margin-bottom: 10px;
		font-size: 13.5px;
		line-height: 1.6;
	}

	.paper-sheet__prompt-note {
		margin-left: 4px;
		font-size: 12px;
		font-style: italic;
		color: #888888;
	}

	.paper-sheet__fill-row,
	.paper-sheet__calc-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		font-size: 13.5px;
		line-height: 2.2;
	}

	.paper-sheet__inline-input {
		width: auto;
		border: 0;
		border-bottom: 2px solid var(--sheet-color-60);
		border-radius: 3px 3px 0 0;
		background: transparent;
		padding: 2px 6px;
		outline: none;
		font-family: inherit;
		font-size: 13.5px;
		color: #111111;
		transition: border-color 0.2s;
	}

	.paper-sheet__inline-input--compact {
		width: 100px;
		min-width: 100px;
		padding: 4px 8px;
	}

	.paper-sheet__inline-input--wide {
		min-width: 140px;
		padding: 3px 8px;
	}

	.paper-sheet__inline-input::placeholder,
	.paper-sheet__lines-input::placeholder {
		color: #999999;
	}

	.paper-sheet__feedback,
	.paper-sheet__review-note {
		font-size: 12px;
		font-weight: 600;
	}

	.paper-sheet__feedback--inline {
		margin-left: auto;
	}

	.paper-sheet__review-note {
		margin: 8px 0 0;
	}

	.paper-sheet__feedback.is-correct,
	.paper-sheet__review-note.is-correct {
		color: #22a66e;
	}

	.paper-sheet__feedback.is-wrong,
	.paper-sheet__review-note.is-wrong {
		color: #e04040;
	}

	.paper-sheet__feedback.is-review,
	.paper-sheet__review-note.is-review {
		color: #b07a00;
	}

	.paper-sheet__mcq-grid,
	.paper-sheet__match-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.paper-sheet__mcq-option,
	.paper-sheet__match-button {
		display: flex;
		align-items: center;
		gap: 8px;
		border: 1.5px solid #d0d0d0;
		border-radius: 6px;
		background: #fafafa;
		padding: 8px 12px;
		font-family: inherit;
		font-size: 13px;
		text-align: left;
		color: #1a1a1a;
	}

	.paper-sheet__mcq-option {
		cursor: pointer;
		transition: all 0.15s;
	}

	.paper-sheet__mcq-option:disabled,
	.paper-sheet__match-button:disabled {
		cursor: default;
	}

	.paper-sheet__mcq-option.is-selected {
		font-weight: 600;
	}

	.paper-sheet__mcq-radio {
		display: flex;
		height: 18px;
		width: 18px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border: 2px solid #bbbbbb;
		border-radius: 999px;
		background: #ffffff;
	}

	.paper-sheet__mcq-radio-dot {
		height: 7px;
		width: 7px;
		border-radius: 999px;
		background: #ffffff;
	}

	.paper-sheet__mcq-label {
		min-width: 0;
	}

	.paper-sheet__hint {
		display: inline-block;
		margin-bottom: 8px;
		border-radius: 4px;
		background: var(--sheet-color-08);
		padding: 4px 10px;
		font-size: 12px;
		font-style: italic;
		color: var(--sheet-color);
	}

	.paper-sheet__lines-input {
		box-sizing: border-box;
		width: 100%;
		resize: vertical;
		border: 1.5px solid var(--sheet-color-30);
		border-radius: 6px;
		background-color: #ffffff;
		background-image: repeating-linear-gradient(
			transparent,
			transparent calc(1.8em - 1px),
			#e8e8e8 calc(1.8em - 1px),
			#e8e8e8 1.8em
		);
		padding: 8px 10px;
		font-family: inherit;
		font-size: 13.5px;
		line-height: 1.8;
		color: #1a1a1a;
		outline: none;
	}

	.paper-sheet__lines-input[readonly] {
		background-color: #f9f9f9;
	}

	.paper-sheet__match-column {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.paper-sheet__match-button {
		justify-content: space-between;
	}

	.paper-sheet__match-button--term {
		font-weight: 700;
	}

	.paper-sheet__spelling-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.paper-sheet__spelling-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.paper-sheet__spelling-wrong {
		width: 120px;
		font-size: 13px;
		color: #888888;
		text-decoration: line-through;
	}

	.paper-sheet__spelling-arrow {
		font-size: 13px;
	}

	.paper-sheet__score-card {
		margin: 8px 0 16px;
		border: 2px solid #22a66e;
		border-radius: 10px;
		padding: 20px 24px;
		text-align: center;
	}

	.paper-sheet__score-label {
		margin: 0 0 4px;
		font-size: 13px;
		color: #666666;
	}

	.paper-sheet__score-value {
		margin: 0;
		font-size: 36px;
		line-height: 1;
		font-weight: 900;
	}

	.paper-sheet__score-message {
		margin: 6px 0 0;
		font-size: 13.5px;
		color: #555555;
	}

	.paper-sheet__score-note {
		margin: 4px 0 0;
		font-size: 12px;
		color: #888888;
	}

	.paper-sheet__actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 8px;
	}

	.paper-sheet__action {
		border-radius: 8px;
		padding: 10px 24px;
		font-family: inherit;
		font-size: 13.5px;
		font-weight: 700;
		cursor: pointer;
	}

	.paper-sheet__action--primary {
		border: 0;
		background: var(--sheet-color);
		color: #ffffff;
		box-shadow: 0 3px 12px var(--sheet-color-40);
	}

	.paper-sheet__action--secondary {
		border: 2px solid var(--sheet-color);
		background: #ffffff;
		color: var(--sheet-color);
	}

	.paper-sheet__footer {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		margin-top: 32px;
		padding-top: 16px;
		border-top: 1px solid #eeeeee;
		font-size: 11px;
		letter-spacing: 0.04em;
		color: #bbbbbb;
	}

	.sheet-markup :global(p) {
		margin: 0;
	}

	.sheet-markup :global(p + p) {
		margin-top: 0.75em;
	}

	.sheet-markup :global(strong) {
		color: var(--sheet-color);
		font-weight: 700;
	}

	.sheet-markup :global(em) {
		font-style: italic;
	}

	@media (max-width: 900px) {
		.paper-sheet__header,
		.paper-sheet__body {
			padding-right: 20px;
			padding-left: 20px;
		}
	}

	@media (max-width: 720px) {
		.paper-sheet__header-row,
		.paper-sheet__footer {
			flex-direction: column;
		}

		.paper-sheet__total-box {
			text-align: left;
		}

		.paper-sheet__question {
			flex-wrap: wrap;
		}

		.paper-sheet__question-marks {
			width: 100%;
			padding-left: 38px;
		}

		.paper-sheet__mcq-grid,
		.paper-sheet__match-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 560px) {
		.paper-sheet__section-header {
			flex-wrap: wrap;
		}

		.paper-sheet__section-marks {
			margin-left: 40px;
		}
	}
</style>
