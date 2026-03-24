<script lang="ts">
	/**
	 * Match Pairs – Connect with Lines
	 *
	 * Two columns: terms on the left, definitions on the right (shuffled).
	 * Tap a term, then tap a definition — an SVG line is drawn between them.
	 * Tap a connected term to remove its line. Completed pairs glow green.
	 *
	 * The SVG overlay sits above the two columns so lines cross naturally.
	 * Mobile: columns stack narrower, lines still render with bezier curves.
	 */

	import { tick } from 'svelte';

	type Pair = { term: string; match: string };

	type Connection = {
		termIndex: number;
		matchIndex: number;
		color: string;
	};

	let {
		pairs,
		accentColor = '#2E6DA4'
	}: {
		pairs: Pair[];
		accentColor?: string;
	} = $props();

	const LINE_COLORS = ['#2E6DA4', '#9b59b6', '#e67e22', '#16a085', '#e74c3c', '#2980b9'];

	function shuffleIndices(length: number): number[] {
		const indices = Array.from({ length }, (_, i) => i);
		for (let i = indices.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[indices[i], indices[j]] = [indices[j], indices[i]];
		}
		return indices;
	}

	const pairCount = pairs.length;
	let shuffledMatchIndices = $state(shuffleIndices(pairCount));
	let selectedTermIndex = $state<number | null>(null);
	let connections = $state<Connection[]>([]);
	let containerEl = $state<HTMLDivElement | null>(null);
	let termEls = $state<(HTMLButtonElement | null)[]>(Array(pairCount).fill(null));
	let matchEls = $state<(HTMLButtonElement | null)[]>(Array(pairCount).fill(null));
	let svgLines = $state<
		{ x1: number; y1: number; x2: number; y2: number; color: string; key: string }[]
	>([]);

	function getTermConnection(termIndex: number): Connection | null {
		return connections.find((c) => c.termIndex === termIndex) ?? null;
	}

	function getMatchConnection(matchIndex: number): Connection | null {
		return connections.find((c) => c.matchIndex === matchIndex) ?? null;
	}

	function handleTermTap(termIndex: number): void {
		const existing = getTermConnection(termIndex);
		if (existing) {
			connections = connections.filter((c) => c.termIndex !== termIndex);
			selectedTermIndex = null;
			void tick().then(recalcLines);
			return;
		}

		if (selectedTermIndex === termIndex) {
			selectedTermIndex = null;
			return;
		}

		selectedTermIndex = termIndex;
	}

	function handleMatchTap(matchIndex: number): void {
		if (selectedTermIndex === null) {
			return;
		}

		const existingOnMatch = getMatchConnection(matchIndex);
		if (existingOnMatch) {
			connections = connections.filter((c) => c.matchIndex !== matchIndex);
		}

		const color = LINE_COLORS[connections.length % LINE_COLORS.length];
		connections = [
			...connections.filter((c) => c.termIndex !== selectedTermIndex),
			{ termIndex: selectedTermIndex, matchIndex, color }
		];
		selectedTermIndex = null;
		void tick().then(recalcLines);
	}

	function recalcLines(): void {
		if (!containerEl) {
			return;
		}
		const containerRect = containerEl.getBoundingClientRect();
		const nextLines: typeof svgLines = [];

		for (const conn of connections) {
			const termEl = termEls[conn.termIndex];
			const matchShuffledPos = shuffledMatchIndices.indexOf(conn.matchIndex);
			const matchEl = matchEls[matchShuffledPos];
			if (!termEl || !matchEl) {
				continue;
			}

			const termRect = termEl.getBoundingClientRect();
			const matchRect = matchEl.getBoundingClientRect();

			nextLines.push({
				x1: termRect.right - containerRect.left,
				y1: termRect.top + termRect.height / 2 - containerRect.top,
				x2: matchRect.left - containerRect.left,
				y2: matchRect.top + matchRect.height / 2 - containerRect.top,
				color: conn.color,
				key: `${conn.termIndex}-${conn.matchIndex}`
			});
		}

		svgLines = nextLines;
	}

	function handleReset(): void {
		shuffledMatchIndices = shuffleIndices(pairs.length);
		selectedTermIndex = null;
		connections = [];
		svgLines = [];
	}

	const allConnected = $derived(connections.length === pairs.length);

	$effect(() => {
		if (typeof window === 'undefined' || !containerEl) {
			return;
		}
		const observer = new ResizeObserver(() => {
			recalcLines();
		});
		observer.observe(containerEl);
		return () => {
			observer.disconnect();
		};
	});
</script>

<div class="match-lines" style={`--line-accent:${accentColor}`}>
	{#if allConnected}
		<div class="match-lines__done">
			<span class="match-lines__done-icon">✓</span>
			<span class="match-lines__done-label">All pairs connected!</span>
			<button type="button" class="match-lines__reset" onclick={handleReset}>Try again</button>
		</div>
	{/if}

	<div class="match-lines__container" bind:this={containerEl}>
		<svg class="match-lines__svg" aria-hidden="true">
			{#each svgLines as line (line.key)}
				{@const cx1 = line.x1 + (line.x2 - line.x1) * 0.35}
				{@const cx2 = line.x1 + (line.x2 - line.x1) * 0.65}
				<path
					d={`M ${line.x1} ${line.y1} C ${cx1} ${line.y1}, ${cx2} ${line.y2}, ${line.x2} ${line.y2}`}
					fill="none"
					stroke={line.color}
					stroke-width="2.5"
					stroke-linecap="round"
					opacity="0.7"
				/>
				<circle cx={line.x1} cy={line.y1} r="4" fill={line.color} opacity="0.8" />
				<circle cx={line.x2} cy={line.y2} r="4" fill={line.color} opacity="0.8" />
			{/each}
		</svg>

		<div class="match-lines__column match-lines__column--terms">
			{#each pairs as pair, i (`term-${i}`)}
				{@const isSelected = selectedTermIndex === i}
				{@const conn = getTermConnection(i)}

				<button
					type="button"
					class="match-lines__item match-lines__item--term"
					class:is-selected={isSelected}
					class:is-connected={conn !== null}
					style={conn ? `border-color:${conn.color}` : ''}
					bind:this={termEls[i]}
					onclick={() => {
						handleTermTap(i);
					}}
				>
					{pair.term}
				</button>
			{/each}
		</div>

		<div class="match-lines__column match-lines__column--matches">
			{#each shuffledMatchIndices as originalIndex, displayIndex (`match-${displayIndex}`)}
				{@const pair = pairs[originalIndex]}
				{@const conn = getMatchConnection(originalIndex)}

				<button
					type="button"
					class="match-lines__item match-lines__item--match"
					class:is-connected={conn !== null}
					class:is-armed={selectedTermIndex !== null && !conn}
					style={conn ? `border-color:${conn.color}` : ''}
					disabled={selectedTermIndex === null && !conn}
					bind:this={matchEls[displayIndex]}
					onclick={() => {
						handleMatchTap(originalIndex);
					}}
				>
					{pair.match}
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.match-lines {
		--line-accent: #2e6da4;
		font-family: Georgia, 'Times New Roman', serif;
	}

	.match-lines__container {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 32px;
	}

	.match-lines__svg {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 1;
	}

	.match-lines__column {
		display: flex;
		flex-direction: column;
		gap: 8px;
		position: relative;
		z-index: 2;
	}

	.match-lines__item {
		display: flex;
		align-items: center;
		min-height: 46px;
		border: 2px solid #d4d4d8;
		border-radius: 8px;
		background: #fafafa;
		padding: 10px 14px;
		font-family: inherit;
		font-size: 14px;
		line-height: 1.4;
		color: #1a1a2e;
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: left;
	}

	:global([data-theme='dark']) .match-lines__item {
		background: #1d1934;
		border-color: #3a3258;
		color: #e4dff5;
	}

	.match-lines__item--term {
		font-weight: 700;
	}

	.match-lines__item.is-selected {
		border-color: var(--line-accent);
		background: color-mix(in srgb, var(--line-accent) 12%, #ffffff);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--line-accent) 25%, transparent);
	}

	:global([data-theme='dark']) .match-lines__item.is-selected {
		background: color-mix(in srgb, var(--line-accent) 20%, #1d1934);
	}

	.match-lines__item.is-connected {
		background: color-mix(in srgb, var(--line-accent) 6%, #ffffff);
	}

	:global([data-theme='dark']) .match-lines__item.is-connected {
		background: color-mix(in srgb, var(--line-accent) 14%, #1d1934);
	}

	.match-lines__item.is-armed {
		border-style: dashed;
		border-color: var(--line-accent);
	}

	.match-lines__item:disabled:not(.is-connected) {
		opacity: 0.5;
		cursor: default;
	}

	.match-lines__item:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	.match-lines__done {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
		padding: 10px 14px;
		border-radius: 10px;
		background: color-mix(in srgb, #22a66e 12%, #ffffff);
		border: 1.5px solid #22a66e;
		font-size: 14px;
		color: #1a8c5b;
		font-weight: 600;
	}

	:global([data-theme='dark']) .match-lines__done {
		background: color-mix(in srgb, #22a66e 22%, #1d1934);
		color: #86efac;
	}

	.match-lines__done-icon {
		font-size: 18px;
		font-weight: 800;
	}

	.match-lines__done-label {
		flex: 1;
	}

	.match-lines__reset {
		padding: 4px 12px;
		border: 1.5px solid currentColor;
		border-radius: 6px;
		background: transparent;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
	}

	@media (max-width: 600px) {
		.match-lines__container {
			gap: 16px;
		}

		.match-lines__item {
			font-size: 13px;
			padding: 8px 10px;
			min-height: 42px;
		}
	}
</style>
