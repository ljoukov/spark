<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { adventBundles, type AdventSessionBundle } from '$lib/data/adventSessions';

	type AdventEntry = {
		day: number;
		emoji: string;
		title: string;
		hook: string;
		prompt: string;
		difficulty: 'Warm-up' | 'Standard' | 'Tricky' | 'Boss';
		reward?: string;
	};

	const adventDays = [
		{
			day: 1,
			emoji: '🎄',
			title: 'Snowy Sorting',
			hook: 'Can one swap tidy a gift line?',
			prompt:
				'Given an array of gift weights, decide if it can be sorted with at most one swap. Return the pair of indices or `-1 -1` if already sorted, otherwise report impossible.',
			difficulty: 'Warm-up'
		},
		{
			day: 2,
			emoji: '🍭',
			title: 'Candy Cane Pairs',
			hook: 'Find pairs that hit the target sweetness.',
			prompt:
				'Count unordered pairs whose sum equals K. Optimise for O(n log n) via sort + two pointers; return the count and one example pair if it exists.',
			difficulty: 'Warm-up'
		},
		{
			day: 3,
			emoji: '🧭',
			title: 'North Pole Network',
			hook: 'Spot the first workshop cycle.',
			prompt:
				'Tasks form a directed graph. Detect whether a cycle exists and, if so, output the lexicographically smallest cycle path. Aim for O(V+E) with DFS stack bookkeeping.',
			difficulty: 'Standard'
		},
		{
			day: 4,
			emoji: '🛷',
			title: 'Sleigh Packing',
			hook: 'Value-packed knapsack before take-off.',
			prompt:
				'Classic 0/1 knapsack: maximise total gift value without exceeding weight limit W. Return max value and one optimal item set using bottom-up DP.',
			difficulty: 'Standard'
		},
		{
			day: 5,
			emoji: '📅',
			title: 'Elf Shift Scheduler',
			hook: 'Pick the most non-overlapping shifts.',
			prompt:
				'Given intervals [start, end), choose the maximum number of non-overlapping shifts. Sort by end time and greedily select; return the chosen interval indices.',
			difficulty: 'Warm-up'
		},
		{
			day: 6,
			emoji: '🍪',
			title: 'Gingerbread Grid',
			hook: 'How many safe paths dodge the icing?',
			prompt:
				'Count paths from (0,0) to (m-1,n-1) in a grid with frosting obstacles (1=blocked). Move only right or down. Return count modulo 1e9+7 using DP.',
			difficulty: 'Standard'
		},
		{
			day: 7,
			emoji: '🔗',
			title: 'Ornament Ordering',
			hook: 'Untangle dependencies before hanging.',
			prompt:
				'Perform a topological sort on a DAG of ornament dependencies. If multiple orders are valid, output the lexicographically smallest; otherwise report that no ordering exists.',
			difficulty: 'Standard'
		},
		{
			day: 8,
			emoji: '💡',
			title: 'Lantern Lightshow',
			hook: 'Range toggles for fairy lights.',
			prompt:
				'You receive range toggle commands [l, r]. All lights start off. Apply all commands and output the final on/off array in O(n + q) using a difference array.',
			difficulty: 'Warm-up'
		},
		{
			day: 9,
			emoji: '🌨️',
			title: 'Blizzard Buffer',
			hook: 'Throttle deliveries with a monotonic queue.',
			prompt:
				'Design a queue that supports push, pop, and retrieving the minimum payload in O(1) amortised time. Implement using two stacks or a deque with stored mins.',
			difficulty: 'Standard'
		},
		{
			day: 10,
			emoji: '🧦',
			title: 'Chimney Cipher',
			hook: 'One edit away from a palindrome?',
			prompt:
				'Given a string, decide if it becomes a palindrome after deleting at most one character. Return true/false and the index to delete when possible.',
			difficulty: 'Warm-up'
		},
		{
			day: 11,
			emoji: '🦌',
			title: 'Reindeer Relay',
			hook: 'Shortest route with a single turbo.',
			prompt:
				'Weighted graph with an optional one-time turbo that halves one edge weight. Find the shortest path from S to T using Dijkstra with state for “turbo used?”.',
			difficulty: 'Tricky'
		},
		{
			day: 12,
			emoji: '🏝️',
			title: 'Igloo Islands',
			hook: 'Count frozen clusters.',
			prompt:
				'Grid of ice (1) and water (0). Count islands using BFS/DFS and return the size of the largest island. Treat diagonal cells as disconnected.',
			difficulty: 'Warm-up'
		},
		{
			day: 13,
			emoji: '✨',
			title: 'Frosted Fibonacci',
			hook: 'Memoise a triple-step climb.',
			prompt:
				'Number of ways to climb n steps taking 1, 2, or 3 at a time. Implement memoised recursion and an iterative DP, both modulo 1e9+7.',
			difficulty: 'Warm-up'
		},
		{
			day: 14,
			emoji: '📊',
			title: 'Stocking Scoreboard',
			hook: 'Live leaderboard ranks.',
			prompt:
				'Given existing scores (dense ranking) and a stream of new scores, output the rank after each insertion without re-sorting the entire array.',
			difficulty: 'Standard'
		},
		{
			day: 15,
			emoji: '🪞',
			title: 'Polar Palindrome',
			hook: 'Find the longest mirrored ribbon.',
			prompt:
				'Return the longest palindromic substring of s. Aim for O(n^2) expand-around-center; note how to upgrade to Manacher for O(n).',
			difficulty: 'Standard'
		},
		{
			day: 16,
			emoji: '🌌',
			title: 'Starlit Subarrays',
			hook: 'Max score streak under a cap.',
			prompt:
				'For non-negative array nums and limit K, count subarrays whose sum ≤ K using a sliding window. Return the total count and the longest such window.',
			difficulty: 'Standard'
		},
		{
			day: 17,
			emoji: '🪜',
			title: 'Workshop Wiring',
			hook: 'Connect stations with minimal sparkle.',
			prompt:
				'Compute the minimum spanning tree weight of an undirected graph (Prim or Kruskal). Return the edge list of the MST or “Impossible” if disconnected.',
			difficulty: 'Standard'
		},
		{
			day: 18,
			emoji: '🍫',
			title: 'Cocoa Cooling',
			hook: 'Keep temperature swings tiny.',
			prompt:
				'Find the longest subarray where (max - min) ≤ K. Maintain two deques for window max/min and slide the left pointer when the constraint breaks.',
			difficulty: 'Tricky'
		},
		{
			day: 19,
			emoji: '🏁',
			title: 'Sled Race Telemetry',
			hook: 'Stream the median at any time.',
			prompt:
				'Maintain a data structure that supports insert and retrieving the current median in O(log n) per update using two heaps.',
			difficulty: 'Standard'
		},
		{
			day: 20,
			emoji: '🎼',
			title: 'Aurora Alignment',
			hook: 'Recover the prettiest increasing melody.',
			prompt:
				'Return the length of the longest increasing subsequence and reconstruct one such sequence. Use patience sorting with parent pointers.',
			difficulty: 'Tricky'
		},
		{
			day: 21,
			emoji: '🌀',
			title: 'Cookie Conveyor',
			hook: 'Detect loops on the belt.',
			prompt:
				'Given an array of moves (positive = clockwise, negative = counter-clockwise), detect if a loop of length > 1 exists with consistent direction. Use fast/slow pointers.',
			difficulty: 'Standard'
		},
		{
			day: 22,
			emoji: '🧶',
			title: 'Gift Graph Coloring',
			hook: 'Seat feuding elves safely.',
			prompt:
				'Determine if an undirected graph is bipartite. If yes, return a valid 2-coloring; otherwise surface the odd cycle that breaks it.',
			difficulty: 'Standard'
		},
		{
			day: 23,
			emoji: '🕛',
			title: 'Midnight Mirror',
			hook: 'Balance brackets before the bell.',
			prompt:
				'Compute the minimum removals to make parentheses string valid, and output one valid string with that minimum using stack indices.',
			difficulty: 'Warm-up'
		},
		{
			day: 24,
			emoji: '🫧',
			title: 'Snowglobe Simulation',
			hook: 'Game of Life on a torus.',
			prompt:
				'Advance a finite grid by one generation of Conway’s Game of Life treating edges as wrapping (toroidal). Do it in-place with bit tricks or O(1) extra space.',
			difficulty: 'Tricky'
		},
		{
			day: 25,
			emoji: '🌟',
			title: 'North Star Finale',
			hook: 'Route every sleigh in one night.',
			prompt:
				'Design a planner that assigns M delivery sleighs to N cities with distances + gift loads. Minimise total time when each sleigh may restock once (two-leg TSP-lite). Outline the state, heuristics, and how you would code a branch-and-bound or min-cost-flow approximation.',
			difficulty: 'Boss',
			reward:
				'Spectacular prize: unlocks the “North Star” profile frame, a bonus XP cache, and a live code review slot with a Spark mentor.'
		}
] satisfies AdventEntry[];

	const bundleByDay = new Map<number, AdventSessionBundle>(
		adventBundles.map((bundle) => [bundle.day, bundle])
	);

	let { data }: { data: PageData } = $props();
	let today = $state(new Date(data.todayIso));
	const unlockedDay = $derived(Math.min(today.getDate(), adventDays.length));
	const progressPercent = $derived(Math.round((unlockedDay / adventDays.length) * 100));

	let selected = $state<AdventEntry | null>(null);
	const selectedBundle = $derived(selected ? bundleByDay.get(selected.day) : undefined);
	let lockedNudge = $state<number | null>(null);
	let copyFeedback = $state<'idle' | 'copied' | 'error'>('idle');

	function stateFor(day: number): 'locked' | 'today' | 'open' {
		if (day > unlockedDay) {
			return 'locked';
		}
		if (day === unlockedDay) {
			return 'today';
		}
		return 'open';
	}

	function cardTitle(day: number, fallback: string): string {
		return bundleByDay.get(day)?.session.title ?? fallback;
	}

	function cardHook(day: number, fallback: string): string {
		return bundleByDay.get(day)?.session.tagline ?? fallback;
	}

	function cardEmoji(day: number, fallback: string): string {
		return bundleByDay.get(day)?.session.emoji ?? fallback;
	}

	function handleSelect(entry: AdventEntry): void {
		if (entry.day > unlockedDay) {
			lockedNudge = entry.day;
			setTimeout(() => {
				if (lockedNudge === entry.day) {
					lockedNudge = null;
				}
			}, 650);
			return;
		}
		selected = entry;
		copyFeedback = 'idle';
	}

	onMount(() => {
		today = new Date();
	});

	async function handleLaunch(entry: AdventEntry): Promise<void> {
		if (entry.day > unlockedDay) {
			return;
		}
		const bundle = bundleByDay.get(entry.day);
		if (!bundle) {
			return;
		}
		try {
			const response = await fetch('/api/advent/launch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId: bundle.session.id, day: entry.day })
			});
			if (!response.ok) {
				throw new Error('Failed to launch advent session');
			}
			const payload = await response.json();
			const sessionId = payload.sessionId ?? bundle.session.id;
			await goto(`/code/${sessionId}`);
		} catch (error) {
			console.error('Unable to launch advent session', error);
		}
	}

	function closeDetail(): void {
		selected = null;
	}

	async function copyPrompt(entry: AdventEntry): Promise<void> {
		if (!entry) {
			return;
		}
		try {
			const bundle = bundleByDay.get(entry.day);
			if (bundle) {
				await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
			} else {
				await navigator.clipboard.writeText(`${entry.title} — ${entry.prompt}`);
			}
			copyFeedback = 'copied';
			setTimeout(() => {
				if (copyFeedback === 'copied') {
					copyFeedback = 'idle';
				}
			}, 1500);
		} catch (error) {
			console.error('Unable to copy prompt', error);
			copyFeedback = 'error';
		}
	}
</script>

<svelte:head>
	<title>Spark Code · Advent calendar</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap"
	/>
</svelte:head>

<section class="advent-page">
	<header class="hero">
		<div class="hero-pill">Events · Advent 25</div>
		<h1>Advent calendar for curious coders</h1>
		<p class="hero-subtitle">
			One fresh problem every day. Future doors stay frosted until their date—today is Day {unlockedDay}.
		</p>
		<div class="progress">
			<div class="progress-track" aria-hidden="true">
				<div class="progress-fill" style={`--progress:${progressPercent}%`}></div>
			</div>
			<div class="progress-copy">
				<span>{unlockedDay}/25 doors unlocked</span>
				<span class="muted">{progressPercent}% of the journey</span>
			</div>
		</div>
		<div class="legend">
			<span class="legend-chip open">Open</span>
			<span class="legend-chip today">Today</span>
			<span class="legend-chip locked">Locked</span>
		</div>
	</header>

	<div class="calendar">
		{#each adventDays as entry}
			<button
				type="button"
				class="calendar-card"
				data-state={stateFor(entry.day)}
				data-nudge={lockedNudge === entry.day}
				aria-pressed={selected?.day === entry.day}
				aria-label={`Day ${entry.day}: ${cardTitle(entry.day, entry.title)}`}
				onclick={() => handleSelect(entry)}
			>
				<div class="card-header">
					<span class="day-pill">Day {entry.day}</span>
					<span class="state-pill" data-state={stateFor(entry.day)}>
						{#if stateFor(entry.day) === 'locked'}
							Frosted
						{:else if stateFor(entry.day) === 'today'}
							Today
						{:else}
							Open
						{/if}
					</span>
				</div>
				<div class="emoji" aria-hidden="true">{cardEmoji(entry.day, entry.emoji)}</div>
				<div class="card-body">
					<h3>{cardTitle(entry.day, entry.title)}</h3>
					<p>{cardHook(entry.day, entry.hook)}</p>
				</div>
				<div class="card-footer">
					<span class="difficulty" data-level={entry.difficulty.toLowerCase()}>
						{entry.difficulty}
					</span>
					<span class="cta">
						{stateFor(entry.day) === 'locked' ? 'Locked' : 'Launch'}
					</span>
				</div>
				<div class="shine" aria-hidden="true"></div>
			</button>
		{/each}
	</div>

	{#if selected}
		<div class="detail-overlay" role="dialog" aria-label={`Day ${selected.day} details`}>
			<div class="detail-card">
				<button class="close" type="button" onclick={closeDetail} aria-label="Close details">
					×
				</button>
				<p class="eyebrow">Day {selected.day}</p>
		<h2>
			<span class="hero-emoji" aria-hidden="true">{cardEmoji(selected.day, selected.emoji)}</span>
			{cardTitle(selected.day, selected.title)}
		</h2>
				<p class="detail-hook">{cardHook(selected.day, selected.hook)}</p>
				{#if selectedBundle}
					<div class="session-meta">
						<p class="summary">{selectedBundle.session.summary}</p>
						{#if selectedBundle.session.topics}
							<div class="tags">
								{#each selectedBundle.session.topics as topic}
									<span class="tag">{topic}</span>
								{/each}
							</div>
						{/if}
					<div class="quiz-grid">
						{#each selectedBundle.quizzes as quiz}
							<div class="quiz-card">
								<p class="eyebrow small">{quiz.id}</p>
									<h4>{quiz.title}</h4>
									<p class="muted">{quiz.description}</p>
									<p class="count">{quiz.questions.length} questions · {quiz.topic ?? 'quiz'}</p>
								</div>
							{/each}
						</div>
						<div class="problem-grid">
							{#each selectedBundle.problems as problem}
								<div class="problem-card">
									<p class="eyebrow small">{problem.slug}</p>
									<h4>{problem.title}</h4>
									<p class="muted">{problem.topics.join(', ')}</p>
									<p class="pill problem-pill">{problem.difficulty}</p>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div class="detail-prompt">
						<p>{selected.prompt}</p>
					</div>
					<div class="tags">
						<span class="tag" data-level={selected.difficulty.toLowerCase()}>
							{selected.difficulty}
						</span>
						<span class="tag">No external links</span>
						{#if selected.day === unlockedDay}
							<span class="tag live">Today</span>
						{/if}
					</div>
					{#if selected.reward}
						<div class="prize">
							<span class="prize-emoji" aria-hidden="true">🎁</span>
							<div>
								<p class="prize-title">Spectacular prize</p>
								<p class="prize-copy">{selected.reward}</p>
							</div>
						</div>
					{/if}
				{/if}
				<div class="detail-actions">
					<button
						type="button"
						class="primary"
						aria-disabled={selected.day > unlockedDay}
						disabled={selected.day > unlockedDay}
						onclick={() => selected && handleLaunch(selected)}
					>
						Launch
					</button>
					<button type="button" class="ghost" onclick={closeDetail}>Close</button>
				</div>
			</div>
		</div>
	{/if}
</section>

<style lang="postcss">
	:global(body) {
		font-family:
			'Inter var', 'SF Pro Display', 'Inter', system-ui, -apple-system, BlinkMacSystemFont,
			'Segoe UI', sans-serif;
	}

	.advent-page {
		width: min(110rem, 96vw);
		margin: 0 auto clamp(2rem, 3vw, 2.8rem);
		padding-top: clamp(1.6rem, 3vw, 2.6rem);
		padding-bottom: clamp(1.6rem, 3vw, 2.6rem);
		display: flex;
		flex-direction: column;
		gap: clamp(1.6rem, 2.4vw, 2.2rem);
	}

	.hero {
		background: linear-gradient(135deg, rgba(255, 247, 237, 0.9), rgba(219, 234, 254, 0.9));
		border: 1px solid rgba(148, 163, 184, 0.25);
		box-shadow:
			0 32px 90px -50px rgba(15, 23, 42, 0.32),
			inset 0 0 0 1px rgba(255, 255, 255, 0.38);
		border-radius: clamp(1.6rem, 2vw, 2.2rem);
		padding: clamp(1.6rem, 2.8vw, 2.4rem);
		position: relative;
		overflow: hidden;
	}

	.hero::after,
	.hero::before {
		content: '';
		position: absolute;
		inset: -40% auto auto 60%;
		width: 42%;
		height: 140%;
		background: radial-gradient(circle at 30% 40%, rgba(59, 130, 246, 0.18), transparent 55%);
		rotate: -18deg;
		z-index: 0;
	}

	.hero::before {
		inset: auto auto -40% 24%;
		width: 28%;
		height: 120%;
		background: radial-gradient(circle at 70% 60%, rgba(244, 114, 182, 0.2), transparent 60%);
		rotate: 12deg;
	}

	.hero > * {
		position: relative;
		z-index: 1;
	}

	.hero-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.8);
		color: #fff;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.78rem;
		box-shadow: 0 18px 40px -20px rgba(15, 23, 42, 0.6);
	}

	.hero h1 {
		margin: 0.5rem 0 0.35rem;
		font-size: clamp(2rem, 3.6vw, 2.6rem);
		letter-spacing: -0.02em;
	}

	.hero-subtitle {
		margin: 0;
		max-width: 58ch;
		color: rgba(30, 41, 59, 0.78);
		font-size: 1.02rem;
		line-height: 1.6;
	}

	:global([data-theme='dark'] .hero),
	:global(:root:not([data-theme='light']) .hero) {
		background: linear-gradient(135deg, rgba(19, 26, 46, 0.9), rgba(17, 24, 39, 0.95));
		border-color: rgba(148, 163, 184, 0.35);
	}

	:global([data-theme='dark'] .hero-subtitle),
	:global(:root:not([data-theme='light']) .hero-subtitle) {
		color: rgba(226, 232, 240, 0.78);
	}

	.progress {
		margin-top: 1.1rem;
		display: grid;
		gap: 0.55rem;
	}

	.progress-track {
		position: relative;
		height: 12px;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.25);
		overflow: hidden;
	}

	.progress-fill {
		position: absolute;
		inset: 0 auto 0 0;
		width: var(--progress);
		max-width: 100%;
		background: linear-gradient(90deg, #f59e0b, #ef4444, #8b5cf6);
		border-radius: inherit;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22);
		transition: width 0.35s ease;
	}

	.progress-copy {
		display: flex;
		gap: 1rem;
		align-items: center;
		font-weight: 600;
	}

	.progress-copy .muted {
		color: rgba(71, 85, 105, 0.78);
		font-weight: 500;
	}

	:global([data-theme='dark'] .progress-copy .muted),
	:global(:root:not([data-theme='light']) .progress-copy .muted) {
		color: rgba(203, 213, 225, 0.75);
	}

	.legend {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.4rem;
	}

	.legend-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 999px;
		padding: 0.35rem 0.7rem;
		font-size: 0.88rem;
		font-weight: 600;
		border: 1px solid rgba(148, 163, 184, 0.3);
	}

	.legend-chip::before {
		content: '';
		width: 10px;
		height: 10px;
		border-radius: 50%;
		box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.3);
	}

	.legend-chip.open::before {
		background: #22c55e;
	}

	.legend-chip.today::before {
		background: #f59e0b;
	}

	.legend-chip.locked::before {
		background: #94a3b8;
	}

	.calendar {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: clamp(1rem, 1.8vw, 1.4rem);
	}

	.calendar-card {
		position: relative;
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: clamp(1rem, 2vw, 1.35rem);
		background: rgba(255, 255, 255, 0.82);
		box-shadow:
			0 22px 60px -40px rgba(15, 23, 42, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.6);
		padding: 1rem;
		display: grid;
		grid-template-rows: auto auto 1fr auto;
		gap: 0.6rem;
		cursor: pointer;
		overflow: hidden;
		transition:
			transform 0.2s ease,
			border-color 0.2s ease,
			box-shadow 0.25s ease,
			background 0.2s ease,
			filter 0.2s ease;
	}

	.calendar-card::before {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.55), transparent 45%);
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.calendar-card:hover,
	.calendar-card:focus-visible {
		transform: translateY(-6px) scale(1.01);
		border-color: rgba(59, 130, 246, 0.6);
		box-shadow: 0 30px 90px -50px rgba(59, 130, 246, 0.5);
		outline: none;
	}

	.calendar-card:hover::before,
	.calendar-card:focus-visible::before {
		opacity: 1;
	}

	.calendar-card:active {
		transform: translateY(-2px) scale(0.995);
	}

	.calendar-card[data-state='today'] {
		border-color: rgba(234, 179, 8, 0.75);
		box-shadow: 0 30px 90px -45px rgba(234, 179, 8, 0.55);
		background: linear-gradient(150deg, rgba(255, 247, 237, 0.95), rgba(255, 255, 255, 0.9));
	}

	.calendar-card[data-state='open'] {
		background: linear-gradient(160deg, rgba(240, 249, 255, 0.9), rgba(255, 255, 255, 0.95));
	}

	.calendar-card[data-state='locked'] {
		cursor: not-allowed;
		filter: grayscale(0.3);
		border-style: dashed;
		background: linear-gradient(160deg, rgba(226, 232, 240, 0.65), rgba(255, 255, 255, 0.85));
	}

	.calendar-card[data-nudge='true'] {
		animation: wobble 0.6s ease;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.day-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		background: rgba(59, 130, 246, 0.08);
		color: rgba(30, 41, 59, 0.9);
		font-weight: 700;
		font-size: 0.9rem;
		letter-spacing: 0.01em;
	}

	.state-pill {
		font-size: 0.8rem;
		font-weight: 700;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.35);
	}

	.state-pill[data-state='today'] {
		background: rgba(234, 179, 8, 0.16);
		border-color: rgba(234, 179, 8, 0.45);
		color: #a16207;
	}

	.state-pill[data-state='open'] {
		background: rgba(34, 197, 94, 0.12);
		border-color: rgba(34, 197, 94, 0.32);
		color: #15803d;
	}

	.state-pill[data-state='locked'] {
		background: rgba(148, 163, 184, 0.2);
		color: rgba(71, 85, 105, 0.9);
	}

	.emoji {
		font-size: clamp(2.8rem, 4vw, 3.5rem);
		line-height: 1;
		text-align: center;
		filter: drop-shadow(0 10px 22px rgba(15, 23, 42, 0.25));
	}

	.card-body h3 {
		margin: 0 0 0.25rem;
		font-size: 1.08rem;
		letter-spacing: -0.01em;
	}

	.card-body p {
		margin: 0;
		color: rgba(71, 85, 105, 0.9);
		font-size: 0.95rem;
		line-height: 1.5;
	}

	:global([data-theme='dark'] .card-body p),
	:global(:root:not([data-theme='light']) .card-body p) {
		color: rgba(226, 232, 240, 0.82);
	}

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.difficulty {
		font-weight: 700;
		font-size: 0.88rem;
		padding: 0.25rem 0.65rem;
		border-radius: 0.85rem;
		border: 1px solid rgba(148, 163, 184, 0.35);
	}

	.difficulty[data-level='warm-up'] {
		background: rgba(34, 197, 94, 0.12);
		color: #15803d;
		border-color: rgba(34, 197, 94, 0.32);
	}

	.difficulty[data-level='standard'] {
		background: rgba(59, 130, 246, 0.12);
		color: #1d4ed8;
		border-color: rgba(59, 130, 246, 0.32);
	}

	.difficulty[data-level='tricky'] {
		background: rgba(249, 115, 22, 0.14);
		color: #c2410c;
		border-color: rgba(249, 115, 22, 0.35);
	}

	.difficulty[data-level='boss'] {
		background: rgba(236, 72, 153, 0.15);
		color: #be185d;
		border-color: rgba(236, 72, 153, 0.38);
	}

	.cta {
		font-weight: 700;
		color: rgba(30, 41, 59, 0.78);
	}

	:global([data-theme='dark'] .cta),
	:global(:root:not([data-theme='light']) .cta) {
		color: rgba(226, 232, 240, 0.78);
	}

	.shine {
		position: absolute;
		inset: -40% -20%;
		background: linear-gradient(
			120deg,
			transparent 10%,
			rgba(255, 255, 255, 0.6) 50%,
			transparent 70%
		);
		transform: translateX(-120%);
		opacity: 0;
		pointer-events: none;
	}

	.calendar-card:active .shine,
	.calendar-card:focus-visible .shine {
		animation: shine 0.9s ease;
	}

	.detail-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.6);
		backdrop-filter: blur(14px) saturate(140%);
		display: grid;
		place-items: center;
		padding: 1rem;
		z-index: 12;
	}

	.detail-card {
		width: min(52rem, 90vw);
		background: radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.35), transparent 45%),
			radial-gradient(circle at 80% 10%, rgba(94, 234, 212, 0.2), transparent 40%),
			radial-gradient(circle at 60% 80%, rgba(244, 114, 182, 0.18), transparent 45%),
			rgba(255, 255, 255, 0.95);
		color: #0f172a;
		border-radius: 1.5rem;
		border: 1px solid rgba(148, 163, 184, 0.35);
		box-shadow: 0 40px 120px -60px rgba(15, 23, 42, 0.55);
		padding: clamp(1.5rem, 2.5vw, 2.2rem);
		position: relative;
		overflow: hidden;
	}

	:global([data-theme='dark'] .detail-card),
	:global(:root:not([data-theme='light']) .detail-card) {
		background: radial-gradient(circle at 20% 20%, rgba(59, 130, 246, 0.18), transparent 45%),
			radial-gradient(circle at 75% 18%, rgba(236, 72, 153, 0.18), transparent 45%),
			rgba(15, 23, 42, 0.92);
		color: #e2e8f0;
	}

	.close {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.35);
		background: rgba(255, 255, 255, 0.8);
		color: #0f172a;
		font-size: 1.2rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 14px 30px -18px rgba(15, 23, 42, 0.5);
		transition: transform 0.15s ease;
	}

	:global([data-theme='dark'] .close),
	:global(:root:not([data-theme='light']) .close) {
		background: rgba(17, 24, 39, 0.9);
		color: #e2e8f0;
	}

	.close:hover {
		transform: scale(1.06);
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(59, 130, 246, 0.85);
		font-weight: 700;
		margin: 0 0 0.35rem;
	}

	.detail-card h2 {
		margin: 0 0 0.4rem;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: clamp(1.6rem, 3vw, 2rem);
	}

	.detail-card h2 span[aria-hidden='true'] {
		font-size: clamp(1.8rem, 3.4vw, 2.4rem);
	}

	.detail-hook {
		margin: 0 0 0.6rem;
		color: rgba(71, 85, 105, 0.9);
		font-weight: 600;
	}

	:global([data-theme='dark'] .detail-hook),
	:global(:root:not([data-theme='light']) .detail-hook) {
		color: rgba(226, 232, 240, 0.82);
	}

	.detail-prompt {
		border-radius: 1rem;
		padding: 1rem 1.1rem;
		background: rgba(148, 163, 184, 0.12);
		border: 1px solid rgba(148, 163, 184, 0.2);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
	}

	:global([data-theme='dark'] .detail-prompt),
	:global(:root:not([data-theme='light']) .detail-prompt) {
		background: rgba(15, 23, 42, 0.7);
		border-color: rgba(148, 163, 184, 0.25);
	}

	.detail-prompt p {
		margin: 0;
		line-height: 1.65;
		font-size: 1.02rem;
	}

	.tags {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0.8rem 0;
	}

	.tag {
		padding: 0.4rem 0.75rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.35);
		font-weight: 700;
		font-size: 0.9rem;
	}

	.tag[data-level='warm-up'] {
		background: rgba(34, 197, 94, 0.12);
		color: #15803d;
	}

	.tag[data-level='standard'] {
		background: rgba(59, 130, 246, 0.12);
		color: #1d4ed8;
	}

	.tag[data-level='tricky'] {
		background: rgba(249, 115, 22, 0.14);
		color: #c2410c;
	}

	.tag[data-level='boss'] {
		background: rgba(236, 72, 153, 0.18);
		color: #be185d;
	}

	.tag.live {
		background: rgba(234, 179, 8, 0.16);
		color: #a16207;
		border-color: rgba(234, 179, 8, 0.45);
	}

	.prize {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 0.7rem;
		border-radius: 1rem;
		padding: 0.9rem 1rem;
		background: linear-gradient(120deg, rgba(255, 237, 213, 0.9), rgba(250, 232, 255, 0.85));
		border: 1px solid rgba(234, 179, 8, 0.4);
		box-shadow: 0 20px 50px -30px rgba(234, 179, 8, 0.35);
	}

	.prize-emoji {
		font-size: 1.8rem;
	}

	.prize-title {
		margin: 0;
		font-weight: 800;
		letter-spacing: 0.01em;
	}

	.prize-copy {
		margin: 0.1rem 0 0;
		color: rgba(71, 85, 105, 0.9);
	}

	.detail-actions {
		display: flex;
		gap: 0.8rem;
		flex-wrap: wrap;
		justify-content: flex-end;
		margin-top: 1rem;
	}

	.detail-actions button {
		border-radius: 0.9rem;
		padding: 0.75rem 1.2rem;
		font-weight: 700;
		border: 1px solid rgba(148, 163, 184, 0.35);
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease,
			border-color 0.2s ease,
			background 0.2s ease;
	}

	.detail-actions button:hover {
		transform: translateY(-2px);
	}

	.detail-actions .ghost {
		background: rgba(255, 255, 255, 0.85);
	}

	.detail-actions .primary {
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: #fff;
		border-color: transparent;
		box-shadow: 0 18px 45px -25px rgba(99, 102, 241, 0.5);
	}

	.session-meta {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: 0.5rem;
	}

	.summary {
		margin: 0;
		color: rgba(71, 85, 105, 0.88);
	}

	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.2);
		border: 1px solid rgba(148, 163, 184, 0.3);
		font-weight: 700;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.quiz-grid,
	.problem-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem;
	}

	.quiz-card,
	.problem-card {
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 0.9rem;
		padding: 0.8rem;
		background: rgba(255, 255, 255, 0.85);
	}

	.hero-emoji {
		font-size: clamp(3.2rem, 6vw, 4.6rem);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		margin-right: 0.35rem;
		filter: drop-shadow(0 12px 24px rgba(15, 23, 42, 0.25));
	}

	.problem-card .problem-pill {
		margin-top: 0.4rem;
		text-transform: capitalize;
	}

	.eyebrow.small {
		font-size: 0.68rem;
	}

	.count {
		margin: 0.2rem 0 0;
		font-weight: 700;
	}

	@keyframes wobble {
		0% {
			transform: translateY(0);
		}
		20% {
			transform: translateY(-4px) rotate(-2deg);
		}
		50% {
			transform: translateY(3px) rotate(2deg);
		}
		80% {
			transform: translateY(-2px) rotate(-1deg);
		}
		100% {
			transform: translateY(0);
		}
	}

	@keyframes shine {
		to {
			transform: translateX(120%);
			opacity: 0;
		}
	}

	@media (max-width: 720px) {
		.calendar-card {
			grid-template-rows: auto auto auto auto;
		}

		.detail-card {
			width: min(36rem, 100%);
		}
	}
</style>
