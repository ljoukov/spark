<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';
	import type { PaperSheetData } from '@spark/schemas';
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
		return `${awarded.toString()}/${max.toString()}`;
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
			for (const question of section.questions ?? []) {
				total += question.marks;
			}
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

	function resolveStatusLabel(status: PageData['sheets'][number]['status']): string {
		switch (status) {
			case 'created':
				return 'Queued';
			case 'executing':
				return 'Grading';
			case 'done':
				return 'Ready';
			case 'failed':
				return 'Failed';
			case 'stopped':
				return 'Stopped';
		}
	}
</script>

<svelte:head>
	<title>Spark · Sheets</title>
</svelte:head>

<section class="sheets-page">
	<header class="sheets-header">
		<div>
			<p class="eyebrow">Worksheet feedback</p>
			<h1>Sheets</h1>
			<p class="subtitle">
				Open any sheet to review marks, see feedback, and continue the interactive revision flow.
			</p>
		</div>
		<a class="back-button" href="/spark">Back to chat</a>
	</header>

	{#if data.sheets.length === 0}
		<section class="empty-card">
			<h2>No sheets yet</h2>
			<p>Start from chat by uploading work and asking Spark to grade it.</p>
		</section>
	{:else}
		<div class="sheet-grid">
			{#each data.sheets as sheet (sheet.id)}
				<a class="sheet-card" href={`/spark/sheets/${sheet.id}`} data-status={sheet.status}>
					<div class="sheet-preview" style={buildPreviewStyle(sheet.previewSheet)}>
						<header class="sheet-preview__header">
							<div class="sheet-preview__header-row">
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

								<div class="sheet-preview__total-box">
									<p class="sheet-preview__total-label">Total marks</p>
									<p class="sheet-preview__total-value">{totalMarks(sheet.previewSheet)}</p>
								</div>
							</div>
						</header>

						<div class="sheet-preview__body">
							<div class="sheet-preview__meta">
								<span class="status-pill" data-status={sheet.status}>{resolveStatusLabel(sheet.status)}</span>
								<span>Updated {formatDate(sheet.updatedAt)}</span>
							</div>

							{#if sheet.error}
								<p class="sheet-preview__error">{sheet.error}</p>
							{:else if sheet.display.summaryMarkdown}
								<div class="sheet-preview__summary markdown-content">
									{@html renderMarkdown(sheet.display.summaryMarkdown)}
								</div>
							{/if}

							{#if sheet.totals}
								<div class="sheet-preview__stats">
									<div>
										<span>Marks</span>
										<p>{formatMarks(sheet.totals.awardedMarks, sheet.totals.maxMarks)}</p>
									</div>
									<div>
										<span>Score</span>
										<p>{sheet.totals.percentage === null ? '—' : `${sheet.totals.percentage.toFixed(1)}%`}</p>
									</div>
								</div>
							{/if}
						</div>

						<footer class="sheet-preview__footer">
							<span>
								{sheet.previewSheet?.level ?? 'Worksheet'} ·
								{sheet.previewSheet?.subject ?? 'Submission'} ·
								{sheet.previewSheet?.title ?? sheet.display.title}
							</span>
							<span>Spark Sheet</span>
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
		width: min(100%, 680px);
		max-width: 680px;
		justify-self: center;
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
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
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

	.sheet-preview__total-box {
		flex-shrink: 0;
		min-width: 4.8rem;
		padding: 0.72rem 0.8rem;
		text-align: center;
		border-radius: 0.95rem;
		background: white;
		border: 1px solid var(--sheet-border);
	}

	.sheet-preview__total-label {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--sheet-color) 62%, transparent);
	}

	.sheet-preview__total-value {
		margin: 0.2rem 0 0;
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--sheet-color);
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

	.status-pill[data-status='done'] {
		background: color-mix(in srgb, #16a34a 16%, transparent);
		color: color-mix(in srgb, #166534 90%, black 6%);
	}

	.status-pill[data-status='executing'] {
		background: color-mix(in srgb, #0ea5e9 16%, transparent);
		color: color-mix(in srgb, #075985 90%, black 6%);
	}

	.status-pill[data-status='failed'] {
		background: color-mix(in srgb, var(--destructive) 14%, transparent);
		color: color-mix(in srgb, var(--destructive) 82%, black 8%);
	}

	.sheet-preview__summary {
		font-size: 0.92rem;
	}

	.sheet-preview__error {
		margin: 0;
		color: var(--destructive);
	}

	.sheet-preview__stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
		padding-top: 0.2rem;
	}

	.sheet-preview__stats span {
		display: block;
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: color-mix(in srgb, var(--foreground) 58%, transparent);
	}

	.sheet-preview__stats p {
		margin: 0.2rem 0 0;
		font-size: 1rem;
		font-weight: 700;
	}

	.sheet-preview__footer {
		display: flex;
		justify-content: space-between;
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

		.sheet-preview__header-row,
		.sheet-preview__footer {
			flex-direction: column;
		}
	}
</style>
