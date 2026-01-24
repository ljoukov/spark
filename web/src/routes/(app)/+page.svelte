<script lang="ts">
	import { onMount } from 'svelte';
	import { cn } from '$lib/utils.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { getFirebaseApp, startGoogleSignInRedirect } from '$lib/utils/firebaseClient';
	import { clearIdTokenCookie, setIdTokenCookie } from '$lib/auth/tokenCookie';
	import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let authResolved = $state(false);
	let redirecting = $state(false);
	let lastSyncedUid = $state<string | null>(null);
	const destination = $derived(data.destination ?? null);

	let isMuted = $state(true);
	let shouldAutoPlay = $state(true);
	let videoReady = $state(false);
	let videoElement = $state<HTMLVideoElement | null>(null);
	const INTRO_POSTER = '/intro.jpg';

	const ui = $state({
		showAuth: true,
		showAuthDialog: false,
		showAnonConfirm: false,
		signingInWithGoogle: false,
		signingInAnonymously: false,
		syncingProfile: false,
		errorMessage: ''
	});

	const isSignedOut = $derived(authResolved ? ui.showAuth : true);
	const loginButtonLabel = $derived(redirecting ? 'Taking you in…' : 'Log in');
	const googleButtonLabel = $derived(
		ui.signingInWithGoogle ? 'Redirecting to Google…' : 'Continue with Google'
	);
	const guestButtonLabel = $derived(
		ui.signingInAnonymously ? 'Setting up guest mode…' : 'Use guest mode'
	);
	const syncingMessage = $derived(
		ui.syncingProfile && !ui.errorMessage ? 'Finishing sign-in…' : ''
	);
	const soundToggleLabel = $derived(isMuted ? 'Sound off' : 'Sound on');

	$effect(() => {
		const alreadyAuthenticated = data.alreadyAuthenticated || data.authDisabled;
		authResolved = alreadyAuthenticated;
		ui.showAuth = !alreadyAuthenticated;
		if (alreadyAuthenticated) {
			ui.showAuthDialog = false;
			redirectToDestination();
		}
	});

	function resetError() {
		ui.errorMessage = '';
	}

	function resolveDestinationHref(target: typeof destination): string {
		if (target === 'code') {
			return '/code';
		}
		if (target === 'spark') {
			return '/spark';
		}
		return '/c';
	}

	function redirectToDestination(): void {
		if (redirecting) {
			return;
		}
		redirecting = true;
		if (typeof window !== 'undefined') {
			window.location.href = resolveDestinationHref(destination);
		}
	}

	function handleOpenAuthDialog() {
		if (!ui.showAuth) {
			return;
		}
		resetError();
		ui.showAuthDialog = true;
	}

	function handleAuthDialogChange(open: boolean) {
		ui.showAuthDialog = open;
		if (!open) {
			resetError();
		}
	}

	type SyncErrorDetails = {
		status: number;
		payload: unknown;
	};

	function normalizeSyncError(details: SyncErrorDetails | null): string {
		if (!details) {
			return 'Unexpected error while syncing your account.';
		}
		if (details.status === 401) {
			return 'Your Spark session expired. Please sign in again.';
		}
		if (
			details.payload &&
			typeof details.payload === 'object' &&
			details.payload !== null &&
			'message' in details.payload &&
			typeof (details.payload as { message?: unknown }).message === 'string'
		) {
			const message = (details.payload as { message: string }).message.trim();
			if (message.length > 0) {
				return message;
			}
		}
		if (details.payload instanceof Error && typeof details.payload.message === 'string') {
			const message = details.payload.message.trim();
			if (message.length > 0) {
				return message;
			}
		}
		return 'Unexpected error while syncing your account.';
	}

	async function mirrorCookie(user: User): Promise<boolean> {
		try {
			const idToken = await user.getIdToken();
			setIdTokenCookie(idToken);
			return true;
		} catch (error) {
			const fallback = 'Unable to prepare your session. Please try again.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
			return false;
		}
	}

	async function syncProfile(user: User): Promise<boolean> {
		ui.syncingProfile = true;
		let lastError: SyncErrorDetails | null = null;
		try {
			for (const forceRefresh of [false, true] as const) {
				let idToken: string;
				try {
					idToken = await user.getIdToken(forceRefresh);
				} catch (error) {
					lastError = { status: 0, payload: error };
					continue;
				}

				try {
					const response = await fetch('/api/login', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${idToken}`
						},
						body: JSON.stringify({
							name: user.displayName ?? null,
							email: user.email ?? null,
							photoUrl: user.photoURL ?? null,
							isAnonymous: user.isAnonymous
						})
					});

					if (response.ok) {
						lastSyncedUid = user.uid;
						ui.errorMessage = '';
						return true;
					}

					const payload = await response.json().catch(() => null);
					lastError = { status: response.status, payload };
					if (response.status === 401 && !forceRefresh) {
						continue;
					}
					if (response.status === 401) {
						clearIdTokenCookie();
					}
					ui.errorMessage = normalizeSyncError(lastError);
					return false;
				} catch (error) {
					lastError = { status: 0, payload: error };
					// Retry once with a forced refresh.
				}
			}

			if (lastError && lastError.status === 401) {
				clearIdTokenCookie();
			}
			ui.errorMessage = normalizeSyncError(lastError);
			return false;
		} finally {
			ui.syncingProfile = false;
		}
	}

	function handleOpenAnonymousConfirm() {
		ui.showAnonConfirm = true;
	}

	function handleAnonymousDialogChange(open: boolean) {
		ui.showAnonConfirm = open;
	}

	function handleCancelAnonymous() {
		ui.showAnonConfirm = false;
	}

	async function handleAnonymousContinue() {
		if (ui.signingInAnonymously) {
			return;
		}
		resetError();
		ui.signingInAnonymously = true;
		try {
			const auth = getAuth(getFirebaseApp());
			await signInAnonymously(auth);
			ui.showAnonConfirm = false;
		} catch (error) {
			const fallback = 'Guest mode is unavailable right now. Please try again in a moment.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
		} finally {
			ui.signingInAnonymously = false;
		}
	}

	async function handleGoogleSignIn() {
		if (ui.signingInWithGoogle) {
			return;
		}
		resetError();
		ui.signingInWithGoogle = true;
		try {
			await startGoogleSignInRedirect();
		} catch (error) {
			const fallback = 'Unable to start Google sign-in. Please try again.';
			ui.errorMessage = error instanceof Error ? error.message : fallback;
			ui.signingInWithGoogle = false;
		}
	}

	function handleToggleSound() {
		const video = videoElement;
		if (!video) {
			return;
		}
		const nextMuted = !isMuted;
		isMuted = nextMuted;
		video.muted = nextMuted;
		if (!nextMuted) {
			video.play().catch(() => {
				isMuted = true;
				video.muted = true;
			});
		}
	}

	function handleVideoCanPlay() {
		if (videoReady) {
			return;
		}
		videoReady = true;
		if (videoElement) {
			videoElement.poster = '';
		}
	}

	function handleVideoError() {
		videoReady = false;
		if (videoElement) {
			videoElement.poster = INTRO_POSTER;
		}
	}

	onMount(() => {
		if (data.authDisabled) {
			authResolved = true;
			ui.showAuth = false;
			ui.showAuthDialog = false;
			redirectToDestination();
			return () => {};
		}

		const auth = getAuth(getFirebaseApp());
		const unsubscribe = onAuthStateChanged(auth, async (user) => {
			authResolved = true;
			if (!user) {
				clearIdTokenCookie();
				ui.showAuth = true;
				ui.showAnonConfirm = false;
				lastSyncedUid = null;
				redirecting = false;
				return;
			}

			ui.showAuth = false;
			ui.showAuthDialog = false;
			ui.showAnonConfirm = false;

			const navigateToNextStep = () => {
				ui.errorMessage = '';
				redirectToDestination();
			};

			if (lastSyncedUid === user.uid) {
				const mirrored = await mirrorCookie(user);
				if (mirrored) {
					navigateToNextStep();
					return;
				}
				ui.showAuth = true;
				ui.showAnonConfirm = false;
				redirecting = false;
				return;
			}

			const synced = await syncProfile(user);
			if (!synced) {
				ui.showAuth = true;
				ui.showAnonConfirm = false;
				redirecting = false;
				return;
			}
			const mirrored = await mirrorCookie(user);
			if (!mirrored) {
				ui.showAuth = true;
				ui.showAnonConfirm = false;
				redirecting = false;
				return;
			}
			navigateToNextStep();
		});

		return () => {
			unsubscribe();
		};
	});

	onMount(() => {
		if (typeof window === 'undefined') {
			return () => {};
		}
		const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		shouldAutoPlay = !mediaQuery.matches;
		const handleChange = (event: MediaQueryListEvent) => {
			shouldAutoPlay = !event.matches;
			if (!shouldAutoPlay && videoElement) {
				videoElement.pause();
			}
		};
		mediaQuery.addEventListener('change', handleChange);
		return () => {
			mediaQuery.removeEventListener('change', handleChange);
		};
	});
</script>

<svelte:head>
	<title>Spark</title>
	<meta
		name="description"
		content="Spark turns study notes into quizzes, chats, and code practice in one workspace."
	/>
	<meta property="og:title" content="Spark" />
	<meta
		property="og:description"
		content="Spark turns study notes into quizzes, chats, and code practice in one workspace."
	/>
	<meta property="og:image" content="/intro.jpg" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="page">
	<header class="top-bar">
		<div class="brand">
			<img class="brand__icon" src="/favicon.png" alt="Spark icon" loading="lazy" />
			<span class="brand__name">Spark</span>
		</div>
		<div class="top-actions">
			{#if isSignedOut}
				<Button
					onclick={handleOpenAuthDialog}
					disabled={redirecting}
					class={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'top-login')}
				>
					{loginButtonLabel}
				</Button>
			{/if}
		</div>
	</header>

	<main class="hero">
		<section class="hero__copy" aria-label="Spark introduction">
			<span class="pill">Ready when you are</span>
			<h1 class="slogan">
				<span class="slogan__primary">Spark</span>
				<span class="slogan__secondary">Scan. Learn. Spark.</span>
			</h1>
			<p class="hero-copy">
				Turn notes into guided practice. Jump between quizzes, chat, and coding sessions
				without losing your progress.
			</p>
			<div class="cta">
				<Button
					onclick={handleOpenAuthDialog}
					disabled={redirecting}
					class={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'cta__button')}
				>
					{loginButtonLabel}
				</Button>
				<button type="button" class="cta__guest" onclick={handleOpenAnonymousConfirm}>
					Use guest mode
				</button>
			</div>
		</section>

		<section class="hero__media" aria-label="App preview">
			<div class={cn('video-shell', videoReady ? 'video-shell--ready' : '')}>
				<div class="video-shell__halo" aria-hidden="true"></div>
				<div class="video-shell__inner" aria-hidden="true"></div>
				<div class="video-shell__media">
					{#if !videoReady}
						<img
							class="video-shell__poster"
							src={INTRO_POSTER}
							alt="Preview of the Spark learning experience"
							loading="eager"
							decoding="async"
						/>
					{/if}
					<video
						bind:this={videoElement}
						class="video-shell__video"
						autoplay={shouldAutoPlay}
						loop
						playsinline
						muted={isMuted}
						preload="auto"
						poster={INTRO_POSTER}
						oncanplay={handleVideoCanPlay}
						onerror={handleVideoError}
					>
						<source src="/intro.webm" type="video/webm" />
						<source src="/intro.mp4" type="video/mp4" />
					</video>
				</div>
				<button
					type="button"
					class="sound-toggle"
					onclick={handleToggleSound}
					aria-pressed={!isMuted}
					aria-label={isMuted ? 'Enable soundtrack' : 'Mute soundtrack'}
				>
					<span>{soundToggleLabel}</span>
				</button>
			</div>
		</section>
	</main>
</div>

<Dialog.Root open={ui.showAuthDialog} onOpenChange={handleAuthDialogChange}>
	<Dialog.Content class="auth-dialog" hideClose>
		<div class="auth-card">
			<header class="auth-header">
				<p class="auth-eyebrow">Spark account</p>
				<h2 class="auth-title">Sign in to Spark</h2>
			</header>

			<Button
				onclick={handleGoogleSignIn}
				disabled={ui.signingInWithGoogle || ui.syncingProfile}
				class={cn(
					buttonVariants({ variant: 'default', size: 'lg' }),
					'w-full justify-center rounded-full'
				)}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 533.5 544.3"
					class="size-5"
					aria-hidden="true"
				>
					<path
						fill="#4285f4"
						d="M533.5 278.4c0-17.4-1.5-34.1-4.4-50.2H272v95h147.2c-6.4 34.6-25.9 63.9-55.1 83.5v69h88.9c52.1-47.9 80.5-118.4 80.5-197.3z"
					/>
					<path
						fill="#34a853"
						d="M272 544.3c74.7 0 137.4-24.7 183.2-67.6l-88.9-69c-24.7 16.6-56.3 26.4-94.3 26.4-72.6 0-134-49-155.9-114.9H24.2v72.3C69.4 482.2 162.5 544.3 272 544.3z"
					/>
					<path
						fill="#fbbc04"
						d="M116.1 318.9c-4.2-12.6-6.6-26.1-6.6-40s2.4-27.4 6.6-40V166.6H24.2C9 196.3 0 231.4 0 268.9s9 72.6 24.2 102.3l91.9-72.3z"
					/>
					<path
						fill="#ea4335"
						d="M272 107.7c40.8 0 77.3 14 106.1 41.4l79.6-79.6C409.4 24.8 346.7 0 272 0 162.5 0 69.4 62.1 24.2 166.6l91.9 72.3C138 156.7 199.4 107.7 272 107.7z"
					/>
				</svg>
				<span>{googleButtonLabel}</span>
			</Button>

			<div class="auth-alt-copy">
				<p class="auth-alt-label">or</p>
				<p class="auth-alt-text">
					Use guest mode and keep this session on this device. Add your email later to sync
					everywhere.
				</p>
			</div>

			{#if syncingMessage}
				<p class="auth-alert info">{syncingMessage}</p>
			{/if}

			{#if ui.errorMessage}
				<p class="auth-alert error">{ui.errorMessage}</p>
			{/if}

			<footer class="auth-footer">
				<span class="auth-footer__prompt">Need a quick start?</span>
				<button type="button" onclick={handleOpenAnonymousConfirm}>Use guest mode</button>
			</footer>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={ui.showAnonConfirm} onOpenChange={handleAnonymousDialogChange}>
	<Dialog.Content class="anon-dialog" hideClose>
		<Dialog.Header class="anon-header">
			<Dialog.Title>Use guest mode?</Dialog.Title>
			<Dialog.Description>
				Guest mode keeps this session on this device. Add your email later if you want to sync
				across phones and laptops.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="anon-footer">
			<Button
				variant="secondary"
				onclick={handleCancelAnonymous}
				class={cn(buttonVariants({ size: 'lg', variant: 'secondary' }), 'anon-cancel')}
			>
				Back
			</Button>
			<Button
				onclick={handleAnonymousContinue}
				disabled={ui.signingInAnonymously}
				class={cn(buttonVariants({ size: 'lg' }), 'anon-continue')}
			>
				{guestButtonLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	:global(:root) {
		--scrollbar-compensation: max(0px, calc(100vw - 100%));
		--viewport-inline: calc(100vw - var(--scrollbar-compensation));
	}

	@supports (width: 100dvw) {
		:global(:root) {
			--scrollbar-compensation: 0px;
			--viewport-inline: 100dvw;
		}
	}

	.page {
		--page-width: min(1160px, var(--viewport-inline));
		--page-inline-gutter: max(0px, calc((var(--viewport-inline) - var(--page-width)) / 2));
		--halo-before-width: min(clamp(18rem, 42vw, 26rem), 100%);
		--halo-after-width: min(clamp(20rem, 52vw, 32rem), 100%);
		width: min(1160px, 100%);
		margin: 0 auto;
		padding: clamp(1.5rem, 4vw, 3rem) clamp(1.25rem, 6vw, 3.75rem)
			clamp(2.5rem, 8vw, 4rem);
		display: flex;
		flex-direction: column;
		gap: clamp(2.25rem, 5vw, 3.75rem);
		position: relative;
		isolation: isolate;
		box-sizing: border-box;
	}

	.page::before,
	.page::after {
		content: '';
		position: absolute;
		z-index: -1;
		border-radius: 50%;
		filter: blur(64px);
		opacity: 0.6;
		pointer-events: none;
	}

	.page::before {
		inset: clamp(-8rem, -14vw, -4rem) 0 auto auto;
		height: clamp(14rem, 38vw, 20rem);
		width: var(--halo-before-width);
		background: radial-gradient(circle at 30% 40%, rgba(162, 132, 255, 0.55), transparent 70%);
		transform: translate(min(var(--page-inline-gutter), calc(var(--halo-before-width) * 0.22)));
	}

	.page::after {
		inset: auto auto clamp(-10rem, -18vw, -4rem) 0;
		height: clamp(16rem, 46vw, 28rem);
		width: var(--halo-after-width);
		background: radial-gradient(circle at 60% 60%, rgba(16, 185, 129, 0.22), transparent 75%);
		transform: translate(
			-min(var(--page-inline-gutter), calc(var(--halo-after-width) * 0.26))
		);
	}

	:global([data-theme='dark'] .page)::before {
		background: radial-gradient(circle at 30% 40%, rgba(129, 140, 248, 0.42), transparent 70%);
	}

	:global([data-theme='dark'] .page)::after {
		background: radial-gradient(circle at 60% 60%, rgba(56, 189, 248, 0.26), transparent 75%);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .page)::before {
			background: radial-gradient(
				circle at 30% 40%,
				rgba(129, 140, 248, 0.42),
				transparent 70%
			);
		}

		:global(:root:not([data-theme='light']) .page)::after {
			background: radial-gradient(
				circle at 60% 60%,
				rgba(56, 189, 248, 0.26),
				transparent 75%
			);
		}
	}

	.top-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		text-decoration: none;
	}

	.brand__icon {
		width: clamp(2.5rem, 5vw, 3rem);
		height: clamp(2.5rem, 5vw, 3rem);
		border-radius: 0.8rem;
		box-shadow: 0 14px 44px var(--shadow-color);
		object-fit: cover;
	}

	.brand__name {
		font-size: clamp(1.05rem, 2.5vw, 1.4rem);
		font-weight: 600;
	}

	.top-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.hero {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: clamp(2rem, 5vw, 3.25rem);
		align-items: center;
	}

	.hero__copy {
		display: flex;
		flex-direction: column;
		gap: clamp(1.5rem, 4vw, 2rem);
	}

	.pill {
		align-self: flex-start;
		padding: 0.45rem 0.95rem;
		border-radius: 999px;
		background: var(--surface-color);
		border: 1px solid var(--surface-border);
		box-shadow: 0 10px 28px var(--shadow-color);
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-secondary);
	}

	.slogan {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: clamp(0.3rem, 1vw, 0.5rem);
		font-size: clamp(2.6rem, 5.8vw, 4.3rem);
		line-height: 1.04;
		font-weight: 700;
	}

	.slogan__primary {
		font-size: 1em;
		color: rgba(7, 10, 26, 0.9);
		letter-spacing: -0.015em;
	}

	:global([data-theme='dark'] .slogan__primary) {
		color: rgba(248, 250, 252, 0.92);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .slogan__primary) {
			color: rgba(248, 250, 252, 0.92);
		}
	}

	.slogan__secondary {
		font-size: clamp(1.1rem, 2.2vw, 1.7rem);
		font-weight: 400;
		color: rgba(55, 63, 86, 0.84);
		letter-spacing: 0.01em;
		text-transform: none;
	}

	:global([data-theme='dark'] .slogan__secondary) {
		color: rgba(203, 213, 245, 0.78);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .slogan__secondary) {
			color: rgba(203, 213, 245, 0.78);
		}
	}

	.hero-copy {
		margin: 0;
		font-size: clamp(1rem, 2.2vw, 1.15rem);
		line-height: 1.6;
		color: rgba(55, 63, 86, 0.8);
		max-width: 34rem;
	}

	:global([data-theme='dark'] .hero-copy) {
		color: rgba(226, 232, 240, 0.76);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .hero-copy) {
			color: rgba(226, 232, 240, 0.76);
		}
	}

	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		align-items: center;
	}

	.cta__button {
		box-shadow: 0 22px 44px var(--shadow-color);
	}

	.cta__guest {
		background: none;
		border: none;
		padding: 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: rgba(29, 78, 216, 0.9);
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: transparent;
		transition:
			color 0.2s ease,
			text-decoration-color 0.2s ease;
	}

	.cta__guest:hover {
		color: rgba(15, 23, 42, 0.9);
		text-decoration-color: currentColor;
	}

	:global([data-theme='dark'] .cta__guest) {
		color: rgba(147, 197, 253, 0.9);
	}

	:global([data-theme='dark'] .cta__guest:hover) {
		color: rgba(226, 232, 240, 0.95);
	}

	.hero__media {
		display: flex;
		justify-content: center;
	}

	.video-shell {
		position: relative;
		width: min(440px, 100%);
		aspect-ratio: 1 / 1;
		border-radius: 1.45rem;
		padding: clamp(0.35rem, 1.2vw, 0.6rem);
		background: linear-gradient(155deg, rgba(190, 169, 255, 0.58), rgba(22, 25, 60, 0.92));
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 28px 68px var(--shadow-color);
		overflow: hidden;
		transition:
			background 0.22s ease,
			box-shadow 0.22s ease,
			border-color 0.22s ease;
	}

	:global([data-theme='dark'] .video-shell) {
		background: linear-gradient(150deg, rgba(88, 28, 135, 0.5), rgba(2, 6, 23, 0.95));
		border-color: rgba(148, 163, 184, 0.26);
		box-shadow: 0 32px 84px rgba(8, 11, 21, 0.88);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .video-shell) {
			background: linear-gradient(150deg, rgba(88, 28, 135, 0.5), rgba(2, 6, 23, 0.95));
			border-color: rgba(148, 163, 184, 0.26);
			box-shadow: 0 32px 84px rgba(8, 11, 21, 0.88);
		}
	}

	.video-shell__halo {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: radial-gradient(circle at 50% 50%, rgba(209, 196, 255, 0.65), transparent 68%);
		filter: blur(62px);
		opacity: 0.7;
		mix-blend-mode: screen;
		pointer-events: none;
		z-index: 0;
		transform: scale(1.1);
		transform-origin: center;
	}

	:global([data-theme='dark'] .video-shell__halo) {
		background: radial-gradient(circle at 45% 55%, rgba(129, 140, 248, 0.42), transparent 72%);
		opacity: 0.6;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .video-shell__halo) {
			background: radial-gradient(
				circle at 45% 55%,
				rgba(129, 140, 248, 0.42),
				transparent 72%
			);
			opacity: 0.6;
		}
	}

	@media (min-width: 640px) {
		.video-shell__halo {
			transform: scale(1.4);
		}
	}

	@media (min-width: 960px) {
		.video-shell__halo {
			transform: scale(1.65);
		}
	}

	.video-shell__inner {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(150deg, rgba(255, 255, 255, 0.36), rgba(103, 87, 232, 0.18));
		border: 1px solid rgba(255, 255, 255, 0.18);
		opacity: 0.58;
		pointer-events: none;
		z-index: 1;
	}

	:global([data-theme='dark'] .video-shell__inner) {
		background: linear-gradient(155deg, rgba(59, 130, 246, 0.18), rgba(2, 6, 23, 0.88));
		border-color: rgba(148, 163, 184, 0.18);
		opacity: 0.52;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .video-shell__inner) {
			background: linear-gradient(155deg, rgba(59, 130, 246, 0.18), rgba(2, 6, 23, 0.88));
			border-color: rgba(148, 163, 184, 0.18);
			opacity: 0.52;
		}
	}

	.video-shell__media {
		position: relative;
		z-index: 2;
		width: 100%;
		height: 100%;
		border-radius: 1.1rem;
		overflow: hidden;
		background: rgba(5, 9, 21, 0.96);
		box-shadow: 0 20px 50px rgba(15, 23, 42, 0.28);
		transition: box-shadow 0.22s ease;
	}

	.video-shell__poster,
	.video-shell__video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.video-shell__poster {
		z-index: 1;
		transition: opacity 0.22s ease;
	}

	.video-shell__video {
		z-index: 2;
		background: rgba(5, 9, 21, 0.96);
		opacity: 0;
		transition: opacity 0.22s ease;
	}

	.video-shell--ready .video-shell__inner {
		opacity: 0.44;
		filter: saturate(1.05);
	}

	.video-shell--ready .video-shell__media {
		box-shadow: 0 34px 72px rgba(15, 23, 42, 0.38);
	}

	.video-shell--ready .video-shell__video {
		opacity: 1;
	}

	.sound-toggle {
		position: absolute;
		bottom: 1.1rem;
		right: 1.1rem;
		border-radius: 999px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: var(--sound-toggle-bg);
		backdrop-filter: blur(12px);
		color: var(--sound-toggle-foreground);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		padding: 0.55rem 1.1rem;
		z-index: 2;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease,
			background 0.15s ease;
	}

	.sound-toggle:hover {
		transform: scale(1.05);
		box-shadow: 0 18px 50px var(--shadow-color);
	}

	@media (max-width: 960px) {
		.page {
			padding-inline: clamp(1.25rem, 4vw, 2rem);
		}

		.hero {
			grid-template-columns: 1fr;
			text-align: center;
		}

		.hero__copy {
			align-items: center;
		}

		.slogan {
			align-items: center;
			text-align: center;
		}

		.pill {
			align-self: center;
		}

		.cta {
			justify-content: center;
		}

		.hero__media {
			order: 2;
		}
	}

	@media (max-width: 540px) {
		.page {
			gap: 2rem;
		}

		.brand__icon {
			width: 2.25rem;
			height: 2.25rem;
		}

		.sound-toggle {
			font-size: 0.72rem;
			padding: 0.5rem 0.9rem;
		}
	}

	.auth-backdrop {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(3rem, 6vw, 6rem) clamp(1.5rem, 4vw, 3.5rem);
		overflow-x: hidden;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		background:
			radial-gradient(120% 120% at 50% -10%, var(--app-halo) 0%, transparent 70%),
			var(--app-surface);
		color: var(--text-primary, var(--foreground));
		--app-surface: hsl(38 82% 97%);
		--app-halo: hsla(45 87% 90% / 0.65);
		--blob-gold: hsla(42 96% 84% / 0.9);
		--blob-yellow: hsla(38 95% 82% / 0.88);
		--blob-yellow-soft: hsla(38 92% 91% / 0.88);
		--blob-pink: hsla(332 85% 86% / 0.92);
		--blob-blue: hsla(184 95% 91% / 0.82);
		--blob-opacity: 0.6;
		--app-content-bg: rgba(255, 255, 255, 0.96);
		/* Ensure dialog background follows theme (light/dark) */
		--auth-dialog-bg: var(--app-content-bg);
		--app-content-border: rgba(15, 23, 42, 0.12);
		--app-subtitle-color: var(--text-secondary, rgba(30, 41, 59, 0.78));
		--auth-dialog-border: rgba(15, 23, 42, 0.12);
		--auth-dialog-foreground: #0f172a;
		--auth-dialog-subtitle: rgba(30, 41, 59, 0.78);
		--auth-dialog-eyebrow: rgba(30, 64, 175, 0.82);
		--auth-dialog-shadow: 0 40px 120px -60px rgba(15, 23, 42, 0.5);
	}

	.auth-backdrop--idle {
		pointer-events: none;
	}

	@supports (height: 100dvh) {
		.auth-backdrop {
			min-height: 100dvh;
		}
	}

	.auth-blob-field {
		position: absolute;
		inset: -40%;
		pointer-events: none;
		filter: blur(90px);
		transform: translateZ(0);
		background:
			radial-gradient(68% 68% at 12% 2%, var(--blob-gold), transparent 68%),
			radial-gradient(58% 58% at 22% 26%, var(--blob-yellow), transparent 70%),
			radial-gradient(54% 54% at 72% 18%, var(--blob-pink), transparent 72%),
			radial-gradient(60% 60% at 24% 80%, var(--blob-blue), transparent 74%),
			radial-gradient(50% 50% at 86% 86%, var(--blob-yellow-soft), transparent 76%);
		opacity: var(--blob-opacity);
	}

	.auth-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 2.75rem 2.5rem 2.25rem;
		max-width: 30rem;
		border-radius: 1.75rem;
		border: 1px solid var(--app-content-border, rgba(255, 255, 255, 0.55));
		background: var(--app-content-bg, rgba(255, 255, 255, 0.9));
		color: var(--auth-dialog-foreground, var(--foreground));
		box-shadow: var(--auth-dialog-shadow, 0 30px 80px rgba(15, 23, 42, 0.55));
	}

	@media (max-height: 32rem) {
		.auth-card {
			margin-block: clamp(1.5rem, 6vh, 2.5rem);
		}
	}

	.auth-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.auth-eyebrow {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.28em;
		font-size: 0.7rem;
		color: var(--auth-dialog-eyebrow, rgba(148, 197, 255, 0.9));
		font-weight: 600;
	}

	.auth-title {
		margin: 0;
		font-size: 2.2rem;
		font-weight: 600;
	}

	.auth-alt-copy {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--app-subtitle-color);
	}

	.auth-alt-label {
		text-transform: uppercase;
		letter-spacing: 0.35em;
		font-size: 0.65rem;
		color: var(--app-subtitle-color);
		font-weight: 600;
	}

	.auth-alt-text {
		margin: 0;
		line-height: 1.5;
		color: var(--app-subtitle-color);
		font-weight: 500;
	}

	.auth-alert {
		border-radius: 1rem;
		padding: 0.85rem 1.1rem;
		font-size: 0.9rem;
		line-height: 1.45;
		font-weight: 500;
	}

	.auth-alert.info {
		background: rgba(14, 165, 233, 0.18);
		border: 1px solid rgba(14, 165, 233, 0.45);
		color: #bae6fd;
	}

	.auth-alert.error {
		background: rgba(248, 113, 113, 0.14);
		border: 1px solid rgba(220, 38, 38, 0.4);
		color: #b91c1c;
	}

	:global([data-theme='dark'] .auth-alert.error) {
		background: rgba(239, 68, 68, 0.24);
		border: 1px solid rgba(248, 113, 113, 0.55);
		color: #fecaca;
	}

	.auth-footer {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 1.25rem;
		background: rgba(148, 163, 184, 0.12);
		padding: 0.85rem 1.1rem;
		font-size: 0.8rem;
		color: var(--app-subtitle-color);
		font-weight: 500;
	}

	.auth-footer__prompt {
		flex: 1;
		text-align: center;
	}

	.auth-footer button {
		background: none;
		border: none;
		padding: 0;
		color: var(--auth-footer-link, #1d4ed8);
		font-weight: 600;
		text-decoration: underline;
		text-decoration-color: transparent;
		cursor: pointer;
		transition:
			color 0.25s ease,
			text-decoration-color 0.25s ease;
	}

	.auth-footer button:hover {
		color: var(--auth-footer-link-hover, #0f172a);
		text-decoration-color: currentColor;
	}

	.auth-footer button:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	@media (max-width: 520px) {
		.auth-card {
			gap: 1.25rem;
		}

		.auth-footer {
			flex-direction: column;
			align-items: stretch;
			gap: 0.75rem;
		}
	}

	:global([data-slot='dialog-overlay']) {
		background: rgba(2, 6, 23, 0.68);
		backdrop-filter: blur(4px);
	}

	:global(.auth-dialog) {
		padding: 0 !important;
		border: none !important;
		background: transparent !important;
		box-shadow: none !important;
		max-width: min(34rem, 92vw);
	}

	:global(.auth-dialog [data-slot='dialog-close']),
	:global(.anon-dialog [data-slot='dialog-close']) {
		display: none !important;
	}

	:global(.anon-dialog) {
		--anon-surface: rgba(255, 255, 255, 0.92);
		--anon-border: rgba(15, 23, 42, 0.12);
		--anon-foreground: #0f172a;
		--anon-subtitle: rgba(15, 23, 42, 0.72);
		--anon-shadow: 0 30px 80px rgba(15, 23, 42, 0.55);
		max-width: 26rem;
		border-radius: 1.5rem;
		border: 1px solid var(--auth-dialog-border, var(--anon-border));
		background: var(--auth-dialog-bg, var(--anon-surface));
		color: var(--auth-dialog-foreground, var(--anon-foreground));
		box-shadow: var(--auth-dialog-shadow, var(--anon-shadow));
	}

	:global([data-theme='dark'] .anon-dialog),
	:global(:root:not([data-theme='light']) .anon-dialog) {
		--anon-surface: rgba(6, 11, 25, 0.86);
		--anon-border: rgba(148, 163, 184, 0.28);
		--anon-foreground: #e2e8f0;
		--anon-subtitle: rgba(226, 232, 240, 0.78);
		--anon-shadow: 0 30px 80px rgba(2, 6, 23, 0.75);
	}

	:global(.anon-header) {
		padding: 2rem 2rem 0;
		text-align: center;
	}

	:global(.anon-header [data-slot='dialog-title']) {
		font-size: 1.4rem;
		font-weight: 600;
	}

	:global(.anon-header [data-slot='dialog-description']) {
		margin-top: 0.85rem;
		font-size: 0.95rem;
		line-height: 1.6;
		color: var(--auth-dialog-subtitle, var(--anon-subtitle));
		font-weight: 500;
	}

	:global(.anon-footer) {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 2rem;
		align-items: stretch;
	}

	@media (min-width: 40rem) {
		:global(.anon-footer) {
			flex-direction: row;
			align-items: center;
		}
	}

	:global(.anon-footer [data-slot='button']) {
		width: 100%;
	}

	:global(.anon-cancel) {
		flex: 1;
		background: #0284c7 !important;
		color: #ffffff !important;
		justify-content: center;
		box-shadow: 0 18px 40px rgba(14, 165, 233, 0.35);
	}

	:global(.anon-cancel:hover) {
		background: #0ea5e9 !important;
	}

	:global(.anon-continue) {
		flex: 1;
		background: #f97316 !important;
		color: #ffffff !important;
		justify-content: center;
		box-shadow: 0 18px 40px rgba(251, 146, 60, 0.35);
	}

	:global(.anon-continue:hover) {
		background: #fb923c !important;
	}

	:global(.anon-continue:disabled) {
		opacity: 0.75;
		cursor: progress;
	}

	@media (max-width: 480px) {
		:global(.anon-footer) {
			flex-direction: column-reverse;
		}

		:global(.anon-cancel),
		:global(.anon-continue) {
			width: 100%;
		}
	}

	:global([data-theme='dark'] .auth-backdrop) {
		--app-surface: linear-gradient(175deg, rgba(2, 6, 23, 0.98), rgba(6, 11, 25, 0.94));
		--app-halo: rgba(129, 140, 248, 0.36);
		--blob-gold: rgba(129, 140, 248, 0.45);
		--blob-yellow: rgba(88, 28, 135, 0.4);
		--blob-yellow-soft: rgba(56, 189, 248, 0.28);
		--blob-pink: rgba(129, 140, 248, 0.38);
		--blob-blue: rgba(56, 189, 248, 0.26);
		--blob-opacity: 0.78;
		--app-content-bg: rgba(6, 11, 25, 0.78);
		--app-content-border: rgba(148, 163, 184, 0.26);
		--app-subtitle-color: rgba(226, 232, 240, 0.78);
		--auth-dialog-border: rgba(148, 163, 184, 0.26);
		--auth-dialog-foreground: #e2e8f0;
		--auth-dialog-subtitle: rgba(226, 232, 240, 0.78);
		--auth-dialog-shadow: 0 30px 80px rgba(2, 6, 23, 0.75);
		--auth-footer-link: #93c5fd;
		--auth-footer-link-hover: #e2e8f0;
		color: var(--foreground);
	}

	:global([data-theme='dark'] .auth-blob-field) {
		background:
			radial-gradient(64% 64% at 16% 20%, var(--blob-gold), transparent 72%),
			radial-gradient(58% 58% at 78% 24%, var(--blob-blue), transparent 74%),
			radial-gradient(56% 56% at 24% 78%, var(--blob-yellow-soft), transparent 76%),
			radial-gradient(60% 60% at 82% 70%, var(--blob-pink), transparent 80%),
			radial-gradient(70% 70% at 50% 50%, var(--blob-yellow), transparent 82%);
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .auth-backdrop) {
			--app-surface: linear-gradient(175deg, rgba(2, 6, 23, 0.98), rgba(6, 11, 25, 0.94));
			--app-halo: rgba(129, 140, 248, 0.36);
			--blob-gold: rgba(129, 140, 248, 0.45);
			--blob-yellow: rgba(88, 28, 135, 0.4);
			--blob-yellow-soft: rgba(56, 189, 248, 0.28);
			--blob-pink: rgba(129, 140, 248, 0.38);
			--blob-blue: rgba(56, 189, 248, 0.26);
			--blob-opacity: 0.78;
			--app-content-bg: rgba(6, 11, 25, 0.78);
			--app-content-border: rgba(148, 163, 184, 0.26);
			--app-subtitle-color: rgba(226, 232, 240, 0.78);
			--auth-dialog-border: rgba(148, 163, 184, 0.26);
			--auth-dialog-foreground: #e2e8f0;
			--auth-dialog-subtitle: rgba(226, 232, 240, 0.78);
			--auth-dialog-shadow: 0 30px 80px rgba(2, 6, 23, 0.75);
			--auth-footer-link: #93c5fd;
			--auth-footer-link-hover: #e2e8f0;
			color: var(--foreground);
		}

		:global(:root:not([data-theme='light']) .auth-blob-field) {
			background:
				radial-gradient(64% 64% at 16% 20%, var(--blob-gold), transparent 72%),
				radial-gradient(58% 58% at 78% 24%, var(--blob-blue), transparent 74%),
				radial-gradient(56% 56% at 24% 78%, var(--blob-yellow-soft), transparent 76%),
				radial-gradient(60% 60% at 82% 70%, var(--blob-pink), transparent 80%),
				radial-gradient(70% 70% at 50% 50%, var(--blob-yellow), transparent 82%);
		}

		:global(:root:not([data-theme='light']) .auth-alert.error) {
			background: rgba(239, 68, 68, 0.24);
			border: 1px solid rgba(248, 113, 113, 0.55);
			color: #fecaca;
		}
	}
</style>
