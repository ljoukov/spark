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
                <h1 class="hero-title">Welcome back, {firstName}! 🚀</h1>
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
                                        <span class="timeline-circle" data-done={item.done} aria-hidden="true">
                                                {#if item.done}
                                                        ✓
                                                {/if}
                                        </span>
                                        <div class="timeline-content">
                                                <span class="timeline-emoji" aria-hidden="true">{item.icon}</span>
                                                <div class="timeline-text">
                                                        <div class="timeline-title-row">
                                                                <span class="checkpoint-name">{item.title}</span>
                                                                {#if item.meta}
                                                                        <span class="checkpoint-meta">{item.meta}</span>
                                                                {/if}
                                                        </div>
                                                        <p class="checkpoint-description">{item.description}</p>
                                                </div>
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
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
                max-width: 64rem;
                margin: 0 auto 2.5rem;
                padding: 1.5rem 1rem 2.5rem;
        }

        @media (min-width: 80rem) {
                .dashboard {
                        flex-direction: row;
                        align-items: flex-start;
                }
        }

        .hero-card {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
                padding: 1.5rem;
                border-radius: 1.25rem;
                background: var(--app-surface, #ffffff);
                border: 1px solid rgba(148, 163, 184, 0.25);
        }

        .hero-title {
                margin: 0;
                font-size: 2rem;
                font-weight: 600;
                line-height: 1.1;
        }

        .hero-subtitle {
                margin: 0;
                font-size: 1rem;
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
        }

        .stat-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
        }

        .stat-chip {
                display: inline-flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 0.1rem;
                padding: 0.5rem 0.85rem;
                border-radius: 0.75rem;
                background: rgba(148, 163, 184, 0.12);
                font-size: 0.85rem;
                color: rgba(30, 41, 59, 0.85);
        }

        .chip-value {
                font-weight: 600;
        }

        .chip-label {
                font-size: 0.75rem;
        }

        .plan-card {
                display: flex;
                flex-direction: column;
                gap: 1.25rem;
                padding: 1.5rem;
                border-radius: 1.25rem;
                background: var(--app-surface, #ffffff);
                border: 1px solid rgba(148, 163, 184, 0.25);
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
        }

        .plan-header h2 {
                margin: 0;
                font-size: 1.5rem;
                font-weight: 600;
        }

        .plan-summary {
                margin: 0;
                font-size: 0.95rem;
                line-height: 1.5;
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
        }

        .plan-body {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
        }

        .timeline-row {
                display: flex;
                align-items: flex-start;
                gap: 0.75rem;
                padding: 0.75rem 0.25rem;
                border-radius: 0.75rem;
                text-decoration: none;
                color: inherit;
        }

        .timeline-row:focus-visible {
                outline: 2px solid rgba(59, 130, 246, 0.6);
                outline-offset: 2px;
        }

        .timeline-row:hover {
                background: rgba(59, 130, 246, 0.08);
        }

        .timeline-circle {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 1.75rem;
                height: 1.75rem;
                border-radius: 9999px;
                border: 2px solid rgba(59, 130, 246, 0.7);
                font-size: 0.9rem;
                background: var(--app-surface, #ffffff);
                flex-shrink: 0;
        }

        .timeline-circle[data-done='true'] {
                background: rgba(59, 130, 246, 0.85);
                color: #ffffff;
        }

        .timeline-content {
                display: flex;
                gap: 0.75rem;
                align-items: flex-start;
                flex: 1;
                min-width: 0;
        }

        .timeline-emoji {
                font-size: 1.5rem;
                line-height: 1;
        }

        .timeline-text {
                display: flex;
                flex-direction: column;
                gap: 0.35rem;
                min-width: 0;
        }

        .timeline-title-row {
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
                font-weight: 600;
        }

        .timeline-row[data-done='true'] .checkpoint-name {
                color: rgba(37, 99, 235, 0.9);
        }

        .checkpoint-name {
                font-size: 1rem;
        }

        .checkpoint-meta {
                font-size: 0.82rem;
                color: rgba(71, 85, 105, 0.75);
        }

        .checkpoint-description {
                margin: 0;
                font-size: 0.9rem;
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.75));
        }

        .plan-footer {
                display: flex;
                justify-content: flex-end;
        }

        .plan-start {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.65rem 1.4rem;
                border-radius: 9999px;
                font-weight: 600;
                font-size: 0.95rem;
                text-decoration: none;
                color: #ffffff;
                background: rgba(59, 130, 246, 0.85);
        }

        @media (max-width: 720px) {
                .dashboard {
                        padding-inline: 0.75rem;
                }
        }
</style>
