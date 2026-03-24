<script lang="ts">
	/**
	 * Match Pairs – Tap Tiles (Duolingo-style)
	 *
	 * All terms and definitions are shuffled into a flat grid of equal-sized tiles.
	 * The student taps any tile, then taps its match. Correct pairs highlight in the
	 * theme accent and shrink away. Wrong pairs flash and reset.
	 *
	 * Mobile-first: the grid is 2-col on narrow screens, 3-col on wider ones.
	 * No drag, no two-column cognitive load — just tap-tap.
	 */

	type Pair = { term: string; match: string };

	type TileKind = 'term' | 'match';

	type Tile = {
		id: string;
		label: string;
		kind: TileKind;
		pairIndex: number;
	};

	type TileStatus = 'idle' | 'selected' | 'matched' | 'wrong';

	let {
		pairs,
		accentColor = '#2E6DA4'
	}: {
		pairs: Pair[];
		accentColor?: string;
	} = $props();

	function shuffle<T>(arr: T[]): T[] {
		const copy = [...arr];
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[copy[i], copy[j]] = [copy[j], copy[i]];
		}
		return copy;
	}

	function buildTiles(pairs: Pair[]): Tile[] {
		const tiles: Tile[] = [];
		for (let i = 0; i < pairs.length; i++) {
			tiles.push({ id: `term-${i}`, label: pairs[i].term, kind: 'term', pairIndex: i });
			tiles.push({ id: `match-${i}`, label: pairs[i].match, kind: 'match', pairIndex: i });
		}
		return shuffle(tiles);
	}

	const initialPairs = pairs;
	let tiles = $state(buildTiles(initialPairs));
	let statuses = $state<Record<string, TileStatus>>(
		Object.fromEntries(tiles.map((t) => [t.id, 'idle']))
	);
	let selectedTileId = $state<string | null>(null);
	let matchedCount = $state(0);
	let wrongPair = $state<[string, string] | null>(null);

	function getStatus(id: string): TileStatus {
		return statuses[id] ?? 'idle';
	}

	function handleTap(tile: Tile): void {
		if (getStatus(tile.id) === 'matched' || wrongPair !== null) {
			return;
		}

		if (selectedTileId === null) {
			selectedTileId = tile.id;
			statuses = { ...statuses, [tile.id]: 'selected' };
			return;
		}

		if (selectedTileId === tile.id) {
			selectedTileId = null;
			statuses = { ...statuses, [tile.id]: 'idle' };
			return;
		}

		const selectedTile = tiles.find((t) => t.id === selectedTileId)!;

		if (selectedTile.kind === tile.kind) {
			statuses = { ...statuses, [selectedTileId]: 'idle', [tile.id]: 'selected' };
			selectedTileId = tile.id;
			return;
		}

		if (selectedTile.pairIndex === tile.pairIndex) {
			statuses = {
				...statuses,
				[selectedTileId]: 'matched',
				[tile.id]: 'matched'
			};
			selectedTileId = null;
			matchedCount += 1;
		} else {
			const prev = selectedTileId;
			wrongPair = [prev, tile.id];
			statuses = { ...statuses, [prev]: 'wrong', [tile.id]: 'wrong' };
			selectedTileId = null;
			setTimeout(() => {
				statuses = { ...statuses, [prev]: 'idle', [tile.id]: 'idle' };
				wrongPair = null;
			}, 600);
		}
	}

	function handleReset(): void {
		tiles = buildTiles(pairs);
		statuses = Object.fromEntries(tiles.map((t) => [t.id, 'idle']));
		selectedTileId = null;
		matchedCount = 0;
		wrongPair = null;
	}

	const allMatched = $derived(matchedCount === pairs.length);
</script>

<div class="match-tiles" style={`--tile-accent:${accentColor}`}>
	{#if allMatched}
		<div class="match-tiles__done">
			<span class="match-tiles__done-icon">✓</span>
			<span class="match-tiles__done-label">All pairs matched!</span>
			<button type="button" class="match-tiles__reset" onclick={handleReset}>Try again</button>
		</div>
	{/if}

	<div class="match-tiles__grid" class:is-done={allMatched}>
		{#each tiles as tile (tile.id)}
			{@const status = getStatus(tile.id)}

			<button
				type="button"
				class="match-tiles__tile"
				class:is-term={tile.kind === 'term'}
				class:is-match={tile.kind === 'match'}
				class:is-selected={status === 'selected'}
				class:is-matched={status === 'matched'}
				class:is-wrong={status === 'wrong'}
				disabled={status === 'matched'}
				onclick={() => {
					handleTap(tile);
				}}
			>
				<span class="match-tiles__kind-dot"></span>
				<span class="match-tiles__label">{tile.label}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.match-tiles {
		--tile-accent: #2e6da4;
		--tile-bg: #fafafa;
		--tile-border: #d4d4d8;
		--tile-text: #1a1a2e;
		--tile-term-dot: var(--tile-accent);
		--tile-match-dot: #9b59b6;
		--tile-selected-bg: color-mix(in srgb, var(--tile-accent) 12%, #ffffff);
		--tile-selected-border: var(--tile-accent);
		--tile-matched-bg: color-mix(in srgb, #22a66e 12%, #ffffff);
		--tile-matched-border: #22a66e;
		--tile-matched-text: #1a8c5b;
		--tile-wrong-bg: color-mix(in srgb, #ef4444 10%, #ffffff);
		--tile-wrong-border: #ef4444;
		font-family: Georgia, 'Times New Roman', serif;
	}

	:global([data-theme='dark']) .match-tiles {
		--tile-bg: #1d1934;
		--tile-border: #3a3258;
		--tile-text: #e4dff5;
		--tile-selected-bg: color-mix(in srgb, var(--tile-accent) 20%, #1d1934);
		--tile-matched-bg: color-mix(in srgb, #22a66e 22%, #1d1934);
		--tile-matched-text: #86efac;
		--tile-wrong-bg: color-mix(in srgb, #ef4444 18%, #1d1934);
	}

	.match-tiles__grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		transition: opacity 0.3s ease;
	}

	.match-tiles__grid.is-done {
		opacity: 0.35;
		pointer-events: none;
	}

	.match-tiles__tile {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 48px;
		border: 2px solid var(--tile-border);
		border-radius: 10px;
		background: var(--tile-bg);
		padding: 10px 12px;
		font-family: inherit;
		font-size: 14px;
		line-height: 1.4;
		color: var(--tile-text);
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: left;
	}

	.match-tiles__tile:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.match-tiles__tile:active:not(:disabled) {
		transform: scale(0.97);
	}

	.match-tiles__tile.is-selected {
		border-color: var(--tile-selected-border);
		background: var(--tile-selected-bg);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--tile-accent) 25%, transparent);
	}

	.match-tiles__tile.is-matched {
		border-color: var(--tile-matched-border);
		background: var(--tile-matched-bg);
		color: var(--tile-matched-text);
		opacity: 0.7;
		cursor: default;
	}

	.match-tiles__tile.is-wrong {
		border-color: var(--tile-wrong-border);
		background: var(--tile-wrong-bg);
		animation: tile-shake 0.4s ease-in-out;
	}

	.match-tiles__kind-dot {
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: 999px;
	}

	.match-tiles__tile.is-term .match-tiles__kind-dot {
		background: var(--tile-term-dot);
	}

	.match-tiles__tile.is-match .match-tiles__kind-dot {
		background: var(--tile-match-dot);
	}

	.match-tiles__tile.is-matched .match-tiles__kind-dot {
		background: var(--tile-matched-border);
	}

	.match-tiles__label {
		flex: 1;
		min-width: 0;
	}

	.match-tiles__done {
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

	:global([data-theme='dark']) .match-tiles__done {
		background: color-mix(in srgb, #22a66e 22%, #1d1934);
		color: #86efac;
	}

	.match-tiles__done-icon {
		font-size: 18px;
		font-weight: 800;
	}

	.match-tiles__done-label {
		flex: 1;
	}

	.match-tiles__reset {
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

	@keyframes tile-shake {
		0%,
		100% {
			transform: translateX(0);
		}
		20% {
			transform: translateX(-4px);
		}
		40% {
			transform: translateX(4px);
		}
		60% {
			transform: translateX(-3px);
		}
		80% {
			transform: translateX(2px);
		}
	}

	@media (max-width: 600px) {
		.match-tiles__grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
