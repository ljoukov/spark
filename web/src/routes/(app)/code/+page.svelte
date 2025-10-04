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
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap"
	/>
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
                        {#each timeline as item}
                                <a class="timeline-row" href={item.href} data-done={item.done}>
                                        <span class="timeline-emoji" aria-hidden="true">{item.icon}</span>
                                        <div class="timeline-text">
                                                <div class="timeline-title">
                                                        <span class="checkpoint-name">{item.title}</span>
                                                        {#if item.meta}
                                                                <span class="checkpoint-meta">{item.meta}</span>
                                                        {/if}
                                                </div>
                                                <p class="checkpoint-description">{item.description}</p>
                                        </div>
                                        {#if item.done}
                                                <span class="timeline-status" aria-label="Completed">✓</span>
                                        {:else}
                                                <span class="timeline-status" aria-hidden="true">•</span>
                                        {/if}
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
                gap: 1.5rem;
                padding: 1.5rem 0 2rem;
                max-width: 70rem;
                margin: 0 auto;
        }

        @media (min-width: 70rem) {
                .dashboard {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        align-items: start;
                }
        }

        .hero-card,
        .plan-card {
                border-radius: 1rem;
                background: var(--app-content-bg, #fff);
                border: 1px solid rgba(148, 163, 184, 0.2);
                padding: 1.5rem;
                display: flex;
                flex-direction: column;
                gap: 1rem;
        }

        .hero-title {
                margin: 0;
                font-size: 2.2rem;
                line-height: 1.1;
        }

        .hero-rocket {
                margin-left: 0.4rem;
                font-size: 2.2rem;
        }

        .hero-subtitle {
                margin: 0;
                font-size: 1rem;
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.7));
        }

        .stat-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 0.75rem;
        }

        .stat-chip {
                padding: 0.45rem 0.9rem;
                border-radius: 9999px;
                background: rgba(226, 232, 240, 0.4);
                font-size: 0.9rem;
                display: flex;
                gap: 0.35rem;
        }

        .chip-value {
                font-weight: 600;
        }

        .chip-label {
                color: rgba(71, 85, 105, 0.8);
        }

        .plan-header h2 {
                margin: 0;
                font-size: 1.5rem;
        }

        .plan-eyebrow {
                text-transform: uppercase;
                font-size: 0.75rem;
                letter-spacing: 0.08em;
                color: rgba(59, 130, 246, 0.8);
                margin: 0;
        }

        .plan-summary {
                margin: 0;
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.7));
                font-size: 0.95rem;
        }

        .plan-body {
                display: flex;
                flex-direction: column;
        }

        .timeline-row {
                display: grid;
                grid-template-columns: auto 1fr auto;
                gap: 0.75rem;
                padding: 0.85rem 0;
                text-decoration: none;
                color: inherit;
                border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        }

        .timeline-row:last-child {
                border-bottom: none;
        }

        .timeline-row[data-done='true'] .checkpoint-name {
                color: rgba(37, 99, 235, 0.9);
        }

        .timeline-emoji {
                font-size: 1.5rem;
                line-height: 1;
        }

        .timeline-text {
                display: flex;
                flex-direction: column;
                gap: 0.25rem;
        }

        .timeline-title {
                display: flex;
                flex-wrap: wrap;
                gap: 0.35rem;
                font-weight: 600;
        }

        .checkpoint-name {
                font-size: 1rem;
        }

        .checkpoint-meta {
                font-size: 0.85rem;
                color: rgba(71, 85, 105, 0.75);
        }

        .checkpoint-description {
                margin: 0;
                font-size: 0.9rem;
                color: var(--app-subtitle-color, rgba(30, 41, 59, 0.7));
        }

        .timeline-status {
                font-size: 1rem;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 1.5rem;
        }

        .plan-footer {
                display: flex;
                justify-content: flex-end;
        }

        .plan-start {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.6rem 1.2rem;
                border-radius: 9999px;
                background: rgba(37, 99, 235, 0.9);
                color: #fff;
                text-decoration: none;
                font-weight: 600;
        }

        @media (max-width: 48rem) {
                .hero-title {
                        font-size: 1.8rem;
                }

                .dashboard {
                        padding: 1rem 0 1.5rem;
                }
        }
</style>
