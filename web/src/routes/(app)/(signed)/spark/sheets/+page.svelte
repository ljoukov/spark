<script lang="ts">
	import { renderMarkdownOptional } from '$lib/markdown';
	import { resolveSheetSubjectLabel, resolveSheetSubjectTheme } from '$lib/spark/sheetSubjects';
	import { sumPaperSheetMarks, type PaperSheetData } from '@spark/schemas';
	import type { PageData } from './$types';

	type Sheet = PageData['sheets'][number];
	type DashboardDetail = 'overview' | 'strengths' | 'weakSpots' | 'subjects';
	type DashboardGuidance = {
		specifics?: string[];
		nextSteps?: string[];
		generalFeedback?: string | null;
	};
	type GuidanceTone = 'strength' | 'weakness' | 'subject';
	type SubjectFilter = {
		key: string;
		label: string;
		count: number;
	};
	type FallbackSubjectSummary = {
		key: string;
		label: string;
		count: number;
		gradedCount: number;
		averagePercentage: number | null;
		runIds: string[];
		summary: string;
	};

	let { data }: { data: PageData } = $props();
	let selectedSubjectKey = $state('all');
	let selectedDashboardDetail = $state<DashboardDetail>('overview');

	function formatDate(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatMarks(awarded: number, max: number): string {
		return `${awarded.toString()} / ${max.toString()}`;
	}

	function formatPercentage(percentage: number): string {
		const rounded = Math.round(percentage * 10) / 10;
		return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
	}

	function formatSheetCount(count: number): string {
		return `${count.toString()} sheet${count === 1 ? '' : 's'}`;
	}

	function totalMarks(sheet: PaperSheetData | null): number {
		if (!sheet) {
			return 0;
		}
		let total = 0;
		for (const section of sheet.sections) {
			if (!('id' in section)) {
				continue;
			}
			total += sumPaperSheetMarks(section.questions);
		}
		return total;
	}

	function averagePercentage(sheets: Sheet[]): number | null {
		const percentages = sheets
			.map((sheet) => sheet.totals?.percentage ?? null)
			.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
		if (percentages.length === 0) {
			return null;
		}
		const total = percentages.reduce((sum, value) => sum + value, 0);
		return total / percentages.length;
	}

	function countGradedSheets(sheets: Sheet[]): number {
		return sheets.filter((sheet) => sheet.totals !== null).length;
	}

	function rgbaFromHex(hex: string, alpha: number): string {
		const normalized = hex.replace('#', '');
		const red = Number.parseInt(normalized.slice(0, 2), 16);
		const green = Number.parseInt(normalized.slice(2, 4), 16);
		const blue = Number.parseInt(normalized.slice(4, 6), 16);
		return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
	}

	function buildPreviewStyle(
		sheet: PaperSheetData | null,
		primarySubjectKey: string | null
	): string {
		const subjectTheme =
			primarySubjectKey === null ? null : resolveSheetSubjectTheme({ key: primarySubjectKey });
		const color = subjectTheme?.color ?? sheet?.color ?? '#36587a';
		const accent = subjectTheme?.accent ?? sheet?.accent ?? '#4d7aa5';
		const light = subjectTheme?.light ?? sheet?.light ?? '#e8f2fb';
		const border = subjectTheme?.border ?? sheet?.border ?? '#bfd0e0';
		return [
			`--sheet-color:${color}`,
			`--sheet-accent:${accent}`,
			`--sheet-light:${light}`,
			`--sheet-border:${border}`,
			`--sheet-color-08:${rgbaFromHex(color, 0.08)}`,
			`--sheet-accent-18:${rgbaFromHex(accent, 0.18)}`
		].join('; ');
	}

	function buildSubjectStyle(subject: { key: string; label: string }): string {
		const theme = resolveSheetSubjectTheme(subject);
		return [
			`--subject-color:${theme.color}`,
			`--subject-accent:${theme.accent}`,
			`--subject-light:${theme.light}`,
			`--subject-border:${theme.border}`,
			`--subject-light-82:${rgbaFromHex(theme.light, 0.82)}`,
			`--subject-accent-12:${rgbaFromHex(theme.accent, 0.12)}`
		].join('; ');
	}

	function resolveMarksSummary(sheet: Sheet): {
		value: string;
		detail: string | null;
	} {
		const maxMarks = sheet.totals?.maxMarks ?? totalMarks(sheet.previewSheet);
		if (sheet.totals) {
			const percentage =
				sheet.totals.percentage ??
				(sheet.totals.maxMarks > 0
					? (sheet.totals.awardedMarks / sheet.totals.maxMarks) * 100
					: null);
			return {
				value: formatMarks(sheet.totals.awardedMarks, sheet.totals.maxMarks),
				detail: percentage === null ? null : formatPercentage(percentage)
			};
		}
		if (maxMarks > 0) {
			return {
				value: `— / ${maxMarks.toString()}`,
				detail: null
			};
		}
		return {
			value: 'Not graded',
			detail: null
		};
	}

	function resolveStatusLabel(sheet: Sheet): string {
		if (sheet.status === 'failed') {
			return 'Failed';
		}
		if (sheet.status === 'stopped') {
			return 'Stopped';
		}
		if (sheet.sheetPhase === 'building') {
			return sheet.status === 'created' ? 'Queued' : 'Preparing';
		}
		if (sheet.sheetPhase === 'solving') {
			return 'Ready to Solve';
		}
		if (sheet.sheetPhase === 'grading') {
			return sheet.status === 'created' ? 'Queued' : 'Grading';
		}
		return 'Graded';
	}

	function resolveStatusTone(
		sheet: Sheet
	): 'queued' | 'building' | 'solving' | 'grading' | 'graded' | 'failed' | 'stopped' {
		if (sheet.status === 'failed') {
			return 'failed';
		}
		if (sheet.status === 'stopped') {
			return 'stopped';
		}
		if (sheet.sheetPhase === 'building') {
			return sheet.status === 'created' ? 'queued' : 'building';
		}
		if (sheet.sheetPhase === 'solving') {
			return 'solving';
		}
		if (sheet.sheetPhase === 'grading') {
			return sheet.status === 'created' ? 'queued' : 'grading';
		}
		return 'graded';
	}

	function resolveFooterText(sheet: PageData['sheets'][number]): string {
		if (sheet.display.footer) {
			return sheet.display.footer;
		}
		return [sheet.previewSheet?.level ?? 'Worksheet', sheet.previewSheet?.subject ?? 'Submission'].join(
			' · '
		);
	}

	function resolveSheetTitle(sheet: Sheet): string {
		return sheet.previewSheet?.title ?? sheet.display.title;
	}

	function resolveDashboardEntryVisible(
		entry: { subjectKeys: string[]; evidenceRunIds: string[] },
		subjectKey: string,
		sheetById: Map<string, Sheet>
	): boolean {
		if (subjectKey === 'all') {
			return true;
		}
		if (entry.subjectKeys.includes(subjectKey)) {
			return true;
		}
		for (const runId of entry.evidenceRunIds) {
			const sheet = sheetById.get(runId);
			if (sheet?.subjectTags.some((tag) => tag.key === subjectKey)) {
				return true;
			}
		}
		return false;
	}

	function resolveEvidenceSheets(runIds: string[], sheetById: Map<string, Sheet>): Sheet[] {
		const seen = new Set<string>();
		const sheets: Sheet[] = [];
		for (const runId of runIds) {
			if (seen.has(runId)) {
				continue;
			}
			seen.add(runId);
			const sheet = sheetById.get(runId);
			if (sheet) {
				sheets.push(sheet);
			}
		}
		return sheets;
	}

	function hasGuidance(entry: DashboardGuidance | null | undefined): boolean {
		return (
			(entry?.specifics?.length ?? 0) > 0 ||
			(entry?.nextSteps?.length ?? 0) > 0 ||
			typeof entry?.generalFeedback === 'string'
		);
	}

	function resolveGuidanceLabel(tone: GuidanceTone, section: 'specifics' | 'nextSteps'): string {
		if (section === 'specifics') {
			if (tone === 'strength') {
				return 'Specific strengths';
			}
			if (tone === 'subject') {
				return 'Specific topics and patterns';
			}
			return 'Specific gaps';
		}
		if (tone === 'strength') {
			return 'Build on this next';
		}
		if (tone === 'subject') {
			return 'Learn next';
		}
		return 'What to learn deeper';
	}

	const sheetById = $derived.by(() => new Map(data.sheets.map((sheet) => [sheet.id, sheet])));

	const subjectFilters = $derived.by(() => {
		const counts = new Map<string, SubjectFilter>();
		for (const sheet of data.sheets) {
			for (const subject of sheet.subjectTags) {
				const existing = counts.get(subject.key);
				if (existing) {
					existing.count += 1;
					continue;
				}
				counts.set(subject.key, {
					key: subject.key,
					label: resolveSheetSubjectLabel(subject),
					count: 1
				});
			}
		}
		return [
			{ key: 'all', label: 'All subjects', count: data.sheets.length },
			...[...counts.values()].sort((left, right) => left.label.localeCompare(right.label))
		];
	});
	const detectedSubjectFilters = $derived.by(() =>
		subjectFilters.filter((subject) => subject.key !== 'all')
	);

	const filteredSheets = $derived.by(() => {
		if (selectedSubjectKey === 'all') {
			return data.sheets;
		}
		return data.sheets.filter((sheet) =>
			sheet.subjectTags.some((subject) => subject.key === selectedSubjectKey)
		);
	});

	const filteredAverage = $derived.by(() => averagePercentage(filteredSheets));
	const filteredGradedCount = $derived.by(() => countGradedSheets(filteredSheets));
	const activeSubjectFilter = $derived.by(
		() => subjectFilters.find((subject) => subject.key === selectedSubjectKey) ?? null
	);
	const visibleStrengths = $derived.by(() =>
		(data.dashboard?.strengths ?? []).filter((entry) =>
			resolveDashboardEntryVisible(entry, selectedSubjectKey, sheetById)
		)
	);
	const visibleWeakSpots = $derived.by(() =>
		(data.dashboard?.weakSpots ?? []).filter((entry) =>
			resolveDashboardEntryVisible(entry, selectedSubjectKey, sheetById)
		)
	);
	const visibleSubjects = $derived.by(() => {
		if (!data.dashboard) {
			return [];
		}
		if (selectedSubjectKey === 'all') {
			return data.dashboard.subjects;
		}
		return data.dashboard.subjects.filter((subject) => subject.key === selectedSubjectKey);
	});
	const activeSubjectSummary = $derived.by(() =>
		selectedSubjectKey === 'all'
			? null
			: (data.dashboard?.subjects.find((subject) => subject.key === selectedSubjectKey) ?? null)
	);
	const fallbackSubjectSummaries = $derived.by(() =>
		detectedSubjectFilters.map<FallbackSubjectSummary>((subject) => {
			const subjectSheets = data.sheets.filter((sheet) =>
				sheet.subjectTags.some((tag) => tag.key === subject.key)
			);
			const gradedCount = countGradedSheets(subjectSheets);
			const average = averagePercentage(subjectSheets);
			const summaryParts = [`${formatSheetCount(subject.count)} tagged ${subject.label}`];
			if (gradedCount > 0 && average !== null) {
				summaryParts.push(
					`${formatPercentage(average)} average across ${formatSheetCount(gradedCount)}`
				);
			} else if (gradedCount > 0) {
				summaryParts.push(`${formatSheetCount(gradedCount)} graded`);
			} else {
				summaryParts.push('Awaiting grading');
			}
			return {
				key: subject.key,
				label: subject.label,
				count: subject.count,
				gradedCount,
				averagePercentage: average,
				runIds: subjectSheets.map((sheet) => sheet.id),
				summary: summaryParts.join(' · ')
			};
		})
	);
	const activeFallbackSubjectSummary = $derived.by(() =>
		selectedSubjectKey === 'all'
			? null
			: (fallbackSubjectSummaries.find((subject) => subject.key === selectedSubjectKey) ?? null)
	);
	const dashboardHeadline = $derived.by(() => {
		if (data.dashboard?.headline) {
			return data.dashboard.headline;
		}
		if (activeSubjectFilter && activeSubjectFilter.key !== 'all') {
			return `${activeSubjectFilter.label} overview`;
		}
		if (filteredGradedCount > 0) {
			return 'Sheets overview';
		}
		return 'Sheets in progress';
	});
	const dashboardFallbackSummary = $derived.by(() => {
		if (filteredGradedCount === 0) {
			return 'Marks and subject filters appear here as soon as a sheet finishes grading.';
		}
		if (activeFallbackSubjectSummary) {
			return `${activeFallbackSubjectSummary.label} is already filterable. Ask Spark chat to publish strong and weak spot summaries for this subject.`;
		}
		return 'Average score and subject filters are already live. Ask Spark chat to refresh the dashboard to publish cross-sheet strengths, weak spots, and subject summaries.';
	});
	const dashboardOverviewSummary = $derived.by(() => {
		if (detectedSubjectFilters.length === 0) {
			return 'Sheet cards below will pick up live subject filters as soon as Spark can read them from the work.';
		}
		return 'Use the live subject filters below to narrow the worksheet list while you wait for the first published dashboard summary.';
	});
	const subjectScoreValue = $derived.by(() =>
		data.dashboard ? visibleSubjects.length.toString() : detectedSubjectFilters.length.toString()
	);
</script>

<svelte:head>
	<title>Spark · Sheets</title>
</svelte:head>

<section class="sheets-page">
	<header class="sheets-header">
		<div>
			<p class="eyebrow">Worksheet workspace</p>
			<h1>Sheets</h1>
			<p class="subtitle">
				Open generated worksheets to solve them, then return here for grading, marks, and feedback.
			</p>
		</div>
		<a class="back-button" href="/spark">Back to chat</a>
	</header>

	{#if data.sheets.length === 0}
		<section class="empty-card">
			<h2>No sheets yet</h2>
			<p>Start from chat by uploading material and asking Spark to make or grade a sheet.</p>
		</section>
	{:else}
		<section class="filters-row">
			<div class="subject-filter-list">
				{#each subjectFilters as subject (subject.key)}
					<button
						type="button"
						class:subject-filter--active={selectedSubjectKey === subject.key}
						class="subject-filter"
						style={subject.key === 'all' ? undefined : buildSubjectStyle(subject)}
						onclick={() => {
							selectedSubjectKey = subject.key;
						}}
					>
						<span>{subject.label}</span>
						<span class="subject-filter__count">{subject.count.toString()}</span>
					</button>
				{/each}
			</div>
			<p class="filters-row__count">
				Showing {filteredSheets.length.toString()} of {data.sheets.length.toString()} sheets
			</p>
		</section>

		<section class="dashboard-shell">
			<div class="dashboard-band">
				<div>
					<p class="dashboard-band__eyebrow">Score card</p>
					<h2 class="dashboard-band__title">{dashboardHeadline}</h2>
				</div>
				<p class="dashboard-band__timestamp">
					{#if data.dashboard}
						Updated {formatDate(data.dashboard.updatedAt)}
					{:else}
						Bootstrap mode until the first dashboard refresh publishes cross-sheet insights
					{/if}
				</p>
				{#if data.dashboard?.summaryMarkdown}
					<div class="dashboard-band__summary markdown-content">
						{@html renderMarkdownOptional(data.dashboard.summaryMarkdown) ?? ''}
					</div>
				{:else}
					<p class="dashboard-band__summary-fallback">{dashboardFallbackSummary}</p>
				{/if}
			</div>

			<div class="dashboard-score-grid">
				<button
					type="button"
					class="dashboard-score"
					data-active={selectedDashboardDetail === 'overview'}
					onclick={() => {
						selectedDashboardDetail = 'overview';
					}}
				>
					<p class="dashboard-score__label">Average score</p>
					<p class="dashboard-score__value">
						{filteredAverage === null ? 'Pending' : formatPercentage(filteredAverage)}
					</p>
					<p class="dashboard-score__detail">
						{filteredGradedCount.toString()} graded sheet{filteredGradedCount === 1 ? '' : 's'}
					</p>
				</button>

				<button
					type="button"
					class="dashboard-score"
					data-active={selectedDashboardDetail === 'strengths'}
					onclick={() => {
						selectedDashboardDetail = 'strengths';
					}}
				>
					<p class="dashboard-score__label">Strong spots</p>
					<p class="dashboard-score__value">
						{data.dashboard ? visibleStrengths.length.toString() : 'Pending'}
					</p>
					<p class="dashboard-score__detail">
						{data.dashboard ? 'Patterns worth keeping' : 'Publish from graded work'}
					</p>
				</button>

				<button
					type="button"
					class="dashboard-score"
					data-active={selectedDashboardDetail === 'weakSpots'}
					onclick={() => {
						selectedDashboardDetail = 'weakSpots';
					}}
				>
					<p class="dashboard-score__label">Weak spots</p>
					<p class="dashboard-score__value">
						{data.dashboard ? visibleWeakSpots.length.toString() : 'Pending'}
					</p>
					<p class="dashboard-score__detail">
						{data.dashboard ? 'Most repeated misses' : 'Publish from graded work'}
					</p>
				</button>

				<button
					type="button"
					class="dashboard-score"
					data-active={selectedDashboardDetail === 'subjects'}
					onclick={() => {
						selectedDashboardDetail = 'subjects';
					}}
				>
					<p class="dashboard-score__label">Subjects</p>
					<p class="dashboard-score__value">{subjectScoreValue}</p>
					<p class="dashboard-score__detail">
						{data.dashboard ? 'Tagged filters in play' : 'Detected filters'}
					</p>
				</button>
			</div>

			<div class="dashboard-detail">
				{#if selectedDashboardDetail === 'overview'}
					<div class="dashboard-detail__overview">
						{#if data.dashboard && activeSubjectSummary}
							<h3>{activeSubjectSummary.label}</h3>
							<p>{activeSubjectSummary.summary}</p>
							<div class="subject-summary__chips">
								{#each activeSubjectSummary.strongSpots as spot}
									<span class="dashboard-chip dashboard-chip--positive">{spot}</span>
								{/each}
								{#each activeSubjectSummary.weakSpots as spot}
									<span class="dashboard-chip dashboard-chip--warning">{spot}</span>
								{/each}
							</div>
							{#if hasGuidance(activeSubjectSummary)}
								<div class="detail-entry__guidance">
									{#if activeSubjectSummary.specifics.length > 0}
										<div class="detail-entry__section">
											<p class="detail-entry__section-label">
												{resolveGuidanceLabel('subject', 'specifics')}
											</p>
											<ul class="detail-entry__list">
												{#each activeSubjectSummary.specifics as item}
													<li>{item}</li>
												{/each}
											</ul>
										</div>
									{/if}
									{#if activeSubjectSummary.nextSteps.length > 0}
										<div class="detail-entry__section">
											<p class="detail-entry__section-label">
												{resolveGuidanceLabel('subject', 'nextSteps')}
											</p>
											<ul class="detail-entry__list">
												{#each activeSubjectSummary.nextSteps as item}
													<li>{item}</li>
												{/each}
											</ul>
										</div>
									{/if}
									{#if activeSubjectSummary.generalFeedback}
										<p class="detail-entry__general">{activeSubjectSummary.generalFeedback}</p>
									{/if}
								</div>
							{/if}
						{:else if data.dashboard?.summaryMarkdown}
							<div class="markdown-content">
								{@html renderMarkdownOptional(data.dashboard.summaryMarkdown) ?? ''}
							</div>
						{:else if activeFallbackSubjectSummary}
							{@const evidenceSheets = resolveEvidenceSheets(
								activeFallbackSubjectSummary.runIds,
								sheetById
							)}
							<h3>{activeFallbackSubjectSummary.label}</h3>
							<p>{activeFallbackSubjectSummary.summary}</p>
							<div class="subject-summary__chips">
								{#if typeof activeFallbackSubjectSummary.averagePercentage === 'number'}
									<span class="dashboard-chip dashboard-chip--positive">
										{formatPercentage(activeFallbackSubjectSummary.averagePercentage)} average
									</span>
								{/if}
								{#if activeFallbackSubjectSummary.gradedCount > 0}
									<span class="dashboard-chip">
										{formatSheetCount(activeFallbackSubjectSummary.gradedCount)} graded
									</span>
								{:else}
									<span class="dashboard-chip">Awaiting grading</span>
								{/if}
							</div>
							{#if evidenceSheets.length > 0}
								<div class="detail-entry__links">
									{#each evidenceSheets as sheet (sheet.id)}
										<a href={`/spark/sheets/${sheet.id}`}>{resolveSheetTitle(sheet)}</a>
									{/each}
								</div>
							{/if}
						{:else}
							<h3>Current worksheet activity</h3>
							<p>{dashboardOverviewSummary}</p>
							{#if detectedSubjectFilters.length > 0}
								<div class="subject-summary__chips">
									{#each detectedSubjectFilters as subject (subject.key)}
										<span class="subject-pill" style={buildSubjectStyle(subject)}>
											{subject.label}
										</span>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				{:else if selectedDashboardDetail === 'strengths'}
					{#if !data.dashboard}
						<p class="dashboard-detail__empty">
							Strong spots will appear after Spark publishes the first dashboard refresh from graded
							sheets.
						</p>
					{:else if visibleStrengths.length === 0}
						<p class="dashboard-detail__empty">No strong spots are published for this view yet.</p>
					{:else}
						<div class="detail-entry-list">
							{#each visibleStrengths as entry (entry.id)}
								{@const evidenceSheets = resolveEvidenceSheets(entry.evidenceRunIds, sheetById)}
								<article class="detail-entry" data-tone="positive">
									<h3>{entry.title}</h3>
									<p>{entry.summary}</p>
									{#if hasGuidance(entry)}
										<div class="detail-entry__guidance">
											{#if entry.specifics.length > 0}
												<div class="detail-entry__section">
													<p class="detail-entry__section-label">
														{resolveGuidanceLabel('strength', 'specifics')}
													</p>
													<ul class="detail-entry__list">
														{#each entry.specifics as item}
															<li>{item}</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if entry.nextSteps.length > 0}
												<div class="detail-entry__section">
													<p class="detail-entry__section-label">
														{resolveGuidanceLabel('strength', 'nextSteps')}
													</p>
													<ul class="detail-entry__list">
														{#each entry.nextSteps as item}
															<li>{item}</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if entry.generalFeedback}
												<p class="detail-entry__general">{entry.generalFeedback}</p>
											{/if}
										</div>
									{/if}
									{#if evidenceSheets.length > 0}
										<div class="detail-entry__links">
											{#each evidenceSheets as sheet (sheet.id)}
												<a href={`/spark/sheets/${sheet.id}`}>{resolveSheetTitle(sheet)}</a>
											{/each}
										</div>
									{/if}
								</article>
							{/each}
						</div>
					{/if}
				{:else if selectedDashboardDetail === 'weakSpots'}
					{#if !data.dashboard}
						<p class="dashboard-detail__empty">
							Weak spots will appear after Spark publishes the first dashboard refresh from graded
							sheets.
						</p>
					{:else if visibleWeakSpots.length === 0}
						<p class="dashboard-detail__empty">No weak spots are published for this view yet.</p>
					{:else}
						<div class="detail-entry-list">
							{#each visibleWeakSpots as entry (entry.id)}
								{@const evidenceSheets = resolveEvidenceSheets(entry.evidenceRunIds, sheetById)}
								<article class="detail-entry" data-tone="warning">
									<h3>{entry.title}</h3>
									<p>{entry.summary}</p>
									{#if hasGuidance(entry)}
										<div class="detail-entry__guidance">
											{#if entry.specifics.length > 0}
												<div class="detail-entry__section">
													<p class="detail-entry__section-label">
														{resolveGuidanceLabel('weakness', 'specifics')}
													</p>
													<ul class="detail-entry__list">
														{#each entry.specifics as item}
															<li>{item}</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if entry.nextSteps.length > 0}
												<div class="detail-entry__section">
													<p class="detail-entry__section-label">
														{resolveGuidanceLabel('weakness', 'nextSteps')}
													</p>
													<ul class="detail-entry__list">
														{#each entry.nextSteps as item}
															<li>{item}</li>
														{/each}
													</ul>
												</div>
											{/if}
											{#if entry.generalFeedback}
												<p class="detail-entry__general">{entry.generalFeedback}</p>
											{/if}
										</div>
									{/if}
									{#if evidenceSheets.length > 0}
										<div class="detail-entry__links">
											{#each evidenceSheets as sheet (sheet.id)}
												<a href={`/spark/sheets/${sheet.id}`}>{resolveSheetTitle(sheet)}</a>
											{/each}
										</div>
									{/if}
								</article>
							{/each}
						</div>
					{/if}
				{:else if data.dashboard && visibleSubjects.length === 0}
					<p class="dashboard-detail__empty">
						No subject summaries are published for this view yet.
					</p>
				{:else if data.dashboard}
					<div class="detail-entry-list">
						{#each visibleSubjects as subject (subject.key)}
							{@const evidenceSheets = resolveEvidenceSheets(subject.runIds, sheetById)}
							<article class="detail-entry" data-tone="neutral">
								<div class="detail-entry__subject-row">
									<span class="subject-pill" style={buildSubjectStyle(subject)}>
										{resolveSheetSubjectLabel(subject)}
									</span>
									{#if typeof subject.averagePercentage === 'number'}
										<span class="detail-entry__meta"
											>{formatPercentage(subject.averagePercentage)}</span
										>
									{/if}
								</div>
								<p>{subject.summary}</p>
								<div class="subject-summary__chips">
									{#each subject.strongSpots as spot}
										<span class="dashboard-chip dashboard-chip--positive">{spot}</span>
									{/each}
									{#each subject.weakSpots as spot}
										<span class="dashboard-chip dashboard-chip--warning">{spot}</span>
									{/each}
								</div>
								{#if hasGuidance(subject)}
									<div class="detail-entry__guidance">
										{#if subject.specifics.length > 0}
											<div class="detail-entry__section">
												<p class="detail-entry__section-label">
													{resolveGuidanceLabel('subject', 'specifics')}
												</p>
												<ul class="detail-entry__list">
													{#each subject.specifics as item}
														<li>{item}</li>
													{/each}
												</ul>
											</div>
										{/if}
										{#if subject.nextSteps.length > 0}
											<div class="detail-entry__section">
												<p class="detail-entry__section-label">
													{resolveGuidanceLabel('subject', 'nextSteps')}
												</p>
												<ul class="detail-entry__list">
													{#each subject.nextSteps as item}
														<li>{item}</li>
													{/each}
												</ul>
											</div>
										{/if}
										{#if subject.generalFeedback}
											<p class="detail-entry__general">{subject.generalFeedback}</p>
										{/if}
									</div>
								{/if}
								{#if evidenceSheets.length > 0}
									<div class="detail-entry__links">
										{#each evidenceSheets as sheet (sheet.id)}
											<a href={`/spark/sheets/${sheet.id}`}>{resolveSheetTitle(sheet)}</a>
										{/each}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				{:else if fallbackSubjectSummaries.length === 0}
					<p class="dashboard-detail__empty">
						Subject filters will appear after Spark can read a stable subject from the sheet.
					</p>
				{:else}
					<div class="detail-entry-list">
						{#each fallbackSubjectSummaries as subject (subject.key)}
							{@const evidenceSheets = resolveEvidenceSheets(subject.runIds, sheetById)}
							<article class="detail-entry" data-tone="neutral">
								<div class="detail-entry__subject-row">
									<span class="subject-pill" style={buildSubjectStyle(subject)}>
										{subject.label}
									</span>
									{#if typeof subject.averagePercentage === 'number'}
										<span class="detail-entry__meta"
											>{formatPercentage(subject.averagePercentage)}</span
										>
									{:else}
										<span class="detail-entry__meta">{formatSheetCount(subject.count)}</span>
									{/if}
								</div>
								<p>{subject.summary}</p>
								<div class="subject-summary__chips">
									{#if subject.gradedCount > 0}
										<span class="dashboard-chip dashboard-chip--positive">
											{formatSheetCount(subject.gradedCount)} graded
										</span>
									{:else}
										<span class="dashboard-chip">Awaiting grading</span>
									{/if}
								</div>
								{#if evidenceSheets.length > 0}
									<div class="detail-entry__links">
										{#each evidenceSheets as sheet (sheet.id)}
											<a href={`/spark/sheets/${sheet.id}`}>{resolveSheetTitle(sheet)}</a>
										{/each}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				{/if}
			</div>
		</section>

		<div class="sheet-grid">
			{#each filteredSheets as sheet (sheet.id)}
				{@const marksSummary = resolveMarksSummary(sheet)}
				{@const summaryHtml = renderMarkdownOptional(sheet.display.summaryMarkdown)}
				<a class="sheet-card" href={`/spark/sheets/${sheet.id}`} data-status={sheet.status}>
					<div
						class="sheet-preview"
						style={buildPreviewStyle(sheet.previewSheet, sheet.primarySubjectKey)}
					>
						<header class="sheet-preview__header">
							<div class="sheet-preview__header-row">
								<div class="sheet-preview__marks-box">
									<p class="sheet-preview__marks-label">Marks</p>
									<p class="sheet-preview__marks-value">{marksSummary.value}</p>
									{#if marksSummary.detail}
										<p class="sheet-preview__marks-detail">{marksSummary.detail}</p>
									{/if}
								</div>

								<div>
									<p class="sheet-preview__eyebrow">
										{sheet.previewSheet?.level ?? 'Worksheet'} ·
										{sheet.previewSheet?.subject ?? 'Submission'}
									</p>
									<h2 class="sheet-preview__title">
										{sheet.display.title}
									</h2>
									<p class="sheet-preview__subtitle">
										{sheet.display.subtitle ??
											sheet.previewSheet?.subtitle ??
											sheet.analysis?.summary ??
											sheet.display.summaryMarkdown ??
											'Awaiting sheet output.'}
									</p>
									{#if sheet.subjectTags.length > 0}
										<div class="sheet-preview__tag-row">
											{#each sheet.subjectTags as subject (subject.key)}
												<span class="subject-pill" style={buildSubjectStyle(subject)}>
													{resolveSheetSubjectLabel(subject)}
												</span>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						</header>

						<div class="sheet-preview__body">
							<div class="sheet-preview__meta">
								<span class="status-pill" data-status={resolveStatusTone(sheet)}>
									{resolveStatusLabel(sheet)}
								</span>
								<span>Updated {formatDate(sheet.updatedAt)}</span>
							</div>

							{#if sheet.error}
								<p class="sheet-preview__error">{sheet.error}</p>
							{:else if summaryHtml}
								<div class="sheet-preview__summary markdown-content">
									{@html summaryHtml}
								</div>
							{/if}

							{#if sheet.analysis && (sheet.analysis.strongSpots.length > 0 || sheet.analysis.weakSpots.length > 0)}
								<div class="sheet-preview__signals">
									{#each sheet.analysis.strongSpots as spot}
										<span class="dashboard-chip dashboard-chip--positive">{spot}</span>
									{/each}
									{#each sheet.analysis.weakSpots as spot}
										<span class="dashboard-chip dashboard-chip--warning">{spot}</span>
									{/each}
								</div>
							{/if}
						</div>

						<footer class="sheet-preview__footer">
							<span>{resolveFooterText(sheet)}</span>
						</footer>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</section>

<style lang="postcss">
	.sheets-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: min(88rem, 94vw);
		margin: 0 auto 3rem;
		padding-top: 1.5rem;
	}

	.sheets-header {
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
		font-weight: 600;
		color: rgba(59, 130, 246, 0.85);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.5rem, 3vw, 2.1rem);
	}

	.subtitle {
		margin: 0.4rem 0 0;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
		max-width: 44rem;
	}

	.back-button {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
		background: color-mix(in srgb, var(--card) 94%, transparent);
		text-decoration: none;
		font-weight: 600;
		color: inherit;
	}

	.empty-card,
	.dashboard-shell {
		border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
		border-radius: 1.2rem;
		background: color-mix(in srgb, var(--card) 96%, transparent);
	}

	.empty-card {
		padding: 1.2rem;
		border-style: dashed;
	}

	.empty-card h2 {
		margin: 0;
	}

	.empty-card p {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.dashboard-shell {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background:
			radial-gradient(circle at top right, rgba(34, 197, 94, 0.08), transparent 28%),
			radial-gradient(circle at top left, rgba(37, 99, 235, 0.08), transparent 30%),
			color-mix(in srgb, var(--card) 98%, transparent);
	}

	.dashboard-band {
		display: grid;
		gap: 0.5rem;
	}

	.dashboard-band__eyebrow {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.72rem;
		font-weight: 700;
		color: color-mix(in srgb, #2563eb 78%, white 8%);
	}

	.dashboard-band__title {
		margin: 0;
		font-size: clamp(1.2rem, 2.5vw, 1.75rem);
	}

	.dashboard-band__timestamp {
		margin: 0;
		font-size: 0.82rem;
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
	}

	.dashboard-band__summary :global(ul) {
		margin: 0;
		padding-left: 1rem;
	}

	.dashboard-band__summary-fallback {
		margin: 0;
		color: color-mix(in srgb, var(--foreground) 70%, transparent);
	}

	.dashboard-score-grid {
		display: grid;
		gap: 0.8rem;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
	}

	.dashboard-score {
		display: grid;
		gap: 0.2rem;
		padding: 0.9rem 1rem;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
		background: color-mix(in srgb, white 80%, var(--card) 20%);
		text-align: left;
		color: inherit;
		cursor: pointer;
		transition:
			transform 120ms ease,
			border-color 120ms ease,
			box-shadow 120ms ease;
	}

	.dashboard-score:hover,
	.dashboard-score[data-active='true'] {
		transform: translateY(-1px);
		border-color: color-mix(in srgb, #2563eb 35%, var(--border));
		box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
	}

	.dashboard-score__label,
	.dashboard-score__detail,
	.dashboard-score__value {
		margin: 0;
	}

	.dashboard-score__label {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: color-mix(in srgb, var(--foreground) 64%, transparent);
	}

	.dashboard-score__value {
		font-size: 1.5rem;
		font-weight: 800;
	}

	.dashboard-score__detail {
		font-size: 0.84rem;
		color: color-mix(in srgb, var(--foreground) 66%, transparent);
	}

	.dashboard-detail {
		padding: 1rem;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
		background: color-mix(in srgb, white 78%, var(--card) 22%);
	}

	.dashboard-detail__empty,
	.dashboard-detail__overview p {
		margin: 0;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
	}

	.dashboard-detail__overview {
		display: grid;
		gap: 0.8rem;
	}

	.dashboard-detail__overview h3 {
		margin: 0;
	}

	.detail-entry-list {
		display: grid;
		gap: 0.85rem;
	}

	.detail-entry {
		display: grid;
		gap: 0.6rem;
		padding: 0.95rem 1rem;
		border-radius: 0.95rem;
		border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
		background: color-mix(in srgb, var(--card) 94%, transparent);
	}

	.detail-entry[data-tone='positive'] {
		border-color: rgba(34, 197, 94, 0.24);
		background: rgba(34, 197, 94, 0.06);
	}

	.detail-entry[data-tone='warning'] {
		border-color: rgba(245, 158, 11, 0.28);
		background: rgba(245, 158, 11, 0.08);
	}

	.detail-entry h3,
	.detail-entry p {
		margin: 0;
	}

	.detail-entry__guidance {
		display: grid;
		gap: 0.7rem;
	}

	.detail-entry__section {
		display: grid;
		gap: 0.4rem;
	}

	.detail-entry__section-label {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.72rem;
		font-weight: 700;
		color: color-mix(in srgb, var(--foreground) 60%, transparent);
	}

	.detail-entry__list {
		margin: 0;
		padding-left: 1.1rem;
		display: grid;
		gap: 0.35rem;
		color: color-mix(in srgb, var(--foreground) 78%, transparent);
	}

	.detail-entry__list li {
		margin: 0;
	}

	.detail-entry__general {
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
	}

	.detail-entry__links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.detail-entry__links a {
		display: inline-flex;
		align-items: center;
		padding: 0.28rem 0.55rem;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.06);
		text-decoration: none;
		color: inherit;
		font-size: 0.82rem;
	}

	.detail-entry__subject-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
	}

	.detail-entry__meta {
		font-size: 0.82rem;
		font-weight: 700;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.subject-summary__chips,
	.sheet-preview__signals,
	.sheet-preview__tag-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.filters-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.subject-filter-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.subject-filter {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		background: color-mix(in srgb, var(--card) 96%, transparent);
		color: inherit;
		cursor: pointer;
	}

	.subject-filter:not(.subject-filter--active)[style] {
		border-color: var(--subject-border);
		background: var(--subject-light-82);
		color: var(--subject-color);
	}

	.subject-filter--active {
		border-color: color-mix(in srgb, #2563eb 42%, var(--border));
		box-shadow: 0 10px 24px rgba(37, 99, 235, 0.12);
	}

	.subject-filter__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5rem;
		height: 1.5rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.08);
		font-size: 0.74rem;
		font-weight: 700;
	}

	.filters-row__count {
		margin: 0;
		font-size: 0.84rem;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.dashboard-chip,
	.subject-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.24rem 0.6rem;
		border-radius: 999px;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.subject-pill {
		border: 1px solid var(--subject-border);
		background: var(--subject-light-82);
		color: var(--subject-color);
	}

	.dashboard-chip {
		background: color-mix(in srgb, var(--border) 65%, transparent);
		color: color-mix(in srgb, var(--foreground) 78%, transparent);
	}

	.dashboard-chip--positive {
		background: rgba(34, 197, 94, 0.12);
		color: #166534;
	}

	.dashboard-chip--warning {
		background: rgba(245, 158, 11, 0.14);
		color: #92400e;
	}

	.sheet-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		align-items: start;
	}

	.sheet-card {
		display: block;
		text-decoration: none;
		color: inherit;
	}

	.sheet-preview {
		overflow: hidden;
		border-radius: 1.1rem;
		border: 1px solid var(--sheet-border);
		background: white;
		box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
	}

	.sheet-preview__header {
		position: relative;
		padding: 1.1rem 1.2rem 1rem;
		background:
			radial-gradient(circle at 90% 20%, var(--sheet-accent-18) 0 18%, transparent 19%),
			radial-gradient(circle at 82% 8%, var(--sheet-color-08) 0 16%, transparent 17%),
			linear-gradient(135deg, var(--sheet-light) 0%, white 100%);
		border-bottom: 1px solid var(--sheet-border);
	}

	.sheet-preview__header-row {
		display: flow-root;
	}

	.sheet-preview__eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		font-weight: 700;
		color: var(--sheet-accent);
	}

	.sheet-preview__title {
		margin: 0.5rem 0 0;
		font-size: 1.3rem;
		line-height: 1.15;
		color: var(--sheet-color);
	}

	.sheet-preview__subtitle {
		margin: 0.4rem 0 0;
		font-size: 0.92rem;
		color: color-mix(in srgb, var(--sheet-color) 72%, transparent);
	}

	.sheet-preview__tag-row {
		margin-top: 0.7rem;
	}

	.sheet-preview__marks-box {
		float: right;
		width: 7.5rem;
		min-width: 7.5rem;
		margin: 0 0 0.55rem 0.85rem;
		padding: 0.58rem 0.72rem;
		text-align: center;
		border-radius: 0.95rem;
		background: white;
		border: 1px solid var(--sheet-border);
	}

	.sheet-preview__marks-label {
		margin: 0;
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--sheet-color) 62%, transparent);
	}

	.sheet-preview__marks-value {
		margin: 0.14rem 0 0;
		font-size: 1rem;
		font-weight: 800;
		line-height: 1.1;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		color: var(--sheet-color);
	}

	.sheet-preview__marks-detail {
		margin: 0.14rem 0 0;
		font-size: 0.7rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: color-mix(in srgb, var(--sheet-color) 66%, transparent);
	}

	.sheet-preview__body {
		padding: 1rem 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		background: inherit;
	}

	.sheet-preview__meta {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
		font-size: 0.82rem;
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.18rem 0.55rem;
		border-radius: 999px;
		text-transform: uppercase;
		font-weight: 700;
		letter-spacing: 0.06em;
		background: color-mix(in srgb, var(--border) 70%, transparent);
		color: color-mix(in srgb, var(--foreground) 74%, transparent);
	}

	.status-pill[data-status='solving'],
	.status-pill[data-status='graded'] {
		background: color-mix(in srgb, #16a34a 16%, transparent);
		color: color-mix(in srgb, #166534 90%, black 6%);
	}

	.status-pill[data-status='building'],
	.status-pill[data-status='grading'] {
		background: color-mix(in srgb, #0ea5e9 16%, transparent);
		color: color-mix(in srgb, #075985 90%, black 6%);
	}

	.status-pill[data-status='queued'] {
		background: color-mix(in srgb, #f59e0b 16%, transparent);
		color: color-mix(in srgb, #92400e 90%, black 6%);
	}

	.status-pill[data-status='failed'] {
		background: color-mix(in srgb, var(--destructive) 14%, transparent);
		color: color-mix(in srgb, var(--destructive) 82%, black 8%);
	}

	.status-pill[data-status='stopped'] {
		background: color-mix(in srgb, #64748b 16%, transparent);
		color: color-mix(in srgb, #334155 90%, black 6%);
	}

	.sheet-preview__summary {
		font-size: 0.92rem;
	}

	.sheet-preview__error {
		margin: 0;
		color: var(--destructive);
	}

	.sheet-preview__footer {
		display: flex;
		justify-content: flex-start;
		gap: 0.8rem;
		padding: 0.9rem 1.2rem;
		font-size: 0.78rem;
		color: color-mix(in srgb, var(--sheet-color) 78%, transparent);
		border-top: 1px solid var(--sheet-border);
		background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, var(--sheet-light) 150%);
	}

	:global([data-theme='dark'] .dashboard-shell),
	:global(:root:not([data-theme='light']) .dashboard-shell) {
		border-color: #3a3258;
		background:
			radial-gradient(circle at top right, rgba(34, 197, 94, 0.14), transparent 28%),
			radial-gradient(circle at top left, rgba(214, 161, 30, 0.16), transparent 32%),
			#17142a;
		box-shadow: 0 30px 80px -48px rgba(2, 6, 23, 0.9);
	}

	:global([data-theme='dark'] .subtitle),
	:global([data-theme='dark'] .empty-card p),
	:global([data-theme='dark'] .dashboard-band__timestamp),
	:global([data-theme='dark'] .dashboard-band__summary-fallback),
	:global([data-theme='dark'] .dashboard-band__summary),
	:global([data-theme='dark'] .dashboard-score__label),
	:global([data-theme='dark'] .dashboard-score__detail),
	:global([data-theme='dark'] .dashboard-detail__empty),
	:global([data-theme='dark'] .dashboard-detail__overview p),
	:global([data-theme='dark'] .detail-entry p),
	:global([data-theme='dark'] .detail-entry__general),
	:global([data-theme='dark'] .detail-entry__list),
	:global([data-theme='dark'] .detail-entry__meta),
	:global([data-theme='dark'] .filters-row__count),
	:global(:root:not([data-theme='light']) .subtitle),
	:global(:root:not([data-theme='light']) .empty-card p),
	:global(:root:not([data-theme='light']) .dashboard-band__timestamp),
	:global(:root:not([data-theme='light']) .dashboard-band__summary-fallback),
	:global(:root:not([data-theme='light']) .dashboard-band__summary),
	:global(:root:not([data-theme='light']) .dashboard-score__label),
	:global(:root:not([data-theme='light']) .dashboard-score__detail),
	:global(:root:not([data-theme='light']) .dashboard-detail__empty),
	:global(:root:not([data-theme='light']) .dashboard-detail__overview p),
	:global(:root:not([data-theme='light']) .detail-entry p),
	:global(:root:not([data-theme='light']) .detail-entry__general),
	:global(:root:not([data-theme='light']) .detail-entry__list),
	:global(:root:not([data-theme='light']) .detail-entry__meta),
	:global(:root:not([data-theme='light']) .filters-row__count) {
		color: #c5bbdf;
	}

	:global([data-theme='dark'] .empty-card),
	:global([data-theme='dark'] .back-button),
	:global(:root:not([data-theme='light']) .empty-card),
	:global(:root:not([data-theme='light']) .back-button) {
		border-color: #3a3258;
		background: #1d1934;
		color: #e4dff5;
	}

	:global([data-theme='dark'] .dashboard-band__title),
	:global([data-theme='dark'] .dashboard-detail__overview h3),
	:global([data-theme='dark'] .detail-entry h3),
	:global([data-theme='dark'] .detail-entry__section-label),
	:global(:root:not([data-theme='light']) .dashboard-band__title),
	:global(:root:not([data-theme='light']) .dashboard-detail__overview h3),
	:global(:root:not([data-theme='light']) .detail-entry h3),
	:global(:root:not([data-theme='light']) .detail-entry__section-label) {
		color: #f0eef8;
	}

	:global([data-theme='dark'] .dashboard-score),
	:global(:root:not([data-theme='light']) .dashboard-score) {
		border-color: #3a3258;
		background: #201c39;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}

	:global([data-theme='dark'] .dashboard-score:hover),
	:global([data-theme='dark'] .dashboard-score[data-active='true']),
	:global(:root:not([data-theme='light']) .dashboard-score:hover),
	:global(:root:not([data-theme='light']) .dashboard-score[data-active='true']) {
		border-color: #5c517c;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			0 18px 36px -28px rgba(2, 6, 23, 0.65);
	}

	:global([data-theme='dark'] .dashboard-detail),
	:global(:root:not([data-theme='light']) .dashboard-detail) {
		border-color: #3a3258;
		background: #1d1934;
	}

	:global([data-theme='dark'] .detail-entry),
	:global(:root:not([data-theme='light']) .detail-entry) {
		border-color: #3a3258;
		background: #201c39;
	}

	:global([data-theme='dark'] .detail-entry[data-tone='positive']),
	:global(:root:not([data-theme='light']) .detail-entry[data-tone='positive']) {
		border-color: rgba(74, 222, 128, 0.24);
		background: rgba(22, 101, 52, 0.18);
	}

	:global([data-theme='dark'] .detail-entry[data-tone='warning']),
	:global(:root:not([data-theme='light']) .detail-entry[data-tone='warning']) {
		border-color: rgba(251, 191, 36, 0.24);
		background: rgba(146, 64, 14, 0.22);
	}

	:global([data-theme='dark'] .detail-entry__links a),
	:global(:root:not([data-theme='light']) .detail-entry__links a) {
		background: #1d1934;
		border: 1px solid #3a3258;
		color: #e4dff5;
	}

	:global([data-theme='dark'] .subject-filter),
	:global(:root:not([data-theme='light']) .subject-filter) {
		border-color: #3a3258;
		background: #201c39;
		color: #e4dff5;
	}

	:global([data-theme='dark'] .subject-filter:not(.subject-filter--active)[style]),
	:global(:root:not([data-theme='light']) .subject-filter:not(.subject-filter--active)[style]) {
		border-color: color-mix(in srgb, var(--subject-color) 32%, #3a3258);
		background: color-mix(in srgb, var(--subject-color) 16%, #201c39);
		color: color-mix(in srgb, var(--subject-light) 32%, #f0eef8);
	}

	:global([data-theme='dark'] .subject-filter--active),
	:global(:root:not([data-theme='light']) .subject-filter--active) {
		border-color: #fbbf24;
		background: color-mix(in srgb, #d6a11e 24%, #1d1934);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.03),
			0 18px 36px -28px rgba(2, 6, 23, 0.65);
	}

	:global([data-theme='dark'] .subject-filter__count),
	:global(:root:not([data-theme='light']) .subject-filter__count) {
		background: rgba(255, 255, 255, 0.14);
		color: #f0eef8;
	}

	:global([data-theme='dark'] .dashboard-chip),
	:global(:root:not([data-theme='light']) .dashboard-chip) {
		background: #1d1934;
		color: #e4dff5;
		border: 1px solid #3a3258;
	}

	:global([data-theme='dark'] .dashboard-chip--positive),
	:global(:root:not([data-theme='light']) .dashboard-chip--positive) {
		background: rgba(34, 197, 94, 0.18);
		color: #bbf7d0;
	}

	:global([data-theme='dark'] .dashboard-chip--warning),
	:global(:root:not([data-theme='light']) .dashboard-chip--warning) {
		background: rgba(245, 158, 11, 0.2);
		color: #fde68a;
	}

	:global([data-theme='dark'] .sheet-preview),
	:global(:root:not([data-theme='light']) .sheet-preview) {
		border-color: color-mix(in srgb, var(--sheet-color) 40%, #4a416d);
		background: #201c39;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.03),
			0 28px 64px -40px rgba(2, 6, 23, 0.82);
	}

	:global([data-theme='dark'] .sheet-preview__title),
	:global(:root:not([data-theme='light']) .sheet-preview__title) {
		color: color-mix(in srgb, var(--sheet-color) 56%, #f0eef8);
	}

	:global([data-theme='dark'] .sheet-preview__eyebrow),
	:global(:root:not([data-theme='light']) .sheet-preview__eyebrow) {
		color: color-mix(in srgb, var(--sheet-accent) 42%, #f0eef8 58%);
	}

	:global([data-theme='dark'] .sheet-preview__header),
	:global(:root:not([data-theme='light']) .sheet-preview__header) {
		background:
			radial-gradient(circle at 90% 20%, var(--sheet-accent-18) 0 18%, transparent 19%),
			radial-gradient(circle at 82% 8%, var(--sheet-color-08) 0 16%, transparent 17%),
			linear-gradient(
				135deg,
				color-mix(in srgb, var(--sheet-color) 18%, #201c39) 0%,
				#17142a 100%
			);
		border-bottom-color: color-mix(in srgb, var(--sheet-color) 34%, #302850);
	}

	:global([data-theme='dark'] .sheet-preview__marks-box),
	:global(:root:not([data-theme='light']) .sheet-preview__marks-box) {
		border-color: color-mix(in srgb, var(--sheet-color) 34%, #302850);
		background: #201c39;
	}

	:global([data-theme='dark'] .sheet-preview__body),
	:global(:root:not([data-theme='light']) .sheet-preview__body) {
		background: linear-gradient(180deg, #201c39 0%, #1b1732 100%);
	}

	:global([data-theme='dark'] .sheet-preview__subtitle),
	:global([data-theme='dark'] .sheet-preview__marks-label),
	:global([data-theme='dark'] .sheet-preview__marks-detail),
	:global([data-theme='dark'] .sheet-preview__footer),
	:global([data-theme='dark'] .sheet-preview__summary),
	:global(:root:not([data-theme='light']) .sheet-preview__subtitle),
	:global(:root:not([data-theme='light']) .sheet-preview__marks-label),
	:global(:root:not([data-theme='light']) .sheet-preview__marks-detail),
	:global(:root:not([data-theme='light']) .sheet-preview__footer),
	:global(:root:not([data-theme='light']) .sheet-preview__summary) {
		color: color-mix(in srgb, #c5bbdf 74%, var(--sheet-color) 26%);
	}

	:global([data-theme='dark'] .sheet-preview__meta),
	:global(:root:not([data-theme='light']) .sheet-preview__meta) {
		color: #b8aed3;
	}

	:global([data-theme='dark'] .sheet-preview__footer),
	:global(:root:not([data-theme='light']) .sheet-preview__footer) {
		background: linear-gradient(
			180deg,
			rgba(23, 20, 42, 0) 0%,
			color-mix(in srgb, var(--sheet-color) 10%, #1d1934) 160%
		);
		border-top-color: color-mix(in srgb, var(--sheet-color) 36%, #3a3258);
	}

	:global([data-theme='dark'] .status-pill[data-status='solving']),
	:global([data-theme='dark'] .status-pill[data-status='graded']),
	:global(:root:not([data-theme='light']) .status-pill[data-status='solving']),
	:global(:root:not([data-theme='light']) .status-pill[data-status='graded']) {
		color: #dcfce7;
	}

	:global([data-theme='dark'] .status-pill[data-status='building']),
	:global([data-theme='dark'] .status-pill[data-status='grading']),
	:global(:root:not([data-theme='light']) .status-pill[data-status='building']),
	:global(:root:not([data-theme='light']) .status-pill[data-status='grading']) {
		color: #dbeafe;
	}

	:global([data-theme='dark'] .status-pill[data-status='queued']),
	:global(:root:not([data-theme='light']) .status-pill[data-status='queued']) {
		color: #fde68a;
	}

	@media (max-width: 700px) {
		.sheets-header {
			flex-direction: column;
		}

		.sheet-preview__footer {
			flex-direction: column;
		}

		.sheet-preview__marks-box {
			width: 6.8rem;
			min-width: 6.8rem;
			margin-left: 0.65rem;
		}
	}
</style>
