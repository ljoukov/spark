<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';
	import { sumPaperSheetMarks, type PaperSheetData } from '@spark/schemas';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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

	function buildPreviewStyle(sheet: PaperSheetData | null): string {
		const color = sheet?.color ?? '#36587a';
		const accent = sheet?.accent ?? '#4d7aa5';
		const light = sheet?.light ?? '#e8f2fb';
		const border = sheet?.border ?? '#bfd0e0';
		return [
			`--sheet-color:${color}`,
			`--sheet-accent:${accent}`,
			`--sheet-light:${light}`,
			`--sheet-border:${border}`,
			`--sheet-color-08:${rgbaFromHex(color, 0.08)}`,
			`--sheet-accent-18:${rgbaFromHex(accent, 0.18)}`
		].join('; ');
	}

	function resolveMarksSummary(sheet: PageData['sheets'][number]): {
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

	function resolveStatusLabel(sheet: PageData['sheets'][number]): string {
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
		sheet: PageData['sheets'][number]
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
		<div class="sheet-grid">
			{#each data.sheets as sheet (sheet.id)}
				{@const marksSummary = resolveMarksSummary(sheet)}
				<a class="sheet-card" href={`/spark/sheets/${sheet.id}`} data-status={sheet.status}>
					<div class="sheet-preview" style={buildPreviewStyle(sheet.previewSheet)}>
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
										{sheet.previewSheet?.title ?? sheet.display.title}
									</h2>
									<p class="sheet-preview__subtitle">
										{sheet.previewSheet?.subtitle ?? sheet.display.summaryMarkdown ?? 'Awaiting sheet output.'}
									</p>
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
							{:else if sheet.display.summaryMarkdown}
								<div class="sheet-preview__summary markdown-content">
									{@html renderMarkdown(sheet.display.summaryMarkdown)}
								</div>
							{/if}
						</div>

						<footer class="sheet-preview__footer">
							<span>
								{sheet.previewSheet?.level ?? 'Worksheet'} ·
								{sheet.previewSheet?.subject ?? 'Submission'} ·
								{sheet.previewSheet?.title ?? sheet.display.title}
							</span>
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

	.empty-card {
		border: 1px dashed color-mix(in srgb, var(--border) 85%, transparent);
		border-radius: 1rem;
		padding: 1.2rem;
		background: color-mix(in srgb, var(--card) 96%, transparent);
	}

	.empty-card h2 {
		margin: 0;
	}

	.empty-card p {
		margin: 0.35rem 0 0;
		color: color-mix(in srgb, var(--foreground) 68%, transparent);
	}

	.sheet-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
	}

	.sheet-card {
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
