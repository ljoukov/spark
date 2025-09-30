<script lang="ts">
	import { page } from '$app/stores';
	import Button from '$lib/components/ui/button/button.svelte';
	import { sparkUploadsStore } from '$lib/mock/spark-data';

	const sizes = [10, 25, 40, 60];
	let selectedSize = 25;
	let timerEnabled = true;
	let scope: 'This upload' | 'Cross-doc' = 'This upload';
	let lastSearchKey: string | null = null;

	$: searchParams = $page.url.searchParams;
	$: currentSearchKey = $page.url.search;
	$: {
		if (currentSearchKey !== lastSearchKey) {
			const sizeParam = searchParams.get('size');
			selectedSize = sizeParam ? Number(sizeParam) : 25;
			timerEnabled = searchParams.get('timer') !== 'off';
			const scopeParam = searchParams.get('scope');
			scope = scopeParam === 'Cross-doc' ? 'Cross-doc' : 'This upload';
			lastSearchKey = currentSearchKey;
		}
	}

	$: selectedUpload =
		$sparkUploadsStore.find((upload) => upload.id === searchParams.get('upload')) ?? $sparkUploadsStore[0];
	$: selectedSubject = searchParams.get('subject') ?? selectedUpload?.subject ?? 'Chemistry';
</script>

<section class="spark-setup">
	<div class="spark-setup__context">
		<h1>Session setup</h1>
		<p>Tailor question volume, pacing, and scope before you dive in.</p>

		{#if selectedUpload}
			<div class="spark-setup__upload" style={`--spark-setup-gradient: ${selectedUpload.color};`}>
				<span>{selectedUpload.subject}</span>
				<h2>{selectedUpload.title}</h2>
				<p>{selectedUpload.specCodes}</p>
				<ul>
					<li>{selectedUpload.items} items available</li>
					<li>Last used {selectedUpload.lastUsed}</li>
				</ul>
			</div>
		{/if}
	</div>

	<div class="spark-setup__panel">
		<form class="spark-setup__form">
			<fieldset>
				<legend>Size</legend>
				<div class="spark-setup__choices">
					{#each sizes as size}
						<button
							type="button"
							class={`spark-setup__chip ${selectedSize === size ? 'is-active' : ''}`}
							onclick={() => (selectedSize = size)}
						>
							{size}
						</button>
					{/each}
				</div>
				<p class="spark-setup__hint">Pick how many questions to run this session.</p>
			</fieldset>

			<fieldset>
				<legend>Timer</legend>
				<div class="spark-setup__choices spark-setup__choices--toggle">
				<button
					type="button"
					class={`spark-setup__chip ${timerEnabled ? 'is-active' : ''}`}
					onclick={() => (timerEnabled = true)}
				>
						On
					</button>
				<button
					type="button"
					class={`spark-setup__chip ${!timerEnabled ? 'is-active' : ''}`}
					onclick={() => (timerEnabled = false)}
				>
						Off
					</button>
				</div>
				<p class="spark-setup__hint">Keep pace with past papers using timed mode.</p>
			</fieldset>

			<fieldset>
				<legend>Scope</legend>
				<div class="spark-setup__choices">
				<button
					type="button"
					class={`spark-setup__chip ${scope === 'This upload' ? 'is-active' : ''}`}
					onclick={() => (scope = 'This upload')}
				>
						This upload
					</button>
				<button
					type="button"
					class={`spark-setup__chip ${scope === 'Cross-doc' ? 'is-active' : ''}`}
					onclick={() => (scope = 'Cross-doc')}
				>
						Cross-doc
					</button>
				</div>
				<p class="spark-setup__hint">Blend with similar uploads for a richer mix.</p>
			</fieldset>
		</form>

		<div class="spark-setup__summary">
			<div>
				<h3>Session summary</h3>
				<ul>
					<li>{selectedSize} questions</li>
					<li>{timerEnabled ? 'Timer enabled' : 'Timer disabled'}</li>
					<li>{scope}</li>
					<li>Subject focus: {selectedSubject}</li>
				</ul>
			</div>
			<Button href="/spark/quiz" size="lg">Start</Button>
		</div>
	</div>
</section>

<style>
	.spark-setup {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: clamp(1.5rem, 5vw, 3rem);
	}

	.spark-setup__context {
		display: grid;
		gap: 1.25rem;
	}

	.spark-setup__context h1 {
		font-size: clamp(1.8rem, 4vw, 2.2rem);
		font-weight: 600;
	}

	.spark-setup__context p {
		font-size: 0.95rem;
		color: color-mix(in srgb, var(--text-secondary) 82%, transparent 18%);
	}

	.spark-setup__upload {
		padding: clamp(1.5rem, 4vw, 2rem);
		border-radius: 1.75rem;
		background: linear-gradient(135deg, var(--spark-setup-gradient));
		color: white;
		display: grid;
		gap: 0.75rem;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 34px 64px -48px rgba(15, 23, 42, 0.8);
	}

	.spark-setup__upload span {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: rgba(255, 255, 255, 0.18);
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
	}

	.spark-setup__upload h2 {
		font-size: 1.3rem;
		font-weight: 600;
	}

	.spark-setup__upload p {
		margin: 0;
		color: rgba(255, 255, 255, 0.82);
	}

	.spark-setup__upload ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.85);
	}

	.spark-setup__panel {
		position: relative;
		background: color-mix(in srgb, var(--surface-color) 96%, transparent 4%);
		border-radius: clamp(1.5rem, 5vw, 2rem);
		border: 1px solid color-mix(in srgb, var(--surface-border) 75%, transparent 25%);
		padding: clamp(1.5rem, 4vw, 2.5rem);
		box-shadow: 0 36px 72px -48px var(--shadow-color);
	}

	.spark-setup__form {
		display: grid;
		gap: 1.5rem;
	}

	fieldset {
		border: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	legend {
		font-size: 0.95rem;
		font-weight: 600;
	}

	.spark-setup__choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.spark-setup__choices--toggle {
		gap: 0.5rem;
	}

	.spark-setup__chip {
		min-width: 3.5rem;
		padding: 0.65rem 1.1rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		background: color-mix(in srgb, var(--surface-color) 92%, transparent 8%);
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		transition: background 160ms ease, border 160ms ease, transform 160ms ease;
	}

	.spark-setup__chip.is-active {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.85), rgba(14, 165, 233, 0.85));
		color: white;
		border-color: rgba(59, 130, 246, 0.45);
		box-shadow: 0 18px 32px -24px rgba(15, 23, 42, 0.7);
	}

	.spark-setup__chip:hover:not(.is-active) {
		transform: translateY(-2px);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent 60%);
	}

	.spark-setup__hint {
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	.spark-setup__summary {
		margin-top: 2rem;
		padding-top: 2rem;
		border-top: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.spark-setup__summary ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.9rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	@media (max-width: 900px) {
		.spark-setup {
			grid-template-columns: 1fr;
		}

		.spark-setup__panel {
			order: -1;
		}

		.spark-setup__summary {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	@media (max-width: 640px) {
		.spark-setup__panel {
			border-radius: 0;
			margin: -1.5rem -1rem;
			padding: 1.75rem 1.5rem 4rem;
			border-left: none;
			border-right: none;
		}

		.spark-setup__summary {
			align-items: stretch;
		}

	:global(.spark-setup__summary [data-slot='button']) {
		width: 100%;
	}
	}
</style>
