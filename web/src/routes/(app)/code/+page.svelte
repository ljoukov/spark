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
                        Welcome back, {firstName}!<span class="hero-rocket" aria-hidden="true">🚀</span>
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
                        {#each timeline as item}
                                <a class="timeline-row" href={item.href} data-done={item.done}>
                                        <span class="timeline-icon" aria-hidden="true">{item.icon}</span>
                                        <div class="timeline-text-block">
                                                <div class="headline-row">
                                                        <span class="checkpoint-name">{item.title}</span>
                                                        {#if item.meta}
                                                                <span class="checkpoint-meta">· {item.meta}</span>
                                                        {/if}
                                                </div>
                                                <p class="checkpoint-description">{item.description}</p>
                                        </div>
                                </a>
			{/each}
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
                display: grid;
                grid-template-columns: 1fr;
                gap: 1.5rem;
                padding: 1.5rem 0 2rem;
                align-items: start;
                max-width: min(70rem, 92vw);
                margin: 0 auto;
        }

        @media (min-width: 70rem) {
                .dashboard {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                }
        }

        .hero-card,
        .plan-card {
                display: flex;
                flex-direction: column;
                gap: 1rem;
                padding: 1.6rem;
                border-radius: 1.25rem;
                background: var(--app-surface, #ffffff);
                border: 1px solid rgba(148, 163, 184, 0.2);
        }

        :global([data-theme='dark'] .hero-card),
        :global(:root:not([data-theme='light']) .hero-card),
        :global([data-theme='dark'] .plan-card),
        :global(:root:not([data-theme='light']) .plan-card) {
                background: rgba(15, 23, 42, 0.6);
                border-color: rgba(148, 163, 184, 0.4);
        }

        .hero-title {
                margin: 0;
                font-size: clamp(1.9rem, 3.2vw, 2.4rem);
                line-height: 1.1;
                font-weight: 650;
        }

        .hero-rocket {
                margin-left: 0.45rem;
                font-size: 1.9rem;
        }

        .hero-subtitle {
                margin: 0;
                font-size: 1rem;
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.72));
        }

        .stat-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 0.6rem;
        }

        .stat-chip {
                display: inline-flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 0.15rem;
                padding: 0.55rem 0.9rem;
                border-radius: 0.75rem;
                background: rgba(148, 163, 184, 0.12);
                border: 1px solid rgba(148, 163, 184, 0.25);
                font-weight: 600;
                font-size: 0.9rem;
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
                color: rgba(226, 232, 240, 0.75);
        }

        .plan-header {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
        }

        .plan-eyebrow {
                margin: 0;
                font-size: 0.75rem;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                color: rgba(59, 130, 246, 0.8);
                font-weight: 600;
        }

        .plan-header h2 {
                margin: 0;
                font-size: clamp(1.3rem, 2.2vw, 1.8rem);
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
                color: rgba(203, 213, 225, 0.78);
        }

        .plan-body {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
        }

        .timeline-row {
                display: flex;
                gap: 0.9rem;
                padding: 0.9rem 1rem;
                border-radius: 0.9rem;
                text-decoration: none;
                color: inherit;
                border: 1px solid rgba(148, 163, 184, 0.25);
                background: rgba(148, 163, 184, 0.08);
        }

        .timeline-row[data-done='true'] {
                border-color: rgba(16, 185, 129, 0.6);
                background: rgba(16, 185, 129, 0.1);
        }

        .timeline-icon {
                font-size: 1.5rem;
        }

        .timeline-text-block {
                display: flex;
                flex-direction: column;
                gap: 0.35rem;
        }

        .headline-row {
                display: flex;
                flex-wrap: wrap;
                gap: 0.3rem;
        }

        .checkpoint-name {
                font-weight: 600;
                font-size: 1rem;
        }

        .checkpoint-meta {
                font-size: 0.82rem;
                color: rgba(71, 85, 105, 0.7);
        }

        :global([data-theme='dark'] .checkpoint-meta),
        :global(:root:not([data-theme='light']) .checkpoint-meta) {
                color: rgba(203, 213, 225, 0.7);
        }

        .checkpoint-description {
                margin: 0;
                font-size: 0.9rem;
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
        }

        :global([data-theme='dark'] .checkpoint-description),
        :global(:root:not([data-theme='light']) .checkpoint-description) {
                color: rgba(203, 213, 225, 0.75);
        }

        .plan-footer {
                display: flex;
                justify-content: flex-end;
        }

        .plan-start {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.6rem 1.4rem;
                border-radius: 999px;
                font-weight: 600;
                font-size: 0.95rem;
                text-decoration: none;
                color: #fff;
                background: rgba(59, 130, 246, 0.85);
        }

        @media (max-width: 720px) {
                .dashboard {
                        gap: 1.2rem;
                        padding-top: 1rem;
                        padding-bottom: 1.5rem;
                }
        }
</style>
