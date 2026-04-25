<script lang="ts">
	import { goto } from '$app/navigation';
	import { Sheet as PaperSheet } from '@ljoukov/sheet';
	import type { PaperSheetAnswers } from '@spark/schemas';
	import type { PageData } from './$types';

	type Diagnostic = PageData['diagnostic'];
	type DiagnosticSheet = Diagnostic['sheets'][number];
	type DiagnosticAnswers = {
		mcq: Record<string, string>;
		fill: Record<string, string>;
		extension: Record<string, string>;
	};

	let { data }: { data: PageData } = $props();
	let answers = $state<PaperSheetAnswers>({});
	let submitting = $state(false);
	let requestError = $state<string | null>(null);

	const diagnostic = $derived(data.diagnostic);
	const activeSheet = $derived.by(() => {
		return (
			diagnostic.sheets.find((sheet) => sheet.index === data.activeSheetIndex) ??
			diagnostic.sheets.find((sheet) => sheet.index === diagnostic.currentSheetIndex) ??
			null
		);
	});
	const missingCount = $derived(activeSheet ? countMissingAnswers(activeSheet, answers) : 0);
	const gradeLabel = $derived(activeSheet?.index === 3 ? 'Submit' : 'Next');
	const footerLabel = $derived(
		`${diagnostic.topicLabel} · ${diagnostic.schoolYear} · Sheet ${data.activeSheetIndex.toString()} of 3`
	);

	function resolveMcqLabel(sheet: DiagnosticSheet, questionId: string, raw: unknown): string {
		if (typeof raw !== 'string') {
			return '';
		}
		const question = sheet.questions.mcq.find((entry) => entry.id === questionId);
		if (!question) {
			return '';
		}
		for (const option of question.options) {
			if (raw === `${question.id}-${option.label.toLowerCase()}`) {
				return option.label;
			}
		}
		return '';
	}

	function resolveFillAnswer(raw: unknown): string {
		if (!raw || typeof raw !== 'object') {
			return '';
		}
		const value = (raw as Record<string, unknown>)['0'];
		return typeof value === 'string' ? value : '';
	}

	function resolveExtensionAnswer(raw: unknown): string {
		return typeof raw === 'string' ? raw : '';
	}

	function toDiagnosticAnswers(sheet: DiagnosticSheet, paperAnswers: PaperSheetAnswers): DiagnosticAnswers {
		const next: DiagnosticAnswers = { mcq: {}, fill: {}, extension: {} };
		for (const question of sheet.questions.mcq) {
			next.mcq[question.id] = resolveMcqLabel(sheet, question.id, paperAnswers[question.id]);
		}
		for (const question of sheet.questions.fill) {
			next.fill[question.id] = resolveFillAnswer(paperAnswers[question.id]);
		}
		for (const question of sheet.questions.extension) {
			next.extension[question.id] = resolveExtensionAnswer(paperAnswers[question.id]);
		}
		return next;
	}

	function countMissingAnswers(sheet: DiagnosticSheet, paperAnswers: PaperSheetAnswers): number {
		const resolved = toDiagnosticAnswers(sheet, paperAnswers);
		let count = 0;
		for (const question of sheet.questions.mcq) {
			if (!resolved.mcq[question.id]) {
				count += 1;
			}
		}
		for (const question of sheet.questions.fill) {
			if (!resolved.fill[question.id]?.trim()) {
				count += 1;
			}
		}
		for (const question of sheet.questions.extension) {
			if (!resolved.extension[question.id]?.trim()) {
				count += 1;
			}
		}
		return count;
	}

	async function submitCurrentSheet(nextAnswers: PaperSheetAnswers): Promise<boolean> {
		if (!activeSheet || submitting) {
			return false;
		}
		answers = nextAnswers;
		const unresolved = countMissingAnswers(activeSheet, nextAnswers);
		if (unresolved > 0) {
			requestError = `Answer ${unresolved.toString()} more question${unresolved === 1 ? '' : 's'} before continuing.`;
			return false;
		}

		submitting = true;
		requestError = null;
		try {
			const response = await fetch(`/api/spark/diagnostic/${encodeURIComponent(diagnostic.id)}/next`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sheetIndex: activeSheet.index,
					answers: toDiagnosticAnswers(activeSheet, nextAnswers)
				})
			});
			const payload = (await response.json().catch(() => null)) as {
				diagnostic?: Diagnostic;
				error?: string;
			} | null;
			if (!response.ok || !payload?.diagnostic) {
				throw new Error(payload?.error ?? 'diagnostic_submit_failed');
			}
			await goto('/spark/diagnostic');
			return true;
		} catch (error) {
			console.error('[diagnostic] submit request failed', error);
			requestError = 'Spark could not grade this sheet. Try again.';
			return false;
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Spark · Diagnostic sheet {data.activeSheetIndex}</title>
</svelte:head>

<section class="sheet-page diagnostic-sheet-page">
	<div class="sheet-toolbar">
		<div>
			<p class="sheet-toolbar__eyebrow">Diagnostic sheet</p>
			<p class="sheet-toolbar__title">
				{diagnostic.topicLabel} · {diagnostic.schoolYear} · Sheet {data.activeSheetIndex} of 3
			</p>
		</div>
		{#if submitting}
			<p class="status-note" role="status">Running diagnostic agent…</p>
		{:else if missingCount > 0}
			<p class="status-note">{missingCount} unanswered</p>
		{:else}
			<p class="status-note">Ready</p>
		{/if}
	</div>

	{#if requestError}
		<p class="action-error" role="alert">{requestError}</p>
	{/if}

	<div class="sheet-shell">
		<PaperSheet
			document={data.sheetDocument}
			{answers}
			mode="interactive"
			grading={submitting}
			gradeLabel={gradeLabel}
			footerLabel={footerLabel}
			onAnswersChange={(nextAnswers) => {
				answers = nextAnswers;
				requestError = null;
			}}
			onGrade={(nextAnswers) => submitCurrentSheet(nextAnswers)}
		/>
	</div>
</section>

<style lang="postcss">
	.sheet-page {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: min(100%, 1024px);
		max-width: 1024px;
		margin: 0 auto;
	}

	.action-error {
		margin: 0;
		color: var(--destructive);
		font-weight: 700;
	}

	.sheet-toolbar {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		padding: 0 0.9rem;
		color: var(--foreground);
	}

	.sheet-toolbar__eyebrow {
		margin: 0 0 0.12rem;
		color: color-mix(in srgb, var(--foreground) 54%, transparent);
		font-size: 0.76rem;
		font-weight: 760;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.sheet-toolbar__title {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 760;
	}

	.status-note {
		margin: 0;
		color: color-mix(in srgb, var(--foreground) 72%, transparent);
		font-weight: 650;
		white-space: nowrap;
	}

	.sheet-shell {
		overflow: auto;
		padding-bottom: 0.2rem;
	}

	:global([data-theme='dark'] .sheet-shell .paper-sheet__header),
	:global(:root:not([data-theme='light']) .sheet-shell .paper-sheet__header) {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--sheet-color, #1f7a4d) 66%, #17142a) 0%,
			color-mix(in srgb, var(--sheet-color, #1f7a4d) 48%, #17142a) 100%
		);
	}

	:global([data-theme='dark'] .sheet-shell .paper-sheet__header-orb),
	:global(:root:not([data-theme='light']) .sheet-shell .paper-sheet__header-orb) {
		background: rgba(255, 255, 255, 0.045);
	}

	:global([data-theme='dark'] .sheet-shell .paper-sheet__header-orb--small),
	:global(:root:not([data-theme='light']) .sheet-shell .paper-sheet__header-orb--small) {
		background: rgba(255, 255, 255, 0.035);
	}

	.sheet-shell :global(.paper-sheet__section-id),
	.sheet-shell :global(.paper-sheet__eyebrow),
	.sheet-shell :global(.paper-sheet__section-marks),
	.sheet-shell :global(.composer-leading:has(.composer-attach)),
	.sheet-shell :global(.composer-attach) {
		display: none;
	}

	.sheet-shell :global(.paper-sheet__footer) {
		justify-content: flex-end;
	}

	.sheet-shell :global(.paper-sheet__footer > span:first-child) {
		display: none;
	}

	:global(.app-shell:has(.diagnostic-sheet-page) .sheet-close-button) {
		right: max(calc((100vw - 1024px) / 2 + 0.75rem), 1rem);
	}

	@media (max-width: 640px) {
		.sheet-toolbar {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.35rem;
			padding: 0 0.75rem;
		}

		.status-note {
			white-space: normal;
		}
	}
</style>
