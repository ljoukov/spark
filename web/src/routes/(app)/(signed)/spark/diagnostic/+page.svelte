<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { untrack } from 'svelte';
	import { MarkdownContent } from '$lib/components/markdown';
	import {
		DIAGNOSTIC_COUNTRIES,
		DIAGNOSTIC_TOPICS,
		getDiagnosticLevelOptions,
		resolveDiagnosticLevelLabel,
		type DiagnosticCountry,
		type DiagnosticStartMode,
		type DiagnosticTopic
	} from '$lib/diagnostic/options';
	import type { PageData } from './$types';

	type Diagnostic = NonNullable<PageData['diagnostic']>;
	type DiagnosticSheet = Diagnostic['sheets'][number];

	let { data }: { data: PageData } = $props();
	const initialDiagnostic = untrack(() => data.diagnostic);
	const initialCountry = initialDiagnostic?.country ?? 'UK';
	let diagnostic = $state<Diagnostic | null>(initialDiagnostic);
	let selectedCountry = $state<DiagnosticCountry>(initialCountry);
	let selectedTopic = $state<DiagnosticTopic>(initialDiagnostic?.topic ?? 'olympiad_math');
	let selectedSchoolYear = $state(
		initialDiagnostic?.schoolYear ?? getDiagnosticLevelOptions(initialCountry)[5] ?? 'Year 8'
	);
	let requestError = $state<string | null>(null);
	let startingMode = $state<DiagnosticStartMode | null>(null);
	let showSetup = $state(initialDiagnostic === null);

	const levelOptions = $derived(getDiagnosticLevelOptions(selectedCountry));
	const schoolYearLabel = $derived(resolveDiagnosticLevelLabel(selectedCountry));
	const activeSheet = $derived.by(() => {
		if (!diagnostic || diagnostic.status === 'complete') {
			return null;
		}
		return diagnostic.sheets.find((sheet) => sheet.index === diagnostic?.currentSheetIndex) ?? null;
	});
	const completedSheets = $derived(diagnostic?.sheets.filter((sheet) => sheet.runId) ?? []);
	const isComplete = $derived(diagnostic?.status === 'complete');
	const canContinue = $derived(Boolean(diagnostic && activeSheet));

	$effect(() => {
		if (!levelOptions.includes(selectedSchoolYear)) {
			selectedSchoolYear = levelOptions[0] ?? selectedSchoolYear;
		}
	});

	function formatDate(value: string | null): string {
		if (!value) {
			return '';
		}
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatPercent(value: number): string {
		const rounded = Math.round(value * 10) / 10;
		return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
	}

	function findSheet(index: number): DiagnosticSheet | null {
		return diagnostic?.sheets.find((sheet) => sheet.index === index) ?? null;
	}

	function conciseText(value: string, maxWords: number): string {
		const normalized = value.replace(/\s+/g, ' ').trim();
		if (!normalized) {
			return '';
		}
		const [firstSentence] = normalized.split(/(?<=[.!?])\s+/u);
		const source = firstSentence && firstSentence.length > 0 ? firstSentence : normalized;
		const words = source.split(' ');
		if (words.length <= maxWords) {
			return source;
		}
		return `${words.slice(0, maxWords).join(' ').replace(/[.,;:!?]+$/u, '')}.`;
	}

	function conciseList(items: string[], maxItems = 2, maxWords = 16): string[] {
		return items
			.map((item) => conciseText(item, maxWords))
			.filter((item) => item.length > 0)
			.slice(0, maxItems);
	}

	function diagnosticScoreLine(value: Diagnostic): string {
		const gradedSheets = value.sheets.filter((sheet) => sheet.grading);
		const totalScore = gradedSheets.reduce((sum, sheet) => sum + (sheet.grading?.totalScore ?? 0), 0);
		const maxScore = gradedSheets.reduce((sum, sheet) => sum + (sheet.grading?.maxScore ?? 0), 0);
		if (maxScore <= 0) {
			return 'Three sheets completed.';
		}
		return `${gradedSheets.length.toString()} sheets completed: ${totalScore.toString()}/${maxScore.toString()} marks overall.`;
	}

	function buildResultsMarkdown(value: Diagnostic): string {
		const results = value.results;
		if (!results) {
			return 'Generating diagnostic results. Refresh in a moment if this does not update.';
		}
		const keep = conciseList(results.strengths, 1, 14)[0] ?? 'Completed the diagnostic sequence.';
		const focus =
			conciseList(results.focusAreas, 1, 16)[0] ??
			'Review the marked questions before increasing difficulty.';
		const next =
			conciseList(results.nextSteps, 1, 18)[0] ??
			(conciseText(results.recommendedPath, 16) || 'Continue with a progress diagnostic.');
		return [
			`### ${conciseText(results.levelBand, 10)}`,
			`**Evidence:** ${diagnosticScoreLine(value)}`,
			`**Keep:** ${keep}`,
			`**Focus:** ${focus}`,
			`**Next:** ${next}`
		]
			.join('\n\n');
	}

	function resolveSheetHref(sheet: DiagnosticSheet | null, index: number): string | null {
		if (!diagnostic || !sheet) {
			return null;
		}
		if (sheet.runId) {
			return `/spark/sheets/${sheet.runId}`;
		}
		if (diagnostic.status === 'in_progress' && diagnostic.currentSheetIndex === index) {
			return `/spark/diagnostic/${diagnostic.id}`;
		}
		return null;
	}

	function resolveSheetState(sheet: DiagnosticSheet | null, index: number): string {
		if (!diagnostic || !sheet) {
			return 'locked';
		}
		if (sheet.runId) {
			return 'graded';
		}
		if (diagnostic.status === 'in_progress' && diagnostic.currentSheetIndex === index) {
			return 'current';
		}
		return 'locked';
	}

	function resolveSheetStatusLabel(sheet: DiagnosticSheet | null, index: number): string {
		const state = resolveSheetState(sheet, index);
		if (state === 'graded') {
			return 'Graded';
		}
		if (state === 'current') {
			return 'Ready';
		}
		return 'Waiting';
	}

	async function startDiagnostic(mode: DiagnosticStartMode, source?: Diagnostic): Promise<void> {
		if (startingMode) {
			return;
		}
		startingMode = mode;
		requestError = null;
		try {
			const response = await fetch('/api/spark/diagnostic/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					country: source?.country ?? selectedCountry,
					topic: source?.topic ?? selectedTopic,
					schoolYear: source?.schoolYear ?? selectedSchoolYear,
					mode
				})
			});
			const payload = (await response.json().catch(() => null)) as {
				diagnostic?: Diagnostic;
				error?: string;
			} | null;
			if (!response.ok || !payload?.diagnostic) {
				throw new Error(payload?.error ?? 'diagnostic_start_failed');
			}
			diagnostic = payload.diagnostic;
			showSetup = false;
			await goto(`/spark/diagnostic/${payload.diagnostic.id}`);
		} catch (error) {
			console.error('[diagnostic] start request failed', error);
			requestError = 'Diagnostic could not start. Try again.';
		} finally {
			startingMode = null;
		}
	}
</script>

<svelte:head>
	<title>Spark · Diagnostic</title>
</svelte:head>

<section class="diagnostic-page">
	<header class="diagnostic-header">
		<div>
			<p class="eyebrow">Diagnostic</p>
			<h1>Diagnostic</h1>
			<p class="subtitle">
				Three adaptive sheets that narrow the starting level, then publish graded sheets into the
				Sheets workspace.
			</p>
		</div>
		<a class="back-button" href="/spark">Back to chat</a>
	</header>

	{#if requestError}
		<div class="diagnostic-error" role="alert">{requestError}</div>
	{/if}

	{#if showSetup}
		<section class="setup-panel" aria-label="Diagnostic setup">
			<div class="setup-panel__intro">
				<span class="setup-panel__icon" aria-hidden="true">
					<SparklesIcon size={22} />
				</span>
				<div>
					<h2>Choose the starting point</h2>
					<p>The first sheet starts broad; each next sheet adapts to submitted answers.</p>
				</div>
			</div>

			<div class="setup-grid">
				<div class="field">
					<label for="diagnostic-country">Country</label>
					<select id="diagnostic-country" bind:value={selectedCountry}>
						{#each DIAGNOSTIC_COUNTRIES as country}
							<option value={country.value}>{country.label}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="diagnostic-topic">Topic</label>
					<select id="diagnostic-topic" bind:value={selectedTopic}>
						{#each DIAGNOSTIC_TOPICS as topic}
							<option value={topic.value}>{topic.label}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="diagnostic-year">{schoolYearLabel}</label>
					<select id="diagnostic-year" bind:value={selectedSchoolYear}>
						{#each levelOptions as schoolYear}
							<option value={schoolYear}>{schoolYear}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="setup-actions">
				<button
					class="primary-button"
					type="button"
					onclick={() => void startDiagnostic('fresh')}
					disabled={startingMode !== null}
				>
					{#if startingMode === 'fresh'}
						<Loader2Icon class="spin" size={17} />
						<span>Generating sheet</span>
					{:else}
						<span>Start diagnostic</span>
						<ArrowRightIcon size={17} />
					{/if}
				</button>
			</div>
		</section>
	{:else if diagnostic}
		{#if isComplete}
			<section class="results-panel" aria-label="Diagnostic results">
				<div class="results-panel__badge" aria-hidden="true">
					<CheckIcon size={23} />
				</div>
				<div class="results-panel__body">
					<p class="eyebrow">Completed {formatDate(diagnostic.completedAt)}</p>
					<h2>Diagnostic results</h2>
					<div class="diagnostic-report">
						<MarkdownContent markdown={buildResultsMarkdown(diagnostic)} />
					</div>
					<div class="setup-actions">
						<button
							class="secondary-button"
							type="button"
							onclick={() => void startDiagnostic('fresh', diagnostic ?? undefined)}
							disabled={startingMode !== null}
						>
							{#if startingMode === 'fresh'}
								<Loader2Icon class="spin" size={17} />
								<span>Starting</span>
							{:else}
								<RotateCcwIcon size={17} />
								<span>Redo from scratch</span>
							{/if}
						</button>
						<button
							class="primary-button"
							type="button"
							onclick={() => void startDiagnostic('progress', diagnostic ?? undefined)}
							disabled={startingMode !== null}
						>
							{#if startingMode === 'progress'}
								<Loader2Icon class="spin" size={17} />
								<span>Generating sheet</span>
							{:else}
								<span>Progress further</span>
								<ArrowRightIcon size={17} />
							{/if}
						</button>
					</div>
				</div>
			</section>
		{:else}
			<section class="continue-panel" aria-label="Current diagnostic">
				<div>
					<p class="eyebrow">In progress</p>
					<h2>{diagnostic.topicLabel} · {diagnostic.schoolYear}</h2>
					<p>
						{completedSheets.length} of 3 sheets graded. Open the next sheet when you are ready.
					</p>
				</div>
				{#if canContinue}
					<a class="primary-button" href={`/spark/diagnostic/${diagnostic.id}`}>
						<span>Open sheet {diagnostic.currentSheetIndex}</span>
						<ArrowRightIcon size={17} />
					</a>
				{/if}
			</section>
		{/if}

		<section class="sheet-board" aria-label="Diagnostic sheets">
			{#each [1, 2, 3] as index}
				{@const sheet = findSheet(index)}
				{@const href = resolveSheetHref(sheet, index)}
				<svelte:element
					this={href ? 'a' : 'div'}
					href={href ?? undefined}
					class="sheet-card"
					data-state={resolveSheetState(sheet, index)}
				>
					<div class="sheet-thumb">
						<header class="sheet-thumb__header">
							<div class="sheet-thumb__marks">
								<p>Marks</p>
								<strong>
									{#if sheet?.grading}
										{sheet.grading.totalScore}/{sheet.grading.maxScore}
									{:else}
										-
									{/if}
								</strong>
								{#if sheet?.grading}
									<span>{formatPercent(sheet.grading.percentage)}</span>
								{/if}
							</div>
							<div>
								<p class="sheet-thumb__eyebrow">Sheet {index} · {diagnostic.topicLabel}</p>
								<h3>{sheet?.title ?? `Diagnostic sheet ${index}`}</h3>
								<p>{sheet?.subtitle ?? 'Generated after the previous sheet is graded.'}</p>
							</div>
						</header>
						<div class="sheet-thumb__body">
							<span class="status-pill" data-state={resolveSheetState(sheet, index)}>
								{resolveSheetStatusLabel(sheet, index)}
							</span>
							{#if sheet?.grading}
								<p>{sheet.grading.summary}</p>
							{:else if resolveSheetState(sheet, index) === 'current'}
								<p>5 multiple choice, 6 fill-in-the-blanks, and 3 extension questions.</p>
							{:else}
								<p>This sheet will be generated by the agent after the previous one is submitted.</p>
							{/if}
							<div class="sheet-thumb__lines" aria-hidden="true">
								<span></span>
								<span></span>
								<span></span>
							</div>
						</div>
						<footer class="sheet-thumb__footer">
							<FileTextIcon size={15} />
							<span>
								{#if sheet?.runId}
									Open graded sheet
								{:else if resolveSheetState(sheet, index) === 'current'}
									Open diagnostic sheet
								{:else}
									Waiting for prior sheet
								{/if}
							</span>
						</footer>
					</div>
				</svelte:element>
			{/each}
		</section>
	{:else}
		<section class="empty-panel">
			<h2>No diagnostic yet</h2>
			<button
				class="primary-button"
				type="button"
				onclick={() => {
					showSetup = true;
				}}
			>
				Start diagnostic
			</button>
		</section>
	{/if}
</section>

<style lang="postcss">
	.diagnostic-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(88rem, 94vw);
		margin: 0 auto 3rem;
		padding-top: 1.5rem;
		color: var(--foreground);
	}

	.diagnostic-header,
	.continue-panel,
	.results-panel {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.78rem;
		font-weight: 750;
		color: #0f766e;
	}

	h1,
	h2,
	h3,
	p {
		margin-top: 0;
	}

	h1 {
		margin-bottom: 0.35rem;
		font-size: 2rem;
		line-height: 1;
	}

	h2 {
		margin-bottom: 0.45rem;
		font-size: 1.45rem;
		line-height: 1.15;
	}

	h3 {
		margin-bottom: 0.35rem;
		font-size: 1rem;
		line-height: 1.2;
	}

	.subtitle,
	.continue-panel p,
	.setup-panel__intro p,
	.results-panel p {
		margin-bottom: 0;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.subtitle {
		max-width: 45rem;
	}

	.back-button,
	.primary-button,
	.secondary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 2.45rem;
		padding: 0.55rem 0.85rem;
		border-radius: 8px;
		text-decoration: none;
		font-weight: 780;
		white-space: nowrap;
	}

	.back-button,
	.secondary-button {
		border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
		background: color-mix(in srgb, var(--card) 95%, transparent);
		color: inherit;
	}

	.primary-button {
		border: 0;
		background: #0f766e;
		color: white;
		cursor: pointer;
	}

	button.primary-button,
	button.secondary-button {
		cursor: pointer;
	}

	.primary-button:disabled,
	.secondary-button:disabled {
		opacity: 0.58;
		cursor: not-allowed;
	}

	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.diagnostic-error {
		padding: 0.85rem 1rem;
		border: 1px solid #f0a7a7;
		border-radius: 8px;
		background: #fff1f2;
		color: #8a1f2d;
		font-weight: 700;
	}

	.setup-panel,
	.continue-panel,
	.results-panel,
	.empty-panel {
		border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		box-shadow: 0 16px 42px rgba(15, 23, 42, 0.08);
		padding: 1.1rem;
	}

	.setup-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.setup-panel__intro {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}

	.setup-panel__icon,
	.results-panel__badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 999px;
		background: #dff7ef;
		color: #0f766e;
		flex: 0 0 auto;
	}

	.setup-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.field label {
		font-size: 0.82rem;
		font-weight: 760;
		color: color-mix(in srgb, var(--foreground) 75%, transparent);
	}

	.field select {
		width: 100%;
		min-height: 2.55rem;
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 8px;
		background: var(--background);
		color: var(--foreground);
		padding: 0.5rem 0.65rem;
		font: inherit;
	}

	.setup-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.65rem;
	}

	.results-panel {
		justify-content: flex-start;
	}

	.results-panel__body {
		min-width: 0;
		flex: 1 1 auto;
		max-width: 62rem;
	}

	.diagnostic-report {
		max-width: 54rem;
		margin-bottom: 1rem;
		border: 1px solid color-mix(in srgb, #0f766e 16%, var(--border));
		border-radius: 8px;
		background:
			linear-gradient(180deg, color-mix(in srgb, #ecfdf5 82%, transparent), transparent 46%),
			color-mix(in srgb, var(--background) 86%, transparent);
		padding: 0.95rem 1rem;
		line-height: 1.46;
		--markdown-heading: color-mix(in srgb, #0f766e 82%, var(--foreground));
		--markdown-strong: color-mix(in srgb, #0f766e 76%, var(--foreground));
		--markdown-quote-border: #0f766e;
	}

	:global(.diagnostic-report .markdown-content > * + *) {
		margin-top: 0.58rem;
	}

	:global(.diagnostic-report .markdown-content h3) {
		margin: 0 0 0.3rem;
		font-size: 1.05rem;
		font-weight: 820;
	}

	:global(.diagnostic-report .markdown-content p),
	:global(.diagnostic-report .markdown-content li),
	:global(.diagnostic-report .markdown-content blockquote) {
		color: color-mix(in srgb, var(--foreground) 74%, transparent);
	}

	:global(.diagnostic-report .markdown-content ul) {
		padding-left: 1.05rem;
	}

	.sheet-board {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
	}

	.sheet-card {
		color: inherit;
		text-decoration: none;
	}

	.sheet-card[data-state='current']:hover .sheet-thumb,
	.sheet-card[data-state='graded']:hover .sheet-thumb {
		transform: translateY(-2px);
		box-shadow: 0 20px 48px rgba(15, 23, 42, 0.13);
	}

	.sheet-thumb {
		min-height: 18.5rem;
		display: flex;
		flex-direction: column;
		border: 1px solid color-mix(in srgb, #007aff 22%, var(--border));
		border-radius: 8px;
		background:
			linear-gradient(180deg, color-mix(in srgb, #eaf4ff 82%, var(--card)) 0%, var(--card) 58%),
			var(--card);
		overflow: hidden;
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease;
	}

	.sheet-card[data-state='locked'] .sheet-thumb {
		opacity: 0.72;
		background: color-mix(in srgb, var(--card) 96%, transparent);
	}

	.sheet-thumb__header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.85rem;
		padding: 1rem;
		border-bottom: 1px solid color-mix(in srgb, #007aff 18%, var(--border));
	}

	.sheet-thumb__marks {
		width: 4.5rem;
		min-height: 4.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		background: white;
		border: 1px solid color-mix(in srgb, #007aff 26%, var(--border));
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.64);
	}

	.sheet-thumb__marks p,
	.sheet-thumb__marks span {
		margin: 0;
		font-size: 0.72rem;
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
	}

	.sheet-thumb__marks strong {
		font-size: 1.02rem;
	}

	.sheet-thumb__eyebrow {
		margin: 0 0 0.2rem;
		color: color-mix(in srgb, #0057d9 76%, var(--foreground));
		font-size: 0.74rem;
		font-weight: 780;
	}

	.sheet-thumb h3 {
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.sheet-thumb__header p:last-child,
	.sheet-thumb__body p {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 66%, transparent);
		line-height: 1.38;
	}

	.sheet-thumb__body {
		flex: 1 1 auto;
		padding: 1rem;
	}

	.sheet-thumb__lines {
		display: grid;
		gap: 0.45rem;
		margin-top: 0.85rem;
	}

	.sheet-thumb__lines span {
		display: block;
		height: 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, #007aff 14%, transparent);
	}

	.sheet-thumb__lines span:nth-child(2) {
		width: 78%;
	}

	.sheet-thumb__lines span:nth-child(3) {
		width: 58%;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.25rem 0.55rem;
		background: color-mix(in srgb, var(--foreground) 9%, transparent);
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
		font-size: 0.74rem;
		font-weight: 780;
	}

	.status-pill[data-state='current'] {
		background: #dff7ef;
		color: #075e4d;
	}

	.status-pill[data-state='graded'] {
		background: #e8f1ff;
		color: #1d4ed8;
	}

	.sheet-thumb__footer {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.85rem 1rem;
		border-top: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		color: color-mix(in srgb, var(--foreground) 70%, transparent);
		font-size: 0.84rem;
		font-weight: 760;
	}

	:global([data-theme='dark'] .sheet-thumb__marks),
	:global(:root:not([data-theme='light']) .sheet-thumb__marks) {
		background: color-mix(in srgb, var(--background) 90%, #007aff 10%);
	}

	@media (max-width: 900px) {
		.setup-grid,
		.sheet-board {
			grid-template-columns: 1fr;
		}

		.diagnostic-header,
		.continue-panel,
		.results-panel {
			flex-direction: column;
			align-items: stretch;
		}

		.results-panel__badge {
			width: 2.25rem;
			height: 2.25rem;
		}

		.setup-panel__intro {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.65rem;
		}

		.setup-panel__icon {
			width: 2.25rem;
			height: 2.25rem;
		}

		.primary-button,
		.secondary-button {
			width: 100%;
			white-space: normal;
		}

		.back-button {
			align-self: flex-start;
			white-space: normal;
		}

		.setup-actions {
			justify-content: stretch;
		}
	}
</style>
