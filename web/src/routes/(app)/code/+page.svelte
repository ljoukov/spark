<script lang="ts">
	import { getContext, onDestroy, onMount } from 'svelte';

	type UserStore = {
		subscribe: (
			run: (value: { name?: string | null; email?: string | null } | null) => void
		) => () => void;
	};

	const userStore = getContext<UserStore | undefined>('spark-code:user');

	let firstName = $state('Sparkie');
	let unsubscribe: (() => void) | null = null;

	if (userStore) {
		unsubscribe = userStore.subscribe((value) => {
			const resolved = value?.name?.trim() || value?.email?.split('@')[0] || 'Spark guest';
			firstName = resolved.split(/\s+/)[0] ?? resolved;
		});
	}

	onDestroy(() => {
		unsubscribe?.();
	});

	const stats = [
		{ label: 'XP', value: '1,420' },
		{ label: 'Level', value: '7' },
		{ label: 'Days 🔥', value: '12' },
		{ label: 'Solved', value: '86' }
	];

	type TimelineStep = {
		key: string;
		title: string;
		icon: string;
		meta?: string;
		description: string;
		href: string;
		done?: boolean;
	};

	const STORAGE_KEY = 'spark-code-progress';

	const focus = {
		eyebrow: "Today's plan",
		topic: 'DP easy win sprint',
		summary:
			'Warm up, explore the coin change transition, solve two easy DP problems, then seal it with a review quiz.'
	};

	const problems = [
		{
			key: 'problem-coin-change-ways',
			slug: 'coin-change-ways',
			title: 'Coin Change Ways',
			icon: '🪙',
			meta: 'DP • Easy',
			description: 'Count combinations to reach a target amount with unlimited coins.'
		},
		{
			key: 'problem-decode-ways',
			slug: 'decode-ways',
			title: 'Decode Ways',
			icon: '🔐',
			meta: 'DP • Easy',
			description: 'Turn digit strings into letter counts with memoized recursion.'
		}
	] as const;

	const baseTimeline: TimelineStep[] = [
		{
			key: 'warmup',
			title: 'Warm-up quiz',
			icon: '🔥',
			meta: '3 quick checks',
			description: 'Get the DP basics firing before you code.',
			href: '/code/quiz/dp-warmup-quiz'
		},
		{
			key: 'topic',
			title: 'Topic deck',
			icon: '🧠',
			meta: '5 guided steps',
			description: 'Two info cards and three micro-quizzes on the coin change pattern.',
			href: '/code/quiz/dp-topic-deck'
		},
		...problems.map((problem, index) => ({
			key: problem.key,
			title: `${index === 0 ? 'Practice' : 'Challenge'} · ${problem.title}`,
			icon: problem.icon,
			meta: problem.meta,
			description: problem.description,
			href: `/code/p/${problem.slug}`
		})),
		{
			key: 'review',
			title: 'Final review quiz',
			icon: '✅',
			meta: '3 questions',
			description: 'Confirm the pattern sticks before tackling harder sets.',
			href: '/code/quiz/dp-review-quiz'
		}
	];

	const validKeys = new Set(baseTimeline.map((step) => step.key));

	let completedKeys = $state<string[]>([]);

	onMount(() => {
		if (typeof window === 'undefined') {
			return;
		}

		try {
			const raw = window.sessionStorage.getItem(STORAGE_KEY);
			if (!raw) {
				return;
			}
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				completedKeys = parsed.filter(
					(entry): entry is string => typeof entry === 'string' && validKeys.has(entry)
				);
			}
		} catch (error) {
			console.error('Unable to load stored progress', error);
			completedKeys = [];
		}
	});

	const completedSet = $derived(new Set(completedKeys));
	const timeline = $derived(
		baseTimeline.map((step) => ({
			...step,
			done: completedSet.has(step.key)
		}))
	);
	const firstIncomplete = $derived(
		timeline.find((step) => !step.done) ?? timeline[timeline.length - 1]!
	);
	const startHref = $derived(firstIncomplete.href);
	const startLabel = $derived(firstIncomplete.title);
</script>

<svelte:head>
        <title>Spark Code · Your session plan</title>
</svelte:head>

<section class="dashboard">
        <div class="hero-card">
                <h1 class="hero-title">
                        Welcome back, {firstName}!
                        <span class="hero-rocket" aria-hidden="true">🚀</span>
                </h1>
		<p class="hero-subtitle">Let&apos;s crush today&apos;s session.</p>
		<div class="stat-chips">
			{#each stats as stat}
				<div class="stat-chip">
					<span class="chip-value">{stat.value}</span>
					<span class="chip-label">{stat.label}</span>
				</div>
			{/each}
		</div>
	</div>

	<div class="plan-card">
		<header class="plan-header">
			<p class="plan-eyebrow">{focus.eyebrow}</p>
			<h2>{focus.topic}</h2>
			<p class="plan-summary">{focus.summary}</p>
		</header>
                <div class="plan-body">
                        <ul class="timeline" aria-label="Today's plan steps">
                                {#each timeline as item}
                                        <li class="timeline-item" data-done={item.done}>
                                                <a class="timeline-link" href={item.href}>
                                                        <span class="timeline-status" data-done={item.done}>
                                                                {#if item.done}
                                                                        ✓
                                                                {:else}
                                                                        •
                                                                {/if}
                                                        </span>
                                                        <span class="timeline-emoji" aria-hidden="true">{item.icon}</span>
                                                        <span class="timeline-content">
                                                                <span class="timeline-title">{item.title}</span>
                                                                {#if item.meta}
                                                                        <span class="timeline-meta">{item.meta}</span>
                                                                {/if}
                                                                <span class="timeline-description">{item.description}</span>
                                                        </span>
                                                </a>
                                        </li>
                                {/each}
                        </ul>
                </div>
		<div class="plan-footer">
			<a class="plan-start" href={startHref}>
				▶ Start with {startLabel}
			</a>
		</div>
	</div>
</section>

<style lang="postcss">
        .dashboard {
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
                padding: 2rem 1.5rem 2.5rem;
                max-width: 72rem;
                margin: 0 auto;
                width: 100%;
        }

        @media (min-width: 72rem) {
                .dashboard {
                        flex-direction: row;
                        align-items: flex-start;
                }

                .dashboard > * {
                        flex: 1;
                }
        }

        .hero-card,
        .plan-card {
                background: var(--app-surface, var(--app-content-bg, #fff));
                border: 1px solid rgba(148, 163, 184, 0.35);
                border-radius: 1rem;
                padding: 1.5rem;
                display: flex;
                flex-direction: column;
                gap: 1rem;
        }

        :global([data-theme='dark'] .hero-card),
        :global(:root:not([data-theme='light']) .hero-card),
        :global([data-theme='dark'] .plan-card),
        :global(:root:not([data-theme='light']) .plan-card) {
                background: rgba(15, 23, 42, 0.65);
                border-color: rgba(148, 163, 184, 0.4);
        }

        .hero-title {
                margin: 0;
                font-size: clamp(2rem, 4vw, 2.5rem);
                line-height: 1.1;
                font-weight: 650;
        }

        .hero-rocket {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                margin-left: 0.5rem;
                font-size: 2.5rem;
        }

        .hero-subtitle {
                margin: 0;
                font-size: clamp(1rem, 2.5vw, 1.2rem);
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.72));
                font-weight: 500;
        }

        .stat-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 0.75rem;
        }

        .stat-chip {
                display: inline-flex;
                align-items: baseline;
                gap: 0.35rem;
                padding: 0.4rem 0.9rem;
                border-radius: 9999px;
                border: 1px solid rgba(148, 163, 184, 0.35);
                background: var(--app-surface, #fff);
                font-weight: 600;
                font-size: 0.9rem;
        }

        :global([data-theme='dark'] .stat-chip),
        :global(:root:not([data-theme='light']) .stat-chip) {
                background: rgba(30, 41, 59, 0.6);
                color: rgba(226, 232, 240, 0.92);
        }

        .chip-value {
                font-size: 1rem;
        }

        .chip-label {
                font-size: 0.75rem;
                font-weight: 500;
                color: rgba(71, 85, 105, 0.8);
        }

        :global([data-theme='dark'] .chip-label),
        :global(:root:not([data-theme='light']) .chip-label) {
                color: rgba(203, 213, 225, 0.8);
        }

        .plan-card {
                gap: 1.5rem;
        }

        .plan-header {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
        }

        .plan-eyebrow {
                margin: 0;
                font-size: 0.8rem;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                color: rgba(37, 99, 235, 0.9);
                font-weight: 600;
        }

        .plan-header h2 {
                margin: 0;
                font-size: clamp(1.4rem, 3vw, 2rem);
                font-weight: 600;
        }

        .plan-summary {
                margin: 0;
                font-size: 0.95rem;
                line-height: 1.5;
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
        }

        :global([data-theme='dark'] .plan-summary),
        :global(:root:not([data-theme='light']) .plan-summary) {
                color: rgba(203, 213, 225, 0.8);
        }

        .timeline {
                list-style: none;
                margin: 0;
                padding: 0;
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
        }

        .timeline-item {
                margin: 0;
        }

        .timeline-link {
                display: flex;
                align-items: flex-start;
                gap: 0.75rem;
                text-decoration: none;
                color: inherit;
                border: 1px solid rgba(148, 163, 184, 0.4);
                border-radius: 0.75rem;
                padding: 0.8rem 1rem;
                background: var(--app-surface, #fff);
                transition: border-color 120ms ease, background-color 120ms ease;
        }

        .timeline-link:hover,
        .timeline-link:focus-visible {
                border-color: rgba(37, 99, 235, 0.6);
                background: rgba(37, 99, 235, 0.06);
        }

        .timeline-link:focus-visible {
                outline: 2px solid rgba(37, 99, 235, 0.7);
                outline-offset: 2px;
        }

        :global([data-theme='dark'] .timeline-link),
        :global(:root:not([data-theme='light']) .timeline-link) {
                background: rgba(15, 23, 42, 0.55);
        }

        .timeline-status {
                flex-shrink: 0;
                width: 1.75rem;
                height: 1.75rem;
                border-radius: 9999px;
                border: 1px solid rgba(148, 163, 184, 0.5);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-weight: 600;
                font-size: 0.85rem;
                background: var(--app-surface, #fff);
        }

        .timeline-status[data-done='true'] {
                border-color: rgba(37, 99, 235, 0.9);
                background: rgba(37, 99, 235, 0.12);
                color: rgba(37, 99, 235, 0.9);
        }

        :global([data-theme='dark'] .timeline-status),
        :global(:root:not([data-theme='light']) .timeline-status) {
                background: rgba(15, 23, 42, 0.7);
        }

        :global([data-theme='dark'] .timeline-status[data-done='true']),
        :global(:root:not([data-theme='light']) .timeline-status[data-done='true']) {
                background: rgba(37, 99, 235, 0.3);
                color: rgba(219, 234, 254, 0.95);
        }

        .timeline-emoji {
                font-size: 1.6rem;
                line-height: 1;
                flex-shrink: 0;
        }

        .timeline-content {
                display: flex;
                flex-direction: column;
                gap: 0.2rem;
                min-width: 0;
        }

        .timeline-title {
                font-weight: 600;
                font-size: 1.05rem;
        }

        .timeline-meta {
                font-size: 0.8rem;
                color: rgba(71, 85, 105, 0.8);
        }

        :global([data-theme='dark'] .timeline-meta),
        :global(:root:not([data-theme='light']) .timeline-meta) {
                color: rgba(203, 213, 225, 0.7);
        }

        .timeline-description {
                font-size: 0.9rem;
                color: rgba(71, 85, 105, 0.88);
                line-height: 1.45;
        }

        :global([data-theme='dark'] .timeline-description),
        :global(:root:not([data-theme='light']) .timeline-description) {
                color: rgba(226, 232, 240, 0.78);
        }

        .plan-footer {
                display: flex;
                justify-content: flex-end;
        }

        .plan-start {
                display: inline-flex;
                align-items: center;
                gap: 0.35rem;
                padding: 0.6rem 1rem;
                border-radius: 9999px;
                background: rgba(37, 99, 235, 0.1);
                color: rgba(37, 99, 235, 0.95);
                font-weight: 600;
                text-decoration: none;
        }

        .plan-start:hover,
        .plan-start:focus-visible {
                background: rgba(37, 99, 235, 0.18);
        }
</style>
