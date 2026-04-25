<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		PATHWAY_COUNTRIES,
		PATHWAY_EXAM_BOARDS,
		PATHWAY_PROGRAMMES,
		PATHWAY_SUBJECTS,
		getPathwayStageOptions,
		resolvePathwayBoardLabel,
		resolvePathwayCountryLabel,
		resolvePathwayProgrammeLabel,
		resolvePathwaySourceDocuments,
		resolvePathwaySubjectLabel
	} from '$lib/pathways/catalog';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import BookOpenCheck from '@lucide/svelte/icons/book-open-check';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import FileText from '@lucide/svelte/icons/file-text';
	import GraduationCap from '@lucide/svelte/icons/graduation-cap';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import PlayCircle from '@lucide/svelte/icons/play-circle';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Target from '@lucide/svelte/icons/target';
	import { untrack } from 'svelte';
	import type {
		SparkLearningCountry,
		SparkLearningProfileSelection,
		SparkPathwaySubject
	} from '@spark/schemas';
	import type { PageData } from './$types';

	type Pathway = PageData['pathways'][number];
	type SheetRuns = Record<
		string,
		{
			id: string;
			status: 'created' | 'executing' | 'stopped' | 'failed' | 'done';
			sheetPhase: 'building' | 'solving' | 'grading' | 'graded' | null;
			updatedAt: string;
			href: string;
		}
	>;
	type SheetRunStatus = SheetRuns[string];
	type Unit = Pathway['units'][number];
	type WorksheetRun = Pathway['worksheetRuns'][number];
	type UnitState = 'done' | 'active' | 'retry' | 'next' | 'later';
	type UnitCard = {
		unit: Unit;
		index: number;
		run: WorksheetRun | null;
		status: SheetRunStatus | null;
		state: UnitState;
		actionable: boolean;
	};

	let { data }: { data: PageData } = $props();

	const initialPathways = untrack(() => data.pathways);
	const initialSheetRuns = untrack(() => data.sheetRuns as SheetRuns);
	const initialLoadError = untrack(() => data.loadError);
	const initialPathway = initialPathways[0] ?? null;
	let pathways = $state<Pathway[]>(initialPathways);
	let sheetRuns = $state<SheetRuns>(initialSheetRuns);
	let activePathwayId = $state<string | null>(initialPathway?.id ?? null);
	let selectedCountry = $state<SparkLearningCountry>(initialPathway?.selection.country ?? 'UK');
	let selectedSchoolStage = $state(initialPathway?.selection.schoolStage ?? 'Year 10');
	let selectedSubject = $state<SparkPathwaySubject>(
		initialPathway?.selection.subject ?? 'chemistry'
	);
	let creatingPath = $state(false);
	let startingSheet = $state(false);
	let startingUnitId = $state<string | null>(null);
	let requestError = $state<string | null>(initialLoadError);

	const selectedProgramme = 'gcse_triple_science';
	const selectedQualification = 'gcse';
	const selectedExamBoard = 'aqa';
	const availableStageOptions = $derived(getPathwayStageOptions(selectedCountry));
	const activePathway = $derived(
		pathways.find((pathway) => pathway.id === activePathwayId) ?? pathways[0] ?? null
	);
	const currentSelection = $derived({
		country: selectedCountry,
		schoolStage: selectedSchoolStage,
		qualification: selectedQualification,
		programme: selectedProgramme,
		subject: selectedSubject,
		examBoard: selectedExamBoard
	} satisfies SparkLearningProfileSelection);
	const activeSourceDocuments = $derived(
		activePathway?.sourceDocuments ?? resolvePathwaySourceDocuments(currentSelection)
	);
	const unitCards = $derived.by(() => buildUnitCards(activePathway, sheetRuns));
	const actionStep = $derived(unitCards.find((card) => card.actionable) ?? null);
	const completedCount = $derived(unitCards.filter((card) => card.state === 'done').length);
	const progressPercent = $derived(
		activePathway && activePathway.units.length > 0
			? Math.round((completedCount / activePathway.units.length) * 100)
			: 0
	);
	const activeAccent = $derived(resolveSubjectAccent(activePathway?.selection.subject ?? selectedSubject));
	const selectedTargetIsActive = $derived(
		activePathway ? selectionsMatch(activePathway.selection, currentSelection) : false
	);

	$effect(() => {
		if (!availableStageOptions.includes(selectedSchoolStage)) {
			selectedSchoolStage = availableStageOptions[0] ?? 'Year 10';
		}
	});

	function resolveSubjectAccent(subject: SparkPathwaySubject): string {
		return PATHWAY_SUBJECTS.find((entry) => entry.value === subject)?.accent ?? '#2563eb';
	}

	function formatDate(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	function formatSelection(selection: SparkLearningProfileSelection): string {
		return [
			resolvePathwayCountryLabel(selection.country),
			selection.schoolStage,
			resolvePathwaySubjectLabel(selection.subject),
			resolvePathwayBoardLabel(selection.examBoard)
		].join(' · ');
	}

	function selectionsMatch(
		left: SparkLearningProfileSelection,
		right: SparkLearningProfileSelection
	): boolean {
		return (
			left.country === right.country &&
			left.schoolStage === right.schoolStage &&
			left.qualification === right.qualification &&
			left.programme === right.programme &&
			left.subject === right.subject &&
			left.examBoard === right.examBoard
		);
	}

	function latestRunForUnit(pathway: Pathway, unitId: string): WorksheetRun | null {
		let latest: WorksheetRun | null = null;
		for (const run of pathway.worksheetRuns) {
			if (run.unitId !== unitId) {
				continue;
			}
			if (!latest || new Date(run.createdAt).getTime() > new Date(latest.createdAt).getTime()) {
				latest = run;
			}
		}
		return latest;
	}

	function isRunDone(status: SheetRunStatus | null): boolean {
		return status?.sheetPhase === 'graded';
	}

	function isRunFailed(status: SheetRunStatus | null): boolean {
		return status?.status === 'failed';
	}

	function buildUnitCards(
		pathway: Pathway | null,
		statuses: SheetRuns
	): UnitCard[] {
		if (!pathway) {
			return [];
		}

		let actionAssigned = false;
		return pathway.units.map((unit, index) => {
			const run = latestRunForUnit(pathway, unit.id);
			const status = run ? (statuses[run.runId] ?? null) : null;
			let state: UnitState;
			if (run && isRunDone(status)) {
				state = 'done';
			} else if (run && isRunFailed(status)) {
				state = actionAssigned ? 'later' : 'retry';
			} else if (run) {
				state = actionAssigned ? 'later' : 'active';
			} else {
				state = actionAssigned ? 'later' : 'next';
			}
			const actionable = state === 'active' || state === 'retry' || state === 'next';
			if (actionable) {
				actionAssigned = true;
			}
			return { unit, index, run, status, state, actionable };
		});
	}

	function unitStatusLabel(card: UnitCard): string {
		if (card.state === 'done') {
			return 'Reviewed';
		}
		if (card.state === 'active') {
			if (card.status?.sheetPhase === 'building') {
				return 'Preparing';
			}
			return 'Current sheet';
		}
		if (card.state === 'retry') {
			return 'Restart';
		}
		if (card.state === 'next') {
			return 'Next';
		}
		return 'Later';
	}

	function unitActionLabel(card: UnitCard): string {
		if (card.state === 'active') {
			return card.status?.sheetPhase === 'building' ? 'Open progress' : 'Open worksheet';
		}
		if (card.state === 'retry') {
			return 'Try again';
		}
		return 'Start worksheet';
	}

	function primaryHeading(card: UnitCard | null): string {
		if (!activePathway) {
			return 'Choose a target first';
		}
		if (!card) {
			return 'Path complete';
		}
		if (card.state === 'active') {
			return card.status?.sheetPhase === 'building' ? 'Your worksheet is being prepared' : 'Continue your worksheet';
		}
		if (card.state === 'retry') {
			return 'Restart this step';
		}
		return 'Next worksheet';
	}

	function selectPathway(pathway: Pathway): void {
		activePathwayId = pathway.id;
		selectedCountry = pathway.selection.country;
		selectedSchoolStage = pathway.selection.schoolStage;
		selectedSubject = pathway.selection.subject;
		requestError = null;
	}

	async function createStudyPath(): Promise<void> {
		if (creatingPath || !data.pathwaysAvailable || selectedTargetIsActive) {
			return;
		}
		creatingPath = true;
		requestError = null;
		try {
			const response = await fetch('/api/spark/pathways', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ selection: currentSelection })
			});
			const payload = (await response.json().catch(() => null)) as {
				pathway?: Pathway;
				message?: string;
				error?: string;
			} | null;
			if (!response.ok || !payload?.pathway) {
				throw new Error(payload?.message ?? payload?.error ?? 'Unable to create study path.');
			}
			const nextPathway = payload.pathway;
			pathways = [nextPathway, ...pathways.filter((pathway) => pathway.id !== nextPathway.id)];
			activePathwayId = nextPathway.id;
		} catch (error) {
			console.error('[pathways] study path creation failed', error);
			requestError = error instanceof Error ? error.message : 'Unable to create study path.';
		} finally {
			creatingPath = false;
		}
	}

	async function startWorksheet(unitId?: string): Promise<void> {
		if (!activePathway || startingSheet) {
			return;
		}
		startingSheet = true;
		startingUnitId = unitId ?? null;
		requestError = null;
		try {
			const response = await fetch(
				`/api/spark/pathways/${encodeURIComponent(activePathway.id)}/next-sheet`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ unitId })
				}
			);
			const payload = (await response.json().catch(() => null)) as {
				runId?: string;
				href?: string;
				pathway?: Pathway;
				message?: string;
				error?: string;
			} | null;
			if (!response.ok || !payload?.runId || !payload.href || !payload.pathway) {
				throw new Error(payload?.message ?? payload?.error ?? 'Unable to start the worksheet.');
			}
			pathways = pathways.map((pathway) =>
				pathway.id === payload.pathway?.id ? payload.pathway : pathway
			);
			sheetRuns = {
				...sheetRuns,
				[payload.runId]: {
					id: payload.runId,
					status: 'created',
					sheetPhase: 'building',
					updatedAt: new Date().toISOString(),
					href: payload.href
				}
			};
			await goto(payload.href);
		} catch (error) {
			console.error('[pathways] worksheet launch failed', error);
			requestError = error instanceof Error ? error.message : 'Unable to start the worksheet.';
		} finally {
			startingSheet = false;
			startingUnitId = null;
		}
	}
</script>

<svelte:head>
	<title>Spark · Pathways</title>
</svelte:head>

<section class="pathways-page" style={`--subject-accent:${activeAccent}`}>
	<header class="pathways-header">
		<div>
			<p class="eyebrow">Pathways</p>
			<h1>Follow the next sheet for your exam route</h1>
			<p class="subtitle">
				Pick the target once. Spark keeps the route, then prepares one worksheet at a time from
				the official specification.
			</p>
		</div>
		<div class="header-actions">
			<Button href="/spark/sheets" variant="ghost" size="sm">Sheets</Button>
			<Button href="/spark" variant="ghost" size="sm">Chat</Button>
		</div>
	</header>

	{#if requestError}
		<div class="pathway-error" role="alert">{requestError}</div>
	{/if}

	<div class="top-grid">
		<section class="next-panel" aria-labelledby="next-step-title">
			<div class="next-copy">
				<p class="eyebrow">
					{activePathway ? formatSelection(activePathway.selection) : 'Study target'}
				</p>
				<h2 id="next-step-title">{primaryHeading(actionStep)}</h2>
				{#if activePathway && actionStep}
					<h3>{actionStep.unit.title}</h3>
					<p>{actionStep.unit.summary}</p>
				{:else if activePathway}
					<p>
						All units in this path already have worksheets. Review previous sheets or start a new
						target when you are ready.
					</p>
				{:else}
					<p>
						Start with GCSE Triple Science for AQA. Chemistry, Biology, and Physics are available now.
					</p>
				{/if}
			</div>

			{#if activePathway && actionStep}
				<div class="next-meta">
					<span>{actionStep.index + 1} of {activePathway.units.length}</span>
					{#if actionStep.unit.specRefs.length > 0}
						<span>AQA {actionStep.unit.specRefs.join(', ')}</span>
					{/if}
				</div>
				<div class="next-actions">
					{#if actionStep.state === 'active' && actionStep.run}
						<Button href={actionStep.run.href} size="lg">
							<PlayCircle />
							<span>{unitActionLabel(actionStep)}</span>
						</Button>
					{:else}
						<Button
							size="lg"
							disabled={startingSheet}
							onclick={() => void startWorksheet(actionStep.unit.id)}
						>
							{#if startingSheet && startingUnitId === actionStep.unit.id}
								<LoaderCircle class="spin" />
								<span>Preparing</span>
							{:else if actionStep.state === 'retry'}
								<RotateCcw />
								<span>{unitActionLabel(actionStep)}</span>
							{:else}
								<PlayCircle />
								<span>{unitActionLabel(actionStep)}</span>
							{/if}
						</Button>
					{/if}
					<Button href="/spark/sheets" variant="outline" size="lg">All sheets</Button>
				</div>
			{:else if activePathway}
				<div class="next-actions">
					<Button href="/spark/sheets" size="lg">
						<BookOpenCheck />
						<span>Review sheets</span>
					</Button>
				</div>
			{:else}
				<div class="next-actions">
					<Button
						size="lg"
						disabled={creatingPath || !data.pathwaysAvailable}
						onclick={() => void createStudyPath()}
					>
						{#if creatingPath}
							<LoaderCircle class="spin" />
							<span>Setting up</span>
						{:else}
							<Target />
							<span>Create study path</span>
						{/if}
					</Button>
				</div>
			{/if}

			{#if activePathway}
				<div class="progress-strip" aria-label="Path progress">
					<div>
						<strong>{completedCount}</strong>
						<span>reviewed</span>
					</div>
					<div>
						<strong>{activePathway.units.length}</strong>
						<span>units</span>
					</div>
					<div class="progress-bar" aria-hidden="true">
						<span style={`width:${progressPercent}%`}></span>
					</div>
				</div>
			{/if}
		</section>

		<aside class="target-panel" aria-labelledby="target-title">
			<div class="panel-heading">
				<div class="heading-icon" aria-hidden="true"><GraduationCap /></div>
				<div>
					<p class="eyebrow">Target</p>
					<h2 id="target-title">What are you working towards?</h2>
				</div>
			</div>

			<div class="field-grid">
				<label class="field">
					<span>Country</span>
					<select bind:value={selectedCountry} disabled={creatingPath}>
						{#each PATHWAY_COUNTRIES as country}
							<option value={country.value}>{country.label}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>Year</span>
					<select bind:value={selectedSchoolStage} disabled={creatingPath}>
						{#each availableStageOptions as stage}
							<option value={stage}>{stage}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>Course</span>
					<select value={selectedProgramme} disabled>
						{#each PATHWAY_PROGRAMMES as programme}
							<option value={programme.value}>{programme.label}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>Board</span>
					<select value={selectedExamBoard} disabled>
						{#each PATHWAY_EXAM_BOARDS as board}
							<option value={board.value}>{board.label}</option>
						{/each}
					</select>
				</label>
			</div>

			<div class="subject-picker" aria-label="Subject">
				{#each PATHWAY_SUBJECTS as subject}
					<button
						type="button"
						class:selected={selectedSubject === subject.value}
						style={`--option-accent:${subject.accent}`}
						disabled={creatingPath}
						onclick={() => {
							selectedSubject = subject.value;
						}}
					>
						<span class="subject-swatch" aria-hidden="true"></span>
						<span>{subject.label}</span>
					</button>
				{/each}
			</div>

			<Button
				class="target-button"
				disabled={creatingPath || !data.pathwaysAvailable || selectedTargetIsActive}
				onclick={() => void createStudyPath()}
			>
				{#if creatingPath}
					<LoaderCircle class="spin" />
					<span>Setting up</span>
				{:else if selectedTargetIsActive}
					<Target />
					<span>Current target</span>
				{:else}
					<Target />
					<span>Create study path</span>
				{/if}
			</Button>
		</aside>
	</div>

	<div class="content-grid">
		<section class="progress-panel" aria-labelledby="path-progress-title">
			<div class="section-heading">
				<div>
					<p class="eyebrow">Progression</p>
					<h2 id="path-progress-title">
						{activePathway ? activePathway.title : 'No study path yet'}
					</h2>
				</div>
				{#if activePathway}
					<span class="subject-pill">{resolvePathwaySubjectLabel(activePathway.selection.subject)}</span>
				{/if}
			</div>

			{#if activePathway}
				<div class="unit-list">
					{#each unitCards as card}
						<article class={`unit-row state-${card.state}`}>
							<div class="unit-marker" aria-hidden="true">
								{#if card.state === 'done'}
									<CheckCircle2 />
								{:else if card.state === 'active'}
									<PlayCircle />
								{:else}
									<CircleDashed />
								{/if}
							</div>
							<div class="unit-body">
								<div class="unit-heading">
									<div>
										<span class="unit-status">{unitStatusLabel(card)}</span>
										<h3>{card.unit.title}</h3>
									</div>
									<span class="unit-number">{card.index + 1}</span>
								</div>
								<p>{card.unit.summary}</p>
								<div class="unit-tags">
									{#if card.unit.specRefs.length > 0}
										{#each card.unit.specRefs as ref}
											<span>AQA {ref}</span>
										{/each}
									{/if}
									<span>{card.unit.estimatedStudyHours}h route time</span>
								</div>
								<div class="unit-goals">
									{#each card.unit.learningGoals.slice(0, 2) as goal}
										<span>{goal}</span>
									{/each}
								</div>
							</div>
							<div class="unit-actions">
								{#if card.run && card.state !== 'retry'}
									<a class="unit-link" href={card.run.href}>
										<span>{card.state === 'done' ? 'Review' : 'Open'}</span>
										<ArrowRight />
									</a>
								{:else if card.actionable}
									<button
										type="button"
										class="unit-link"
										disabled={startingSheet}
										onclick={() => void startWorksheet(card.unit.id)}
									>
										{#if startingSheet && startingUnitId === card.unit.id}
											<LoaderCircle class="spin" />
											<span>Preparing</span>
										{:else}
											<span>{unitActionLabel(card)}</span>
											<ArrowRight />
										{/if}
									</button>
								{/if}
							</div>
						</article>
					{/each}
				</div>
			{:else}
				<div class="empty-state">
					<BookOpenCheck />
					<h3>Start with a target, then work through sheets.</h3>
					<p>
						Spark will keep your next worksheet tied to the route you choose, instead of waiting for
						you to find and upload work from somewhere else.
					</p>
				</div>
			{/if}
		</section>

		<aside class="side-stack">
			<section class="sources-panel" aria-labelledby="sources-title">
				<div class="panel-heading compact">
					<div class="heading-icon heading-icon--blue" aria-hidden="true"><FileText /></div>
					<div>
						<p class="eyebrow">Reference</p>
						<h2 id="sources-title">Official source</h2>
					</div>
				</div>
				<div class="source-list">
					{#each activeSourceDocuments as source}
						<a class="source-row" href={source.pageUrl} target="_blank" rel="noreferrer">
							<span>
								<strong>{source.title}</strong>
								<small>{source.publisher} · {source.qualificationCode}</small>
							</span>
							<ArrowRight />
						</a>
					{/each}
				</div>
			</section>

			<section class="history-panel" aria-labelledby="history-title">
				<h2 id="history-title">Study paths</h2>
				{#if pathways.length === 0}
					<p class="history-empty">Created paths will appear here.</p>
				{:else}
					<div class="history-list">
						{#each pathways as pathway}
							<button
								type="button"
								class:active={pathway.id === activePathway?.id}
								onclick={() => selectPathway(pathway)}
							>
								<span>{pathway.title}</span>
								<small>{formatSelection(pathway.selection)}</small>
								<small>{pathway.worksheetRuns.length} worksheet{pathway.worksheetRuns.length === 1 ? '' : 's'}</small>
							</button>
						{/each}
					</div>
				{/if}
			</section>
		</aside>
	</div>
</section>

<style>
	.pathways-page {
		width: min(1180px, 100%);
		margin: 0 auto;
		padding: 1.35rem 1rem 3rem;
		color: var(--text-primary, var(--foreground));
	}

	.pathways-header,
	.top-grid,
	.content-grid {
		display: grid;
		gap: 1rem;
	}

	.pathways-header {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		margin-bottom: 1rem;
	}

	.pathways-header h1,
	.next-panel h2,
	.target-panel h2,
	.section-heading h2,
	.sources-panel h2,
	.history-panel h2,
	.empty-state h3 {
		margin: 0;
		letter-spacing: 0;
	}

	.pathways-header h1 {
		max-width: 780px;
		font-size: clamp(2rem, 4.8vw, 3.45rem);
		line-height: 0.98;
	}

	.eyebrow {
		margin: 0 0 0.32rem;
		color: color-mix(in srgb, var(--muted-foreground) 84%, var(--foreground));
		font-size: 0.74rem;
		font-weight: 800;
		letter-spacing: 0;
		text-transform: uppercase;
	}

	.subtitle,
	.next-copy p,
	.unit-body p,
	.empty-state p,
	.history-empty {
		color: color-mix(in srgb, var(--muted-foreground) 86%, var(--foreground));
	}

	.subtitle {
		max-width: 660px;
		margin: 0.7rem 0 0;
		line-height: 1.55;
	}

	.header-actions,
	.next-actions {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.pathway-error {
		margin-bottom: 1rem;
		border: 1px solid color-mix(in srgb, #ef4444 32%, transparent);
		border-radius: 0.5rem;
		background: color-mix(in srgb, #ef4444 9%, var(--background));
		padding: 0.8rem 0.9rem;
		color: color-mix(in srgb, #991b1b 88%, var(--foreground));
		font-size: 0.92rem;
	}

	.top-grid {
		grid-template-columns: minmax(0, 1.18fr) minmax(300px, 0.82fr);
		align-items: stretch;
	}

	.content-grid {
		grid-template-columns: minmax(0, 1fr) minmax(270px, 320px);
		align-items: start;
		margin-top: 1rem;
	}

	.next-panel,
	.target-panel,
	.progress-panel,
	.sources-panel,
	.history-panel {
		border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--background) 82%, transparent);
		box-shadow: 0 16px 48px color-mix(in srgb, #0f172a 9%, transparent);
		backdrop-filter: blur(16px);
	}

	.next-panel {
		display: grid;
		align-content: space-between;
		gap: 1rem;
		min-height: 360px;
		padding: 1.35rem;
		background:
			linear-gradient(
				135deg,
				color-mix(in srgb, var(--subject-accent) 11%, transparent),
				transparent 54%
			),
			color-mix(in srgb, var(--background) 84%, transparent);
	}

	.next-copy h2 {
		font-size: clamp(1.65rem, 3vw, 2.55rem);
		line-height: 1.03;
	}

	.next-copy h3 {
		margin: 0.75rem 0 0;
		font-size: clamp(1.05rem, 2vw, 1.35rem);
		line-height: 1.2;
	}

	.next-copy p {
		max-width: 680px;
		margin: 0.55rem 0 0;
		line-height: 1.55;
	}

	.next-meta,
	.progress-strip,
	.unit-tags,
	.unit-goals {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.next-meta span,
	.unit-tags span,
	.subject-pill,
	.unit-status {
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 6%, transparent);
		padding: 0.26rem 0.55rem;
		font-size: 0.75rem;
		font-weight: 800;
	}

	.next-actions :global(svg),
	.target-button :global(svg),
	.unit-link :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.progress-strip {
		display: grid;
		grid-template-columns: auto auto minmax(120px, 1fr);
		gap: 0.75rem;
		align-items: end;
		border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
		padding-top: 1rem;
	}

	.progress-strip strong,
	.progress-strip span {
		display: block;
	}

	.progress-strip strong {
		font-size: 1.35rem;
		line-height: 1;
	}

	.progress-strip > div > span {
		margin-top: 0.2rem;
		color: color-mix(in srgb, var(--muted-foreground) 86%, var(--foreground));
		font-size: 0.76rem;
		font-weight: 800;
		text-transform: uppercase;
	}

	.progress-bar {
		height: 0.55rem;
		overflow: hidden;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
	}

	.progress-bar span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, #16a34a, #0ea5e9);
	}

	.target-panel,
	.progress-panel,
	.sources-panel,
	.history-panel {
		padding: 1rem;
	}

	.panel-heading,
	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.panel-heading {
		justify-content: flex-start;
	}

	.panel-heading.compact {
		margin-bottom: 0.75rem;
	}

	.heading-icon {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 2.35rem;
		height: 2.35rem;
		border-radius: 0.5rem;
		background: color-mix(in srgb, #16a34a 13%, var(--background));
		color: #15803d;
	}

	.heading-icon--blue {
		background: color-mix(in srgb, #0ea5e9 13%, var(--background));
		color: #0369a1;
	}

	.heading-icon :global(svg),
	.empty-state :global(svg),
	.unit-marker :global(svg),
	.source-row :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.field-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.7rem;
	}

	.field {
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}

	.field span {
		color: color-mix(in srgb, var(--muted-foreground) 88%, var(--foreground));
		font-size: 0.78rem;
		font-weight: 800;
	}

	.field select {
		width: 100%;
		min-width: 0;
		border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--background) 88%, transparent);
		padding: 0.62rem 0.68rem;
		color: inherit;
		font: inherit;
	}

	.subject-picker {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.55rem;
		margin-top: 0.8rem;
	}

	.subject-picker button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-width: 0;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--background) 72%, transparent);
		padding: 0.72rem 0.45rem;
		color: inherit;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	.subject-picker button.selected {
		border-color: color-mix(in srgb, var(--option-accent) 70%, transparent);
		background: color-mix(in srgb, var(--option-accent) 13%, var(--background));
	}

	.subject-swatch {
		width: 0.66rem;
		height: 0.66rem;
		border-radius: 999px;
		background: var(--option-accent);
	}

	:global(.target-button) {
		width: 100%;
		margin-top: 0.85rem;
	}

	.unit-list,
	.source-list,
	.history-list,
	.side-stack {
		display: grid;
		gap: 0.7rem;
	}

	.unit-row {
		display: grid;
		grid-template-columns: 2.25rem minmax(0, 1fr) auto;
		gap: 0.75rem;
		align-items: start;
		border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--background) 68%, transparent);
		padding: 0.9rem;
	}

	.unit-row.state-active,
	.unit-row.state-next,
	.unit-row.state-retry {
		border-color: color-mix(in srgb, var(--subject-accent) 46%, var(--border));
		background: color-mix(in srgb, var(--subject-accent) 7%, var(--background));
	}

	.unit-marker,
	.unit-number {
		display: grid;
		place-items: center;
		border-radius: 0.5rem;
		font-weight: 900;
	}

	.unit-marker {
		width: 2.1rem;
		height: 2.1rem;
		background: color-mix(in srgb, var(--foreground) 6%, transparent);
		color: color-mix(in srgb, var(--subject-accent) 78%, var(--foreground));
	}

	.unit-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.unit-heading h3 {
		margin: 0.3rem 0 0;
		font-size: 1.03rem;
		line-height: 1.22;
		letter-spacing: 0;
	}

	.unit-number {
		width: 1.8rem;
		height: 1.8rem;
		background: color-mix(in srgb, #f59e0b 13%, var(--background));
		color: #92400e;
		font-size: 0.78rem;
	}

	.unit-body p {
		margin: 0.35rem 0 0;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.unit-tags {
		margin-top: 0.55rem;
	}

	.unit-goals {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		margin-top: 0.65rem;
	}

	.unit-goals span {
		border-left: 2px solid color-mix(in srgb, var(--subject-accent) 52%, var(--border));
		padding-left: 0.55rem;
		color: color-mix(in srgb, var(--foreground) 88%, var(--muted-foreground));
		font-size: 0.82rem;
		line-height: 1.4;
	}

	.unit-actions {
		min-width: 6.8rem;
		text-align: right;
	}

	.unit-link,
	.source-row,
	.history-list button {
		color: inherit;
		text-decoration: none;
	}

	.unit-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.32rem;
		border: 1px solid color-mix(in srgb, var(--border) 74%, transparent);
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--background) 72%, transparent);
		padding: 0.45rem 0.62rem;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 850;
		cursor: pointer;
	}

	.unit-link:disabled {
		cursor: wait;
		opacity: 0.72;
	}

	.subject-pill {
		color: color-mix(in srgb, var(--subject-accent) 80%, var(--foreground));
		background: color-mix(in srgb, var(--subject-accent) 12%, var(--background));
	}

	.source-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--background) 64%, transparent);
		padding: 0.72rem;
	}

	.source-row strong,
	.source-row small {
		display: block;
	}

	.source-row strong {
		font-size: 0.88rem;
		line-height: 1.25;
	}

	.source-row small,
	.history-list small {
		margin-top: 0.14rem;
		color: color-mix(in srgb, var(--muted-foreground) 86%, var(--foreground));
		font-size: 0.75rem;
		line-height: 1.35;
	}

	.history-panel h2 {
		font-size: 1rem;
	}

	.history-empty {
		margin: 0.55rem 0 0;
		font-size: 0.9rem;
	}

	.history-list {
		margin-top: 0.7rem;
	}

	.history-list button {
		display: grid;
		gap: 0.14rem;
		width: 100%;
		border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--background) 62%, transparent);
		padding: 0.72rem;
		text-align: left;
		cursor: pointer;
	}

	.history-list button.active {
		border-color: color-mix(in srgb, var(--subject-accent) 48%, var(--border));
		background: color-mix(in srgb, var(--subject-accent) 9%, var(--background));
	}

	.history-list span {
		font-size: 0.9rem;
		font-weight: 850;
	}

	.empty-state {
		display: grid;
		place-items: center;
		min-height: 360px;
		padding: 2rem;
		text-align: center;
	}

	.empty-state :global(svg) {
		width: 2.2rem;
		height: 2.2rem;
		margin-bottom: 0.8rem;
		color: var(--subject-accent);
	}

	.empty-state p {
		max-width: 460px;
		margin: 0.45rem 0 0;
		line-height: 1.55;
	}

	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	:global(:root:not([data-theme='light']) .next-panel),
	:global(:root:not([data-theme='light']) .target-panel),
	:global(:root:not([data-theme='light']) .progress-panel),
	:global(:root:not([data-theme='light']) .sources-panel),
	:global(:root:not([data-theme='light']) .history-panel),
	:global([data-theme='dark'] .next-panel),
	:global([data-theme='dark'] .target-panel),
	:global([data-theme='dark'] .progress-panel),
	:global([data-theme='dark'] .sources-panel),
	:global([data-theme='dark'] .history-panel),
	:global(.dark .next-panel),
	:global(.dark .target-panel),
	:global(.dark .progress-panel),
	:global(.dark .sources-panel),
	:global(.dark .history-panel) {
		background: color-mix(in srgb, #141724 84%, transparent);
		box-shadow: 0 18px 56px color-mix(in srgb, #020617 34%, transparent);
	}

	:global(:root:not([data-theme='light']) .field select),
	:global(:root:not([data-theme='light']) .subject-picker button),
	:global(:root:not([data-theme='light']) .unit-row),
	:global(:root:not([data-theme='light']) .source-row),
	:global(:root:not([data-theme='light']) .history-list button),
	:global([data-theme='dark'] .field select),
	:global([data-theme='dark'] .subject-picker button),
	:global([data-theme='dark'] .unit-row),
	:global([data-theme='dark'] .source-row),
	:global([data-theme='dark'] .history-list button),
	:global(.dark .field select),
	:global(.dark .subject-picker button),
	:global(.dark .unit-row),
	:global(.dark .source-row),
	:global(.dark .history-list button) {
		background: color-mix(in srgb, #1f2431 78%, transparent);
	}

	@media (max-width: 940px) {
		.pathways-header,
		.top-grid,
		.content-grid {
			grid-template-columns: 1fr;
		}

		.header-actions {
			justify-content: flex-start;
		}
	}

	@media (max-width: 680px) {
		.pathways-page {
			padding-inline: 0.75rem;
		}

		.field-grid,
		.subject-picker,
		.progress-strip,
		.unit-goals {
			grid-template-columns: 1fr;
		}

		.unit-row {
			grid-template-columns: 2.25rem minmax(0, 1fr);
		}

		.unit-actions {
			grid-column: 2;
			min-width: 0;
			text-align: left;
		}

		.unit-heading {
			display: grid;
		}
	}
</style>
