<script lang="ts">
	import { page } from '$app/stores';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import {
		sparkDetectionPreview,
		sparkUploadsStore,
		sparkUser as sparkUserStore
	} from '$lib/mock/spark-data';
	import { sparkCreateDialogOpen } from '$lib/stores/spark-ui';
	import { derived } from 'svelte/store';
	import { onDestroy } from 'svelte';

	let { children } = $props();

	let createOpen = $state(false);
	const unsubscribeCreate = sparkCreateDialogOpen.subscribe((value) => {
		if (createOpen !== value) {
			createOpen = value;
		}
	});

	onDestroy(() => {
		unsubscribeCreate();
	});

	$effect(() => {
		sparkCreateDialogOpen.set(createOpen);
	});

	$effect(() => {
		if (!createOpen) {
			return;
		}
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				createOpen = false;
			}
		};
		window.addEventListener('keydown', handleKey);
		return () => {
			window.removeEventListener('keydown', handleKey);
		};
	});

	const navLinks = [
		{ href: '/spark/home', label: 'Home' },
		{ href: '/spark/library', label: 'Library' },
		{ href: '/spark/progress', label: 'Progress' }
	];

	const latestUploadTitle = derived(
		sparkUploadsStore,
		($uploads) => $uploads[0]?.title ?? 'Add notes to start'
	);
	const createSources = [
		{ id: 'camera', label: 'Camera', description: 'Snap live pages into Spark.' },
		{ id: 'photo', label: 'Photo (image)', description: 'Import from your photo roll.' },
		{ id: 'file', label: 'File (PDF)', description: 'Drop classroom packs and worksheets.' },
		{ id: 'paste', label: 'Paste text', description: 'Copy quick facts straight into practice.' }
	];

	const hiddenFabRoutes = new Set([
		'/spark/setup',
		'/spark/quiz',
		'/spark/results',
		'/spark/settings'
	]);

	const pathname = derived(page, ($page) => $page.url.pathname);
	const showCreateFab = derived(pathname, ($pathname) => !hiddenFabRoutes.has($pathname));
</script>

<svelte:head>
	<title>Spark</title>
</svelte:head>

<div class="spark-shell">
	<header class="spark-nav">
		<div class="spark-nav__left">
			<a href="/spark/home" class="spark-brand" aria-label="Spark home">
				<div class="spark-brand__mark" aria-hidden="true">⚡️</div>
				<div class="spark-brand__text">
					<span class="spark-brand__name">Spark</span>
					<span class="spark-brand__tag">Scan. Practice. GCSE Science.</span>
				</div>
			</a>
			<nav class="spark-nav__links" aria-label="Primary">
				{#each navLinks as link}
					{@const active = $pathname.startsWith(link.href)}
					<a href={link.href} class={`spark-nav__link ${active ? 'spark-nav__link--active' : ''}`}>
						{link.label}
					</a>
				{/each}
			</nav>
		</div>

		<div class="spark-nav__right">
			<div class="spark-nav__latest">
				<span class="spark-nav__latest-label">Latest</span>
				<span class="spark-nav__latest-title">{$latestUploadTitle}</span>
			</div>
			<a href="/spark/settings" class="spark-avatar" aria-label="Open settings">
				<img src={$sparkUserStore.avatar} alt={$sparkUserStore.name} />
			</a>
		</div>
	</header>

	<main class="spark-main">
		{@render children?.()}
	</main>

	{#if $showCreateFab}
		<button
			class="spark-create-fab"
			type="button"
			onclick={() => (createOpen = true)}
			aria-label="Create"
		>
			<span>Create</span>
		</button>
	{/if}

	{#if createOpen}
		<div class="spark-create-overlay" role="dialog" aria-modal="true">
			<div class="spark-create-dialog">
				<button
					class="spark-create-dialog__close"
					type="button"
					onclick={() => (createOpen = false)}
					aria-label="Close create dialog"
				>
					×
				</button>
				<header class="spark-create-dialog__header">
					<h2>Create practice</h2>
					<p>Choose a source to build a new bundle. Spark analyses everything instantly.</p>
				</header>
				<div class="spark-create-dialog__grid">
					{#each createSources as option}
						<button
							type="button"
							class="spark-create-dialog__option"
							onclick={() => (createOpen = false)}
						>
							<span class="spark-create-dialog__option-icon">•</span>
							<div>
								<p>{option.label}</p>
								<span>{option.description}</span>
							</div>
						</button>
					{/each}
				</div>
				<div class="spark-create-dialog__summary">
					<h3>Detection summary</h3>
					<p>
						{$sparkDetectionPreview.source} • {$sparkDetectionPreview.pages} pages • ~{$sparkDetectionPreview.estimatedItems}
						items
					</p>
					<ul>
						{#each $sparkDetectionPreview.preview as line}
							<li>{line}</li>
						{/each}
					</ul>
					<a
						href="/spark/setup"
						class={cn(buttonVariants({ size: 'lg' }), 'spark-create-dialog__cta')}
						onclick={() => (createOpen = false)}
					>
						Go to setup
					</a>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.spark-shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.spark-nav {
		position: sticky;
		top: 0;
		z-index: 50;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: clamp(1rem, 4vw, 1.5rem) clamp(1rem, 6vw, 3rem);
		backdrop-filter: blur(12px);
		background: color-mix(in srgb, var(--background) 72%, transparent 28%);
		border-bottom: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
	}

	.spark-nav__left {
		display: flex;
		align-items: center;
		gap: clamp(1rem, 4vw, 2.5rem);
	}

	.spark-brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		text-decoration: none;
	}

	.spark-brand__mark {
		width: 2.75rem;
		height: 2.75rem;
		display: grid;
		place-items: center;
		border-radius: 1rem;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.55), rgba(109, 40, 217, 0.55));
		box-shadow: 0 12px 24px -16px rgba(15, 23, 42, 0.5);
		font-size: 1.25rem;
	}

	.spark-brand__text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.spark-brand__name {
		font-size: 1.375rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.spark-brand__tag {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: color-mix(in srgb, var(--text-secondary) 90%, transparent 10%);
	}

	.spark-nav__links {
		display: flex;
		gap: 1rem;
		font-size: 0.95rem;
		font-weight: 500;
	}

	.spark-nav__link {
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
		padding: 0.5rem 0.75rem;
		border-radius: 999px;
		text-decoration: none;
		transition:
			background 150ms ease,
			color 150ms ease,
			box-shadow 150ms ease;
	}

	.spark-nav__link:hover {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--accent) 45%, transparent 55%);
		box-shadow: 0 12px 18px -18px var(--shadow-color);
	}

	.spark-nav__link--active {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--accent) 60%, transparent 40%);
		box-shadow: 0 12px 28px -14px var(--shadow-color);
	}

	.spark-nav__right {
		display: flex;
		align-items: center;
		gap: clamp(0.75rem, 2vw, 1.5rem);
	}

	.spark-nav__latest {
		display: flex;
		flex-direction: column;
		text-align: right;
	}

	.spark-nav__latest-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: color-mix(in srgb, var(--text-secondary) 70%, transparent 30%);
	}

	.spark-nav__latest-title {
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.spark-avatar {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 999px;
		position: relative;
		overflow: hidden;
		box-shadow: 0 12px 28px -16px rgba(15, 23, 42, 0.38);
		outline: 2px solid transparent;
		outline-offset: 2px;
		transition:
			outline-color 200ms ease,
			transform 200ms ease;
	}

	.spark-avatar:hover {
		transform: translateY(-2px);
		outline-color: color-mix(in srgb, var(--accent) 80%, transparent 20%);
	}

	.spark-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.spark-main {
		flex: 1;
		padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 6vw, 3rem) clamp(4rem, 8vw, 5rem);
	}

	.spark-create-fab {
		position: fixed;
		right: clamp(1.5rem, 5vw, 3rem);
		bottom: clamp(1.5rem, 4vw, 3rem);
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(14, 165, 233, 0.95));
		color: white;
		padding: 0 2rem;
		height: 3.25rem;
		border-radius: 999px;
		font-weight: 600;
		font-size: 1rem;
		display: inline-flex;
		align-items: center;
		box-shadow: 0 18px 32px -20px rgba(15, 23, 42, 0.7);
		cursor: pointer;
	}

	.spark-create-overlay {
		position: fixed;
		inset: 0;
		z-index: 70;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(1.5rem, 4vw, 3rem);
		background: color-mix(in srgb, var(--background) 70%, transparent 30%);
		backdrop-filter: blur(18px);
	}

	.spark-create-dialog {
		width: min(720px, calc(100vw - 3rem));
		background: color-mix(in srgb, var(--surface-color) 95%, transparent 5%);
		backdrop-filter: blur(18px);
		border: 1px solid color-mix(in srgb, var(--surface-border) 75%, transparent 25%);
		border-radius: 1.25rem;
		padding: clamp(1.75rem, 4vw, 2.5rem);
		box-shadow: 0 36px 80px -40px var(--shadow-color);
		position: relative;
	}

	.spark-create-dialog__close {
		position: absolute;
		top: 1rem;
		right: 1rem;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		background: color-mix(in srgb, var(--surface-color) 92%, transparent 8%);
		font-size: 1.4rem;
		line-height: 1;
		cursor: pointer;
	}

	.spark-create-dialog__close:hover {
		background: color-mix(in srgb, var(--accent) 24%, transparent 76%);
	}

	.spark-create-dialog__header {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.spark-create-dialog__header h2 {
		font-size: 1.35rem;
		font-weight: 600;
	}

	.spark-create-dialog__header p {
		font-size: 0.95rem;
		color: color-mix(in srgb, var(--text-secondary) 82%, transparent 18%);
	}

	.spark-create-dialog__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 1rem;
	}

	.spark-create-dialog__option {
		background: color-mix(in srgb, var(--accent) 18%, transparent 82%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 80%, transparent 20%);
		border-radius: 1rem;
		padding: 1rem;
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		color: inherit;
		text-align: left;
		transition:
			transform 160ms ease,
			box-shadow 180ms ease,
			border 160ms ease;
	}

	.spark-create-dialog__option:hover {
		transform: translateY(-4px);
		box-shadow: 0 20px 40px -30px var(--shadow-color);
		border-color: color-mix(in srgb, var(--accent) 65%, transparent 35%);
	}

	.spark-create-dialog__option-icon {
		width: 0.6rem;
		height: 0.6rem;
		margin-top: 0.35rem;
		border-radius: 999px;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(56, 189, 248, 0.9));
	}

	.spark-create-dialog__option p {
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.spark-create-dialog__option span {
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--text-secondary) 85%, transparent 15%);
	}

	.spark-create-dialog__summary {
		margin-top: 2rem;
		padding: 1.5rem;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--accent) 22%, transparent 78%);
		display: grid;
		gap: 0.75rem;
	}

	.spark-create-dialog__summary h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.spark-create-dialog__summary p {
		font-size: 0.9rem;
		color: color-mix(in srgb, var(--text-secondary) 85%, transparent 15%);
	}

	.spark-create-dialog__summary ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.spark-create-dialog__summary li {
		padding: 0.5rem 0.75rem;
		background: color-mix(in srgb, var(--surface-color) 90%, transparent 10%);
		border-radius: 0.75rem;
		font-size: 0.85rem;
	}

	.spark-create-dialog__cta {
		justify-self: flex-start;
	}

	@media (max-width: 960px) {
		.spark-nav {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.spark-nav__left {
			flex-direction: column;
			align-items: flex-start;
		}

		.spark-nav__links {
			order: 2;
			gap: 0.75rem;
		}

		.spark-nav__right {
			align-self: stretch;
			justify-content: space-between;
		}

		.spark-nav__latest {
			order: 2;
		}
	}

	@media (max-width: 720px) {
		.spark-main {
			padding: 1.5rem 1rem 5rem;
		}

		.spark-create-fab {
			width: calc(100% - 2rem);
			right: 1rem;
			bottom: 1rem;
			justify-content: center;
		}
	}
</style>
