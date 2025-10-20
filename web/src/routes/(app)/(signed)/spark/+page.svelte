<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import type { PageData } from './$types';

	type UserSnapshot = { name?: string | null; email?: string | null } | null;

	type UserStore = {
		subscribe: (run: (value: UserSnapshot) => void) => () => void;
	};

	let { data }: { data: PageData } = $props();

const userStore = getContext<UserStore | undefined>('spark:user');

	function deriveGreeting(source: UserSnapshot, fallback = 'Spark friend'): string {
		const name = source?.name?.trim();
		if (name && name.length > 0) {
			return name.split(/\s+/)[0] ?? fallback;
		}
		const handle = source?.email?.split('@')[0]?.trim();
		if (handle && handle.length > 0) {
			return handle.split(/\s+/)[0] ?? fallback;
		}
		return fallback;
	}

	let firstName = $state(deriveGreeting(data.user ?? null));

	let unsubscribe: (() => void) | null = null;
	if (userStore) {
		unsubscribe = userStore.subscribe((value) => {
			firstName = deriveGreeting(value, firstName);
		});
	}

	onDestroy(() => {
		unsubscribe?.();
	});
</script>

<svelte:head>
	<title>Spark · Home</title>
</svelte:head>

<section class="spark-welcome">
	<div class="spark-card">
		<p class="spark-eyebrow">Welcome back</p>
		<h1 class="spark-title">
			Hi {firstName}!
			<picture class="spark-comet" aria-hidden="true">
				<source
					srcset="https://fonts.gstatic.com/s/e/notoemoji/latest/2604_fe0f/512.webp"
					type="image/webp"
				/>
				<img
					src="https://fonts.gstatic.com/s/e/notoemoji/latest/2604_fe0f/512.gif"
					alt=""
					width="64"
					height="64"
				/>
			</picture>
		</h1>
		<p class="spark-copy">
			This is your Spark hub. Pick any experience from the navigation above to get started.
		</p>
	</div>
</section>

<style>
	.spark-welcome {
		width: min(110rem, 96vw);
		margin: 0 auto;
		padding-top: clamp(2rem, 4vw, 3rem);
		padding-bottom: clamp(2rem, 4vw, 3rem);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.spark-card {
		display: flex;
		flex-direction: column;
		gap: clamp(1rem, 2vw, 1.5rem);
		padding: clamp(2rem, 3vw, 2.75rem);
		border-radius: clamp(1.8rem, 2.4vw, 2.4rem);
		background: color-mix(in srgb, var(--app-content-bg) 32%, transparent);
		border: 1px solid rgba(148, 163, 184, 0.25);
		box-shadow: 0 28px 80px -50px rgba(15, 23, 42, 0.4);
		backdrop-filter: saturate(140%) blur(18px);
		max-width: clamp(32rem, 50vw, 48rem);
		text-align: center;
	}

	:global([data-theme='dark'] .spark-card),
	:global(:root:not([data-theme='light']) .spark-card) {
		background: rgba(6, 11, 25, 0.6);
		border-color: rgba(148, 163, 184, 0.3);
	}

	.spark-eyebrow {
		margin: 0;
		font-size: 0.85rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(59, 130, 246, 0.82);
		font-weight: 600;
	}

	.spark-title {
		margin: 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.9rem;
		font-size: clamp(2rem, 3.4vw, 2.8rem);
		font-weight: 650;
		line-height: 1.05;
		color: var(--text-primary, var(--foreground));
	}

	.spark-comet {
		display: inline-flex;
		align-items: center;
	}

	.spark-comet img {
		display: block;
	}

	.spark-copy {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.6;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
	}

	:global([data-theme='dark'] .spark-copy),
	:global(:root:not([data-theme='light']) .spark-copy) {
		color: rgba(203, 213, 225, 0.82);
	}
</style>
