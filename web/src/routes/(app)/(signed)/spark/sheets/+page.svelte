<script lang="ts">
	import { renderMarkdownOptional } from '$lib/markdown';
	import {
		normalizeSheetSubjectKey,
		resolveSheetSubjectLabel,
		resolveSheetSubjectTheme
	} from '$lib/spark/sheetSubjects';
	import { sumPaperSheetMarks, type PaperSheetData } from '@spark/schemas';
	import type { PageData } from './$types';

	type Dashboard = Awaited<PageData['dashboard']>;
	type Sheet = Dashboard['sheets'][number];
	type Gap = Dashboard['gaps'][number];
	type GapTypeFilter = 'all' | Gap['type'];
	type SubjectFilter = {
		key: string;
		label: string;
		count: number;
	};

	let { data }: { data: PageData } = $props();
	let selectedSubjectKey = $state('all');
	let selectedGapType = $state<GapTypeFilter>('all');

	const GAP_TYPE_FILTERS: Array<{ key: GapTypeFilter; label: string }> = [
		{ key: 'all', label: 'All' },
		{ key: 'knowledge_gap', label: 'Knowledge gap' },
		{ key: 'misconception', label: 'Misconception' },
		{ key: 'oversight', label: 'Oversight' }
	];

	const GAP_TYPE_THEME: Record<
		Gap['type'],
		{ label: string; accent: string; light: string; border: string; text: string }
	> = {
		knowledge_gap: {
			label: 'Knowledge gap',
			accent: '#0F8B6F',
			light: '#E4F7F0',
			border: '#8EDAC5',
			text: '#075E4D'
		},
		misconception: {
			label: 'Misconception',
			accent: '#B23A56',
			light: '#FBE7EC',
			border: '#E9A8B8',
			text: '#7D1E35'
		},
		oversight: {
			label: 'Oversight',
			accent: '#A36A13',
			light: '#FFF1CC',
			border: '#E9C46A',
			text: '#71480A'
		}
	};

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

	function formatSheetError(error: string): string {
		const compact = error.replace(/\s+/g, ' ').trim();
		if (
			/(api key|apikey|bucket|credential|env|environment|firebase|gcs|google|service account|secret|token|vertex)/i.test(
				compact
			)
		) {
			return 'This sheet could not be processed. Try opening it or grading again.';
		}
		if (compact.length > 180) {
			return `${compact.slice(0, 179).trimEnd()}…`;
		}
		return compact;
	}

	function formatMarks(awarded: number, max: number): string {
		return `${awarded.toString()} / ${max.toString()}`;
	}

	function formatPercentage(percentage: number): string {
		const rounded = Math.round(percentage * 10) / 10;
		return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
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
			primarySubjectKey === null
				? sheet?.subject
					? resolveSheetSubjectTheme({ label: sheet.subject })
					: null
				: resolveSheetSubjectTheme({ key: primarySubjectKey });
		const fallbackTheme = resolveSheetSubjectTheme({ key: 'general' });
		const color = subjectTheme?.color ?? sheet?.color ?? fallbackTheme.color;
		const accent = subjectTheme?.accent ?? sheet?.accent ?? fallbackTheme.accent;
		const light = subjectTheme?.light ?? sheet?.light ?? fallbackTheme.light;
		const border = subjectTheme?.border ?? sheet?.border ?? fallbackTheme.border;
		const darkColor = subjectTheme?.darkColor ?? fallbackTheme.darkColor;
		const darkAccent = subjectTheme?.darkAccent ?? fallbackTheme.darkAccent;
		const darkLight = subjectTheme?.darkLight ?? fallbackTheme.darkLight;
		const darkBorder = subjectTheme?.darkBorder ?? fallbackTheme.darkBorder;
		return [
			`--sheet-color:${color}`,
			`--sheet-accent:${accent}`,
			`--sheet-light:${light}`,
			`--sheet-border:${border}`,
			`--sheet-dark-color:${darkColor}`,
			`--sheet-dark-accent:${darkAccent}`,
			`--sheet-dark-light:${darkLight}`,
			`--sheet-dark-border:${darkBorder}`,
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
			`--subject-dark-color:${theme.darkColor}`,
			`--subject-dark-accent:${theme.darkAccent}`,
			`--subject-dark-light:${theme.darkLight}`,
			`--subject-dark-border:${theme.darkBorder}`,
			`--subject-light-82:${rgbaFromHex(theme.light, 0.82)}`,
			`--subject-accent-12:${rgbaFromHex(theme.accent, 0.12)}`
		].join('; ');
	}

	function buildGapStyle(gap: Gap): string {
		const subjectTheme = resolveSheetSubjectTheme({ key: gap.subjectKey, label: gap.subjectLabel });
		const typeTheme = GAP_TYPE_THEME[gap.type];
		return [
			`--gap-subject-color:${subjectTheme.color}`,
			`--gap-subject-accent:${subjectTheme.accent}`,
			`--gap-subject-light:${subjectTheme.light}`,
			`--gap-type-accent:${typeTheme.accent}`,
			`--gap-type-light:${typeTheme.light}`,
			`--gap-type-border:${typeTheme.border}`,
			`--gap-type-text:${typeTheme.text}`,
			`--gap-type-accent-14:${rgbaFromHex(typeTheme.accent, 0.14)}`,
			`--gap-subject-accent-12:${rgbaFromHex(subjectTheme.accent, 0.12)}`
		].join('; ');
	}

	function gapTypeLabel(type: Gap['type']): string {
		return GAP_TYPE_THEME[type].label;
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

	function isWeakFooterText(value: string, sheet: Sheet): boolean {
		const plain = normalizePlainText(value);
		if (!plain || /^\d{4}$/u.test(plain)) {
			return true;
		}
		const repeatedValues = [
			sheet.display.title,
			sheet.display.subtitle,
			sheet.previewSheet?.title,
			sheet.previewSheet?.subtitle,
			sheet.previewSheet?.subject,
			sheet.previewSheet?.level
		];
		for (const repeatedValue of repeatedValues) {
			const repeated = normalizePlainText(repeatedValue);
			if (repeated.length < 8) {
				continue;
			}
			if (plain === repeated || plain.includes(repeated) || repeated.includes(plain)) {
				return true;
			}
		}
		return false;
	}

	function resolveFooterText(sheet: Sheet): string | null {
		const footer = sheet.display.footer?.trim();
		if (!footer || isWeakFooterText(footer, sheet)) {
			return null;
		}
		return footer;
	}

	function normalizePlainText(value: string | null | undefined): string {
		if (!value) {
			return '';
		}
		return value
			.replace(/`([^`]+)`/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/[*_#>|~]/g, ' ')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.toLowerCase();
	}

	function isPendingSheet(sheet: Sheet): boolean {
		if (sheet.status === 'failed' || sheet.status === 'stopped') {
			return false;
		}
		return sheet.sheetPhase === 'building' || sheet.sheetPhase === 'grading';
	}

	function isGenericPreviewSummary(value: string): boolean {
		const plain = normalizePlainText(value);
		return /^(this sheet|the worksheet|worksheet draft|student worksheet|checked the visible worksheet|uploaded material|submitted answers|waiting for|spark has queued)\b/.test(
			plain
		);
	}

	function repeatsVisibleMetadata(value: string, sheet: Sheet): boolean {
		const plain = normalizePlainText(value);
		if (!plain) {
			return true;
		}
		const visibleValues = [
			sheet.display.title,
			sheet.display.subtitle,
			sheet.display.footer,
			sheet.previewSheet?.title,
			sheet.previewSheet?.subtitle,
			sheet.previewSheet?.subject,
			sheet.previewSheet?.level,
			resolveFooterText(sheet)
		];
		for (const visibleValue of visibleValues) {
			const visible = normalizePlainText(visibleValue);
			if (visible.length < 8) {
				continue;
			}
			if (plain === visible || plain.includes(visible) || visible.includes(plain)) {
				return true;
			}
		}
		return false;
	}

	function resolvePreviewSummaryMarkdown(sheet: Sheet): string | null {
		const candidates = [
			sheet.display.summaryMarkdown,
			sheet.analysis?.summary,
			sheet.analysis?.generalFeedback,
			sheet.analysis?.specifics[0] ?? null
		];
		for (const candidate of candidates) {
			const trimmed = candidate?.trim();
			if (!trimmed) {
				continue;
			}
			if (repeatsVisibleMetadata(trimmed, sheet)) {
				continue;
			}
			if (!isPendingSheet(sheet) && isGenericPreviewSummary(trimmed)) {
				continue;
			}
			return trimmed;
		}
		return null;
	}

	function pushSignal(target: string[], value: string): void {
		const compact = value
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/[.!?]+$/g, '');
		if (compact.length === 0) {
			return;
		}
		const short = compact.length > 64 ? `${compact.slice(0, 63).trimEnd()}…` : compact;
		const normalized = short.toLowerCase();
		if (!target.some((existing) => existing.toLowerCase() === normalized)) {
			target.push(short);
		}
	}

	function resolveDevelopmentSignals(sheet: Sheet): string[] {
		const signals: string[] = [];
		if (!sheet.analysis) {
			return signals;
		}
		for (const spot of sheet.analysis.weakSpots) {
			pushSignal(signals, spot);
			if (signals.length >= 3) {
				return signals;
			}
		}
		for (const step of sheet.analysis.nextSteps) {
			pushSignal(signals, step);
			if (signals.length >= 3) {
				return signals;
			}
		}
		return signals;
	}

	function resolveSubjectFilters(sheets: Sheet[]): SubjectFilter[] {
		const counts = new Map<string, SubjectFilter>();
		for (const sheet of sheets) {
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
			{ key: 'all', label: 'All subjects', count: sheets.length },
			...[...counts.values()].sort((left, right) => left.label.localeCompare(right.label))
		];
	}

	function filterSheets(sheets: Sheet[]): Sheet[] {
		if (selectedSubjectKey === 'all') {
			return sheets;
		}
		return sheets.filter((sheet) =>
			sheet.subjectTags.some((subject) => subject.key === selectedSubjectKey)
		);
	}

	function resolveSelectedSubjectLabel(subjectFilters: SubjectFilter[]): string {
		return (
			subjectFilters.find((subject) => subject.key === selectedSubjectKey)?.label ?? 'this subject'
		);
	}

	function filterGaps(gaps: Gap[]): Gap[] {
		if (selectedSubjectKey === 'all') {
			return [];
		}
		return gaps.filter((gap) => {
			if (normalizeSheetSubjectKey(gap.subjectKey) !== selectedSubjectKey) {
				return false;
			}
			if (selectedGapType === 'all') {
				return true;
			}
			return gap.type === selectedGapType;
		});
	}
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

	{#await data.dashboard}
		<section class="sheets-loading" role="status" aria-live="polite" aria-label="Loading sheets">
			<div class="sheets-loading__header">
				<span class="sheets-loading__spinner" aria-hidden="true"></span>
				<div>
					<h2>Loading sheets</h2>
					<p>Checking worksheet runs, marks, and feedback.</p>
				</div>
			</div>
			<div class="sheets-loading__filters" aria-hidden="true">
				<span></span>
				<span></span>
				<span></span>
			</div>
			<div class="sheet-grid sheet-grid--loading" aria-hidden="true">
				{#each Array.from({ length: 6 }) as _, index (index)}
					<div class="sheet-preview sheet-preview--skeleton">
						<div class="sheet-preview__header">
							<div class="skeleton-line skeleton-line--short"></div>
							<div class="skeleton-line skeleton-line--title"></div>
							<div class="skeleton-line"></div>
						</div>
						<div class="sheet-preview__body">
							<div class="skeleton-line skeleton-line--meta"></div>
							<div class="skeleton-line"></div>
							<div class="skeleton-line skeleton-line--half"></div>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{:then dashboard}
		{@const subjectFilters = resolveSubjectFilters(dashboard.sheets)}
		{@const filteredSheets = filterSheets(dashboard.sheets)}
		{@const selectedSubjectLabel = resolveSelectedSubjectLabel(subjectFilters)}
		{@const filteredGaps = filterGaps(dashboard.gaps)}
		{#if dashboard.sheets.length === 0}
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
					Showing {filteredSheets.length.toString()} of {dashboard.sheets.length.toString()} sheets
				</p>
			</section>

			{#if selectedSubjectKey !== 'all'}
				<section class="gaps-panel" aria-label={`${selectedSubjectLabel} gaps`}>
					<div class="gap-type-filter-list" aria-label="Gap type filters">
						{#each GAP_TYPE_FILTERS as filter (filter.key)}
							<button
								type="button"
								class:gap-type-filter--active={selectedGapType === filter.key}
								class="gap-type-filter"
								onclick={() => {
									selectedGapType = filter.key;
								}}
							>
								{filter.label}
							</button>
						{/each}
					</div>

					{#if filteredGaps.length > 0}
						<div class="gap-row" aria-label="Practice gaps">
							{#each filteredGaps as gap (gap.id)}
								<a class="gap-card" style={buildGapStyle(gap)} href={`/spark/gaps/${gap.id}`}>
									<div class="gap-card__header">
										<span class="gap-card__type">{gapTypeLabel(gap.type)}</span>
										<span class="gap-card__marks">
											{gap.source.awardedMarks ?? 0}/{gap.source.maxMarks ?? 0}
										</span>
									</div>
									<h2>{gap.title}</h2>
									<p>{gap.cardQuestion}</p>
									<footer>
										<span>{gap.subjectLabel}</span>
										<span>{gap.source.questionLabel ?? gap.source.questionId}</span>
									</footer>
								</a>
							{/each}
						</div>
					{:else}
						<p class="gap-empty">No practice gaps for {selectedSubjectLabel} yet.</p>
					{/if}
				</section>
			{/if}

			<div class="sheet-grid">
				{#each filteredSheets as sheet (sheet.id)}
					{@const marksSummary = resolveMarksSummary(sheet)}
					{@const summaryHtml = renderMarkdownOptional(resolvePreviewSummaryMarkdown(sheet))}
					{@const developmentSignals = resolveDevelopmentSignals(sheet)}
					{@const footerText = resolveFooterText(sheet)}
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
									<span>Created {formatDate(sheet.createdAt)}</span>
								</div>

								{#if sheet.error}
									<p class="sheet-preview__error">{formatSheetError(sheet.error)}</p>
								{:else if summaryHtml}
									<div class="sheet-preview__summary markdown-content">
										{@html summaryHtml}
									</div>
								{/if}

								{#if developmentSignals.length > 0}
									<div class="sheet-preview__signals">
										{#each developmentSignals as signal}
											<span class="sheet-signal sheet-signal--warning">{signal}</span>
										{/each}
									</div>
								{/if}
							</div>

							{#if footerText}
								<footer class="sheet-preview__footer">
									<span>{footerText}</span>
								</footer>
							{/if}
						</div>
					</a>
				{/each}
			</div>
		{/if}
	{:catch}
		<section class="empty-card" role="alert">
			<h2>Sheets could not load</h2>
			<p>Refresh the page and try again.</p>
		</section>
	{/await}
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
		font-size: 2rem;
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

	.empty-card {
		padding: 1.2rem;
		border: 1px dashed color-mix(in srgb, var(--border) 85%, transparent);
		border-radius: 1.2rem;
		background: color-mix(in srgb, var(--card) 96%, transparent);
	}

	.empty-card h2 {
		margin: 0;
	}

	.empty-card p {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.sheets-loading {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.sheets-loading__header {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.9rem 1rem;
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--card) 92%, transparent);
	}

	.sheets-loading__header h2 {
		margin: 0;
		font-size: 1rem;
	}

	.sheets-loading__header p {
		margin: 0.18rem 0 0;
		color: color-mix(in srgb, var(--foreground) 64%, transparent);
		font-size: 0.88rem;
	}

	.sheets-loading__spinner {
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--foreground) 14%, transparent);
		border-top-color: color-mix(in srgb, #007aff 90%, var(--foreground));
		animation: sheet-spin 0.8s linear infinite;
	}

	.sheets-loading__filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.sheets-loading__filters span {
		width: 7.6rem;
		height: 2.15rem;
		border-radius: 999px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--foreground) 7%, transparent),
			color-mix(in srgb, var(--foreground) 13%, transparent),
			color-mix(in srgb, var(--foreground) 7%, transparent)
		);
		background-size: 220% 100%;
		animation: sheet-skeleton 1.25s ease-in-out infinite;
	}

	.sheet-grid--loading {
		pointer-events: none;
	}

	.sheet-preview--skeleton {
		--sheet-color: #0057d9;
		--sheet-accent: #007aff;
		--sheet-light: #eaf4ff;
		--sheet-border: #c4ddf8;
		--sheet-color-08: rgba(0, 87, 217, 0.08);
		--sheet-accent-18: rgba(0, 122, 255, 0.18);
		min-height: 17rem;
	}

	.skeleton-line {
		width: 100%;
		height: 0.78rem;
		border-radius: 8px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--sheet-color) 8%, transparent),
			color-mix(in srgb, var(--sheet-color) 18%, transparent),
			color-mix(in srgb, var(--sheet-color) 8%, transparent)
		);
		background-size: 220% 100%;
		animation: sheet-skeleton 1.25s ease-in-out infinite;
	}

	.skeleton-line--short {
		width: 42%;
	}

	.skeleton-line--title {
		width: 72%;
		height: 1.15rem;
		margin-top: 0.75rem;
	}

	.skeleton-line--meta {
		width: 62%;
	}

	.skeleton-line--half {
		width: 48%;
	}

	@keyframes sheet-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes sheet-skeleton {
		0% {
			background-position: 120% 0;
		}

		100% {
			background-position: -120% 0;
		}
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

	.gaps-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.gap-type-filter-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		padding-bottom: 0.1rem;
	}

	.gap-type-filter {
		flex: 0 0 auto;
		padding: 0.48rem 0.68rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
		background: color-mix(in srgb, var(--card) 96%, transparent);
		color: color-mix(in srgb, var(--foreground) 78%, transparent);
		font-size: 0.84rem;
		font-weight: 700;
		cursor: pointer;
	}

	.gap-type-filter--active {
		border-color: color-mix(in srgb, #0f8b6f 44%, var(--border));
		background: color-mix(in srgb, #0f8b6f 11%, var(--card));
		color: #075e4d;
	}

	.gap-row {
		display: flex;
		gap: 1rem;
		overflow-x: auto;
		padding: 0.15rem 0 0.4rem;
		scroll-snap-type: x proximity;
		scrollbar-width: thin;
	}

	.gap-card {
		flex: 0 0 clamp(17.5rem, 31%, 24rem);
		min-width: 17.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		min-height: 12rem;
		padding: 1rem;
		border-radius: 8px;
		border: 1px solid var(--gap-type-border);
		background: linear-gradient(135deg, var(--gap-type-light) 0%, white 58%), var(--gap-type-light);
		color: inherit;
		text-decoration: none;
		scroll-snap-align: start;
		box-shadow: 0 16px 38px rgba(15, 23, 42, 0.08);
	}

	.gap-card:hover {
		border-color: color-mix(in srgb, var(--gap-type-accent) 66%, var(--gap-type-border));
		box-shadow: 0 20px 44px rgba(15, 23, 42, 0.12);
		transform: translateY(-1px);
	}

	.gap-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
	}

	.gap-card__type,
	.gap-card__marks {
		display: inline-flex;
		align-items: center;
		border-radius: 8px;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.gap-card__type {
		padding: 0.26rem 0.5rem;
		border: 1px solid var(--gap-type-border);
		background: var(--gap-type-accent-14);
		color: var(--gap-type-text);
	}

	.gap-card__marks {
		padding: 0.22rem 0.48rem;
		background: white;
		color: var(--gap-subject-color);
		border: 1px solid color-mix(in srgb, var(--gap-subject-accent) 36%, white);
		font-variant-numeric: tabular-nums;
	}

	.gap-card h2 {
		margin: 0;
		color: var(--gap-type-text);
		font-size: 1.08rem;
		line-height: 1.18;
	}

	.gap-card p {
		margin: 0;
		color: color-mix(in srgb, var(--foreground) 78%, var(--gap-type-text) 22%);
		line-height: 1.42;
	}

	.gap-card footer {
		display: flex;
		justify-content: space-between;
		gap: 0.7rem;
		margin-top: auto;
		color: color-mix(in srgb, var(--gap-subject-color) 72%, var(--foreground));
		font-size: 0.78rem;
		font-weight: 700;
	}

	.gap-empty {
		margin: 0;
		padding: 0.8rem 0.9rem;
		border-radius: 8px;
		border: 1px dashed color-mix(in srgb, var(--border) 84%, transparent);
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.subject-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.24rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--subject-border);
		background: var(--subject-light-82);
		color: var(--subject-color);
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.sheet-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(4, minmax(0, 1fr));
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
			radial-gradient(circle at 90% 20%, rgba(255, 255, 255, 0.08) 0 18%, transparent 19%),
			radial-gradient(circle at 82% 8%, rgba(255, 255, 255, 0.06) 0 16%, transparent 17%),
			linear-gradient(
				135deg,
				var(--sheet-color) 0%,
				color-mix(in srgb, var(--sheet-color) 88%, black) 100%
			);
		border-bottom: 1px solid color-mix(in srgb, var(--sheet-color) 76%, black);
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
		color: rgba(255, 255, 255, 0.78);
	}

	.sheet-preview__title {
		margin: 0.5rem 0 0;
		font-size: 1.3rem;
		line-height: 1.15;
		color: #ffffff;
	}

	.sheet-preview__subtitle {
		margin: 0.4rem 0 0;
		font-size: 0.92rem;
		color: rgba(255, 255, 255, 0.76);
	}

	.sheet-preview__tag-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin-top: 0.7rem;
	}

	.sheet-preview__tag-row .subject-pill {
		border-color: rgba(255, 255, 255, 0.34);
		background: rgba(255, 255, 255, 0.13);
		color: #ffffff;
	}

	.sheet-preview__signals {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.sheet-signal {
		display: inline-flex;
		align-items: center;
		padding: 0.24rem 0.6rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--border) 65%, transparent);
		color: color-mix(in srgb, var(--foreground) 78%, transparent);
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.sheet-signal--warning {
		background: rgba(245, 158, 11, 0.14);
		color: #92400e;
	}

	.sheet-preview__marks-box {
		float: right;
		width: 7.5rem;
		min-width: 7.5rem;
		margin: 0 0 0.55rem 0.85rem;
		padding: 0.58rem 0.72rem;
		text-align: center;
		border-radius: 0.95rem;
		background: rgba(255, 255, 255, 0.13);
		border: 1px solid rgba(255, 255, 255, 0.32);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
	}

	.sheet-preview__marks-label {
		margin: 0;
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.72);
	}

	.sheet-preview__marks-value {
		margin: 0.14rem 0 0;
		font-size: 1rem;
		font-weight: 800;
		line-height: 1.1;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		color: #ffffff;
	}

	.sheet-preview__marks-detail {
		margin: 0.14rem 0 0;
		font-size: 0.7rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.7);
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

	:global([data-theme='dark'] .subtitle),
	:global([data-theme='dark'] .empty-card p),
	:global([data-theme='dark'] .filters-row__count),
	:global(:root:not([data-theme='light']) .subtitle),
	:global(:root:not([data-theme='light']) .empty-card p),
	:global(:root:not([data-theme='light']) .filters-row__count) {
		color: #c5bbdf;
	}

	:global([data-theme='dark'] .empty-card),
	:global([data-theme='dark'] .back-button),
	:global([data-theme='dark'] .sheets-loading__header),
	:global(:root:not([data-theme='light']) .empty-card),
	:global(:root:not([data-theme='light']) .back-button),
	:global(:root:not([data-theme='light']) .sheets-loading__header) {
		border-color: #3a3258;
		background: #1d1934;
		color: #e4dff5;
	}

	:global([data-theme='dark'] .sheets-loading__header p),
	:global(:root:not([data-theme='light']) .sheets-loading__header p) {
		color: #c5bbdf;
	}

	:global([data-theme='dark'] .sheets-loading__filters span),
	:global(:root:not([data-theme='light']) .sheets-loading__filters span) {
		background: linear-gradient(90deg, #292340, #3a3258, #292340);
		background-size: 220% 100%;
	}

	:global([data-theme='dark'] .sheet-preview--skeleton),
	:global(:root:not([data-theme='light']) .sheet-preview--skeleton) {
		--sheet-dark-color: #7cc2ff;
		--sheet-dark-accent: #0a84ff;
		--sheet-dark-light: #102e4f;
		--sheet-dark-border: #1f5d9c;
	}

	:global([data-theme='dark'] .subject-filter),
	:global(:root:not([data-theme='light']) .subject-filter) {
		border-color: #3a3258;
		background: #201c39;
		color: #e4dff5;
	}

	:global([data-theme='dark'] .subject-filter:not(.subject-filter--active)[style]),
	:global(:root:not([data-theme='light']) .subject-filter:not(.subject-filter--active)[style]) {
		border-color: color-mix(in srgb, var(--subject-dark-accent) 36%, #3a3258);
		background: color-mix(in srgb, var(--subject-dark-light) 58%, #201c39);
		color: color-mix(in srgb, var(--subject-dark-color) 72%, #f0eef8);
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

	:global([data-theme='dark'] .gap-type-filter),
	:global(:root:not([data-theme='light']) .gap-type-filter) {
		border-color: #3a3258;
		background: #201c39;
		color: #e4dff5;
	}

	:global([data-theme='dark'] .gap-type-filter--active),
	:global(:root:not([data-theme='light']) .gap-type-filter--active) {
		border-color: color-mix(in srgb, #24b894 48%, #3a3258);
		background: color-mix(in srgb, #0f8b6f 20%, #201c39);
		color: #bff6df;
	}

	:global([data-theme='dark'] .gap-card),
	:global(:root:not([data-theme='light']) .gap-card) {
		border-color: color-mix(in srgb, var(--gap-type-accent) 46%, #3a3258);
		background:
			linear-gradient(
				135deg,
				color-mix(in srgb, var(--gap-type-accent) 20%, #201c39) 0%,
				#17142a 70%
			),
			#201c39;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.03),
			0 24px 56px -34px rgba(2, 6, 23, 0.82);
	}

	:global([data-theme='dark'] .gap-card__marks),
	:global(:root:not([data-theme='light']) .gap-card__marks) {
		background: #201c39;
		border-color: color-mix(in srgb, var(--gap-subject-accent) 38%, #3a3258);
		color: color-mix(in srgb, var(--gap-subject-light) 34%, #f0eef8);
	}

	:global([data-theme='dark'] .gap-card h2),
	:global(:root:not([data-theme='light']) .gap-card h2) {
		color: color-mix(in srgb, var(--gap-type-light) 46%, #f0eef8);
	}

	:global([data-theme='dark'] .gap-card p),
	:global([data-theme='dark'] .gap-card footer),
	:global([data-theme='dark'] .gap-empty),
	:global(:root:not([data-theme='light']) .gap-card p),
	:global(:root:not([data-theme='light']) .gap-card footer),
	:global(:root:not([data-theme='light']) .gap-empty) {
		color: #d8d0e9;
	}

	:global([data-theme='dark'] .sheet-signal),
	:global(:root:not([data-theme='light']) .sheet-signal) {
		background: #1d1934;
		color: #e4dff5;
		border: 1px solid #3a3258;
	}

	:global([data-theme='dark'] .sheet-signal--positive),
	:global(:root:not([data-theme='light']) .sheet-signal--positive) {
		background: rgba(34, 197, 94, 0.18);
		color: #bbf7d0;
	}

	:global([data-theme='dark'] .sheet-signal--warning),
	:global(:root:not([data-theme='light']) .sheet-signal--warning) {
		background: rgba(245, 158, 11, 0.2);
		color: #fde68a;
	}

	:global([data-theme='dark'] .sheet-preview),
	:global(:root:not([data-theme='light']) .sheet-preview) {
		border-color: color-mix(in srgb, var(--sheet-dark-border) 58%, #4a416d);
		background: #201c39;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.03),
			0 28px 64px -40px rgba(2, 6, 23, 0.82);
	}

	:global([data-theme='dark'] .sheet-preview__title),
	:global(:root:not([data-theme='light']) .sheet-preview__title) {
		color: #ffffff;
	}

	:global([data-theme='dark'] .sheet-preview__eyebrow),
	:global(:root:not([data-theme='light']) .sheet-preview__eyebrow) {
		color: rgba(255, 255, 255, 0.78);
	}

	:global([data-theme='dark'] .sheet-preview__header),
	:global(:root:not([data-theme='light']) .sheet-preview__header) {
		background:
			radial-gradient(circle at 90% 20%, rgba(255, 255, 255, 0.045) 0 18%, transparent 19%),
			radial-gradient(circle at 82% 8%, rgba(255, 255, 255, 0.035) 0 16%, transparent 17%),
			linear-gradient(
				135deg,
				color-mix(in srgb, var(--sheet-color, #1f7a4d) 66%, #17142a) 0%,
				color-mix(in srgb, var(--sheet-color, #1f7a4d) 48%, #17142a) 100%
			);
		border-bottom-color: color-mix(in srgb, var(--sheet-dark-border) 54%, #302850);
	}

	:global([data-theme='dark'] .sheet-preview__marks-box),
	:global(:root:not([data-theme='light']) .sheet-preview__marks-box) {
		border-color: rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.1);
	}

	:global([data-theme='dark'] .sheet-preview__body),
	:global(:root:not([data-theme='light']) .sheet-preview__body) {
		background: linear-gradient(180deg, #201c39 0%, #1b1732 100%);
	}

	:global([data-theme='dark'] .sheet-preview__subtitle),
	:global([data-theme='dark'] .sheet-preview__marks-label),
	:global([data-theme='dark'] .sheet-preview__marks-detail),
	:global(:root:not([data-theme='light']) .sheet-preview__subtitle),
	:global(:root:not([data-theme='light']) .sheet-preview__marks-label),
	:global(:root:not([data-theme='light']) .sheet-preview__marks-detail) {
		color: rgba(255, 255, 255, 0.72);
	}

	:global([data-theme='dark'] .sheet-preview__footer),
	:global([data-theme='dark'] .sheet-preview__summary),
	:global(:root:not([data-theme='light']) .sheet-preview__footer),
	:global(:root:not([data-theme='light']) .sheet-preview__summary) {
		color: color-mix(in srgb, #c5bbdf 74%, var(--sheet-dark-color) 26%);
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
			color-mix(in srgb, var(--sheet-dark-light) 46%, #1d1934) 160%
		);
		border-top-color: color-mix(in srgb, var(--sheet-dark-border) 54%, #3a3258);
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

	@media (max-width: 1120px) {
		.sheet-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (max-width: 860px) {
		.sheet-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 700px) {
		.sheets-page {
			width: calc(100vw - 1.5rem);
			gap: 0.85rem;
			padding-top: 1rem;
		}

		.sheets-header {
			flex-direction: column;
			gap: 0.7rem;
		}

		h1 {
			font-size: 1.7rem;
		}

		.subtitle {
			font-size: 0.95rem;
		}

		.filters-row {
			gap: 0.45rem;
		}

		.subject-filter-list {
			flex-wrap: nowrap;
			width: calc(100vw - 0.75rem);
			margin-inline: -0.75rem;
			padding-inline: 0.75rem;
			overflow-x: auto;
			scroll-snap-type: x proximity;
			scrollbar-width: none;
		}

		.subject-filter-list::-webkit-scrollbar {
			display: none;
		}

		.subject-filter {
			flex: 0 0 auto;
			scroll-snap-align: start;
		}

		.sheet-preview__footer {
			flex-direction: column;
		}

		.sheet-preview__marks-box {
			width: 6.8rem;
			min-width: 6.8rem;
			margin-left: 0.65rem;
		}

		.gap-card {
			flex-basis: 80%;
			min-width: 80%;
		}
	}

	@media (max-width: 560px) {
		.sheet-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
