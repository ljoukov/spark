<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import type { PageData, ActionData } from './$types';

	type UserSnapshot = { name?: string | null; email?: string | null } | null;

	type UserStore = {
		subscribe: (run: (value: UserSnapshot) => void) => () => void;
	};

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	const options = data.welcomeOptions ?? [];

	function resolveFirst(source: UserSnapshot, fallback = 'friend'): string {
		const name = source?.name?.trim();
		const emailHandle = source?.email?.split('@')[0]?.trim();
		const base =
			name && name.length > 0
				? name
				: emailHandle && emailHandle.length > 0
					? emailHandle
					: fallback;
		return base.split(/\s+/)[0] || fallback;
	}

	const userStore = getContext<UserStore | undefined>('spark-code:user');

	let firstName = $state(resolveFirst({ name: data.userName ?? null }, 'friend'));

	let unsubscribe: (() => void) | null = null;
	if (userStore) {
		unsubscribe = userStore.subscribe((value) => {
			firstName = resolveFirst(value, firstName);
		});
	}

	onDestroy(() => {
		unsubscribe?.();
	});
</script>

<svelte:head>
	<title>Spark Code · Choose your starter session</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap"
	/>
</svelte:head>

<section class="welcome-dashboard">
	<div class="welcome-panel">
		<p class="plan-eyebrow">Let's go</p>
		<h1 class="welcome-title">
			Welcome {firstName}!
			<picture class="hero-rocket" aria-hidden="true">
				<source
					srcset="https://fonts.gstatic.com/s/e/notoemoji/latest/1f680/512.webp"
					type="image/webp"
				/>
				<img
					src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f680/512.gif"
					alt=""
					width="64"
					height="64"
				/>
			</picture>
		</h1>
		<p class="welcome-subtitle">
			Ignite your coding journey with a session tailored for curious first-timers.
		</p>

		{#if form?.error}
			<p class="error-banner">{form.error}</p>
		{/if}

		<div class="welcome-cards">
			{#if options.length === 0}
				<p class="empty-copy">
					No starter sessions are available right now. Please try again soon.
				</p>
			{:else}
				{#each options as option}
					<form method="POST" action="?/start" class="welcome-card-form">
						<input type="hidden" name="topic" value={option.key} />
						<button type="submit" class="welcome-card-button" aria-label={`Launch ${option.title}`}>
							<div class="topic-poster" aria-hidden="true">
								{#if option.posterImageUrl}
									<img src={option.posterImageUrl} alt="" loading="lazy" />
								{:else}
									<span class="topic-emoji" aria-hidden="true">{option.emoji}</span>
								{/if}
							</div>
							<div class="topic-content">
								<p class="topic-tagline">{option.tagline}</p>
							</div>
							<span class="launch-pill">Launch</span>
						</button>
					</form>
				{/each}
			{/if}
		</div>
	</div>
</section>

<style lang="postcss">
	.welcome-dashboard {
		width: min(110rem, 96vw);
		margin: 0 auto clamp(2rem, 4vw, 3rem);
		padding-top: clamp(1.5rem, 3vw, 2.4rem);
		padding-bottom: clamp(1.5rem, 3vw, 2.4rem);
	}

	.welcome-panel {
		text-align: center;
		--panel-bg: color-mix(in srgb, var(--app-content-bg) 25%, transparent);
		display: flex;
		flex-direction: column;
		gap: clamp(1.4rem, 2vw, 1.8rem);
		padding: clamp(1.8rem, 2.4vw, 2.4rem);
		border-radius: clamp(1.8rem, 2.4vw, 2.4rem);
		background: var(--panel-bg);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 28px 80px -50px rgba(15, 23, 42, 0.42);
		backdrop-filter: saturate(140%) blur(18px);
		width: 100%;
	}

	:global([data-theme='dark'] .welcome-panel),
	:global(:root:not([data-theme='light']) .welcome-panel) {
		--panel-bg: rgba(6, 11, 25, 0.6);
		background: var(--panel-bg);
		border-color: rgba(148, 163, 184, 0.3);
	}

	.plan-eyebrow {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(59, 130, 246, 0.82);
		font-weight: 600;
		align-self: flex-start;
		text-align: left;
	}

	.welcome-title {
		margin: 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 0.9rem;
		font-size: clamp(2rem, 3.4vw, 2.6rem);
		line-height: 1.05;
		font-weight: 650;
	}

	.hero-rocket {
		display: inline-flex;
		align-items: center;
	}

	.hero-rocket img {
		display: block;
	}

	.welcome-subtitle {
		margin: 0 auto;
		font-size: 1.05rem;
		line-height: 1.6;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
	}

	:global([data-theme='dark'] .welcome-subtitle),
	:global(:root:not([data-theme='light']) .welcome-subtitle) {
		color: rgba(203, 213, 225, 0.82);
	}

	.error-banner {
		margin: 0;
		border-radius: 0.85rem;
		padding: 0.75rem 1rem;
		border: 1px solid rgba(239, 68, 68, 0.38);
		background: rgba(248, 113, 113, 0.14);
		color: #b91c1c;
		font-size: 0.9rem;
	}

	:global([data-theme='dark'] .error-banner),
	:global(:root:not([data-theme='light']) .error-banner) {
		background: rgba(248, 113, 113, 0.18);
		color: rgba(254, 226, 226, 0.9);
	}

	.welcome-cards {
		display: flex;
		flex-wrap: wrap;
		gap: clamp(1rem, 1.8vw, 1.5rem);
		justify-content: center;
	}

	.welcome-card-form {
		height: 100%;
		flex: 1 1 27rem;
		max-width: min(27rem, 100%);
		width: 100%;
	}

	.welcome-card-button {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: space-between;
		gap: clamp(1.1rem, 1.8vw, 1.6rem);
		width: 100%;
		height: 100%;
		padding: 0;
		padding-bottom: clamp(1.4rem, 2vw, 1.8rem);
		border-radius: 1.5rem;
		border: 1px solid rgba(148, 163, 184, 0.24);
		background: rgba(248, 250, 252, 0.85);
		box-shadow: 0 24px 60px -48px rgba(15, 23, 42, 0.45);
		cursor: pointer;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			border-color 0.2s ease,
			background 0.2s ease;
		overflow: hidden;
	}

	:global([data-theme='dark'] .welcome-card-button),
	:global(:root:not([data-theme='light']) .welcome-card-button) {
		background: rgba(15, 23, 42, 0.72);
		border-color: rgba(148, 163, 184, 0.3);
		box-shadow: 0 28px 70px -45px rgba(37, 99, 235, 0.32);
	}

	.welcome-card-button:hover,
	.welcome-card-button:focus-visible {
		transform: translateY(-6px);
		border-color: rgba(96, 165, 250, 0.65);
		box-shadow: 0 32px 80px -45px rgba(96, 165, 250, 0.42);
		background: rgba(255, 255, 255, 0.95);
		outline: none;
	}

	:global([data-theme='dark'] .welcome-card-button:hover),
	:global(:root:not([data-theme='light']) .welcome-card-button:hover),
	:global([data-theme='dark'] .welcome-card-button:focus-visible),
	:global(:root:not([data-theme='light']) .welcome-card-button:focus-visible) {
		background: rgba(17, 24, 39, 0.92);
		border-color: rgba(125, 211, 252, 0.55);
		box-shadow: 0 32px 80px -45px rgba(125, 211, 252, 0.35);
	}

	.welcome-card-button:focus-visible {
		outline: 2px solid rgba(96, 165, 250, 0.65);
		outline-offset: 4px;
	}

	.topic-poster {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: rgba(148, 163, 184, 0.18);
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.18);
	}

	:global([data-theme='dark'] .topic-poster),
	:global(:root:not([data-theme='light']) .topic-poster) {
		background: rgba(30, 41, 59, 0.36);
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.22);
	}

	.topic-poster img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.topic-emoji {
		font-size: clamp(3rem, 4vw, 3.6rem);
		line-height: 1;
	}

	.topic-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		text-align: center;
		padding: 0 clamp(1.3rem, 2.1vw, 1.8rem);
		width: 100%;
	}

	.topic-tagline {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: rgba(71, 85, 105, 0.85);
	}

	:global([data-theme='dark'] .topic-tagline),
	:global(:root:not([data-theme='light']) .topic-tagline) {
		color: rgba(203, 213, 225, 0.78);
	}

	.launch-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.55rem 1.6rem;
		margin-inline: clamp(1.3rem, 2.1vw, 1.8rem);
		align-self: center;
		border-radius: 9999px;
		font-size: 0.9rem;
		font-weight: 600;
		background: rgba(15, 23, 42, 0.9);
		color: rgba(248, 250, 252, 0.98);
		border: 1px solid rgba(30, 41, 59, 0.55);
		transition:
			transform 0.2s ease,
			background 0.2s ease,
			color 0.2s ease,
			border-color 0.2s ease;
	}

	.welcome-card-button:hover .launch-pill,
	.welcome-card-button:focus-visible .launch-pill {
		background: rgba(59, 130, 246, 0.95);
		border-color: rgba(59, 130, 246, 0.95);
		color: #fff;
		transform: translateY(-1px);
	}

	:global([data-theme='dark'] .launch-pill),
	:global(:root:not([data-theme='light']) .launch-pill) {
		background: rgba(59, 130, 246, 0.92);
		border-color: rgba(59, 130, 246, 0.92);
		color: #fff;
	}

	:global([data-theme='dark'] .welcome-card-button:hover .launch-pill),
	:global(:root:not([data-theme='light']) .welcome-card-button:hover .launch-pill),
	:global([data-theme='dark'] .welcome-card-button:focus-visible .launch-pill),
	:global(:root:not([data-theme='light']) .welcome-card-button:focus-visible .launch-pill) {
		background: rgba(96, 165, 250, 0.95);
		border-color: rgba(96, 165, 250, 0.95);
	}

	.empty-copy {
		margin: 0;
		padding: 0.75rem 1rem;
		border-radius: 0.85rem;
		background: rgba(148, 163, 184, 0.12);
		text-align: center;
		font-size: 0.9rem;
		color: rgba(71, 85, 105, 0.85);
	}

	:global([data-theme='dark'] .empty-copy),
	:global(:root:not([data-theme='light']) .empty-copy) {
		background: rgba(30, 41, 59, 0.35);
		color: rgba(203, 213, 225, 0.78);
	}
</style>
