<script lang="ts">
	/**
	 * Match Pairs – Drag to Reorder
	 *
	 * Terms are fixed on the left. Definitions are on the right in a shuffled
	 * order. The student drags (or taps ▲/▼ on mobile) definitions to reorder
	 * them so each definition aligns horizontally with its matching term.
	 *
	 * Once the student submits, correct rows highlight green, incorrect ones
	 * highlight orange. Very intuitive on mobile — no two-step tap required.
	 */

	type Pair = { term: string; match: string };

	type RowStatus = 'idle' | 'correct' | 'incorrect';

	let {
		pairs,
		accentColor = '#2E6DA4'
	}: {
		pairs: Pair[];
		accentColor?: string;
	} = $props();

	function shuffleArray<T>(arr: T[]): T[] {
		const copy = [...arr];
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[copy[i], copy[j]] = [copy[j], copy[i]];
		}
		return copy;
	}

	const initialMatches = pairs.map((p) => p.match);
	const initialRowCount = pairs.length;
	let matchOrder = $state<string[]>(shuffleArray(initialMatches));
	let rowStatuses = $state<RowStatus[]>(Array.from({ length: initialRowCount }, () => 'idle'));
	let checked = $state(false);
	let dragIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	function moveItem(fromIndex: number, toIndex: number): void {
		if (fromIndex === toIndex || checked) {
			return;
		}
		const next = [...matchOrder];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved);
		matchOrder = next;
	}

	function handleDragStart(index: number, event: DragEvent): void {
		if (checked) {
			return;
		}
		dragIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(index));
		}
	}

	function handleDragOver(index: number, event: DragEvent): void {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		dragOverIndex = index;
	}

	function handleDrop(index: number, event: DragEvent): void {
		event.preventDefault();
		if (dragIndex !== null) {
			moveItem(dragIndex, index);
		}
		dragIndex = null;
		dragOverIndex = null;
	}

	function handleDragEnd(): void {
		dragIndex = null;
		dragOverIndex = null;
	}

	function moveUp(index: number): void {
		if (index > 0 && !checked) {
			moveItem(index, index - 1);
		}
	}

	function moveDown(index: number): void {
		if (index < matchOrder.length - 1 && !checked) {
			moveItem(index, index + 1);
		}
	}

	function handleCheck(): void {
		const nextStatuses: RowStatus[] = [];
		for (let i = 0; i < pairs.length; i++) {
			nextStatuses.push(matchOrder[i] === pairs[i].match ? 'correct' : 'incorrect');
		}
		rowStatuses = nextStatuses;
		checked = true;
	}

	function handleReset(): void {
		matchOrder = shuffleArray(pairs.map((p) => p.match));
		rowStatuses = pairs.map(() => 'idle');
		checked = false;
		dragIndex = null;
		dragOverIndex = null;
	}

	const correctCount = $derived(rowStatuses.filter((s) => s === 'correct').length);
	const allCorrect = $derived(checked && correctCount === pairs.length);
</script>

<div class="match-reorder" style={`--reorder-accent:${accentColor}`}>
	{#if checked}
		<div class="match-reorder__result" class:is-perfect={allCorrect}>
			<span class="match-reorder__result-icon">{allCorrect ? '✓' : '✎'}</span>
			<span class="match-reorder__result-label">
				{#if allCorrect}
					Perfect — all pairs aligned!
				{:else}
					{correctCount} of {pairs.length} correct. Reorder the orange rows.
				{/if}
			</span>
			<button type="button" class="match-reorder__reset" onclick={handleReset}>
				{allCorrect ? 'Try again' : 'Reset'}
			</button>
		</div>
	{/if}

	<div class="match-reorder__table">
		<div class="match-reorder__header">
			<div class="match-reorder__header-cell">Term</div>
			<div class="match-reorder__header-cell">Definition — drag to reorder</div>
		</div>

		{#each pairs as pair, i (`row-${i}`)}
			{@const status = rowStatuses[i]}

			<div
				class="match-reorder__row"
				class:is-correct={status === 'correct'}
				class:is-incorrect={status === 'incorrect'}
				class:is-drag-over={dragOverIndex === i && dragIndex !== i}
			>
				<div class="match-reorder__term">
					<span class="match-reorder__term-number">{i + 1}</span>
					<span class="match-reorder__term-label">{pair.term}</span>
				</div>

				<div
					class="match-reorder__match"
					draggable={!checked}
					ondragstart={(e) => {
						handleDragStart(i, e);
					}}
					ondragover={(e) => {
						handleDragOver(i, e);
					}}
					ondrop={(e) => {
						handleDrop(i, e);
					}}
					ondragend={handleDragEnd}
					role="listitem"
				>
					<span class="match-reorder__grip" aria-hidden="true">⠿</span>
					<span class="match-reorder__match-label">{matchOrder[i]}</span>

					{#if !checked}
						<span class="match-reorder__arrows">
							<button
								type="button"
								class="match-reorder__arrow"
								disabled={i === 0}
								onclick={() => {
									moveUp(i);
								}}
								aria-label="Move up"
							>
								▲
							</button>
							<button
								type="button"
								class="match-reorder__arrow"
								disabled={i === pairs.length - 1}
								onclick={() => {
									moveDown(i);
								}}
								aria-label="Move down"
							>
								▼
							</button>
						</span>
					{/if}

					{#if status === 'correct'}
						<span class="match-reorder__status-icon">✓</span>
					{:else if status === 'incorrect'}
						<span class="match-reorder__status-icon match-reorder__status-icon--wrong">✗</span>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	{#if !checked}
		<div class="match-reorder__actions">
			<button type="button" class="match-reorder__check" onclick={handleCheck}>
				Check alignment
			</button>
		</div>
	{/if}
</div>

<style>
	.match-reorder {
		--reorder-accent: #2e6da4;
		font-family: Georgia, 'Times New Roman', serif;
	}

	.match-reorder__table {
		border: 1.5px solid #d4d4d8;
		border-radius: 10px;
		overflow: hidden;
	}

	:global([data-theme='dark']) .match-reorder__table {
		border-color: #3a3258;
	}

	.match-reorder__header {
		display: grid;
		grid-template-columns: 1fr 1fr;
		background: color-mix(in srgb, var(--reorder-accent) 10%, #fafafa);
		border-bottom: 1.5px solid #d4d4d8;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--reorder-accent);
	}

	:global([data-theme='dark']) .match-reorder__header {
		background: color-mix(in srgb, var(--reorder-accent) 16%, #1d1934);
		border-bottom-color: #3a3258;
	}

	.match-reorder__header-cell {
		padding: 8px 14px;
	}

	.match-reorder__row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border-bottom: 1px solid #ebebeb;
		transition: background 0.2s ease;
	}

	:global([data-theme='dark']) .match-reorder__row {
		border-bottom-color: #302850;
	}

	.match-reorder__row:last-child {
		border-bottom: 0;
	}

	.match-reorder__row.is-correct {
		background: color-mix(in srgb, #22a66e 10%, #ffffff);
	}

	:global([data-theme='dark']) .match-reorder__row.is-correct {
		background: color-mix(in srgb, #22a66e 18%, #1d1934);
	}

	.match-reorder__row.is-incorrect {
		background: color-mix(in srgb, #e67e22 10%, #ffffff);
	}

	:global([data-theme='dark']) .match-reorder__row.is-incorrect {
		background: color-mix(in srgb, #e67e22 18%, #1d1934);
	}

	.match-reorder__row.is-drag-over {
		background: color-mix(in srgb, var(--reorder-accent) 10%, #ffffff);
		box-shadow: inset 0 -2px 0 var(--reorder-accent);
	}

	:global([data-theme='dark']) .match-reorder__row.is-drag-over {
		background: color-mix(in srgb, var(--reorder-accent) 18%, #1d1934);
	}

	.match-reorder__term {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		font-weight: 700;
		font-size: 14px;
		color: #1a1a2e;
		border-right: 1px solid #ebebeb;
	}

	:global([data-theme='dark']) .match-reorder__term {
		color: #e4dff5;
		border-right-color: #302850;
	}

	.match-reorder__term-number {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		background: var(--reorder-accent);
		color: #ffffff;
		font-size: 12px;
		font-weight: 800;
		flex-shrink: 0;
	}

	.match-reorder__term-label {
		flex: 1;
		min-width: 0;
	}

	.match-reorder__match {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		font-size: 14px;
		color: #1a1a2e;
		cursor: grab;
		user-select: none;
	}

	:global([data-theme='dark']) .match-reorder__match {
		color: #e4dff5;
	}

	.match-reorder__match:active {
		cursor: grabbing;
	}

	.match-reorder__grip {
		color: #b0b0b0;
		font-size: 14px;
		flex-shrink: 0;
	}

	:global([data-theme='dark']) .match-reorder__grip {
		color: #6b5f8a;
	}

	.match-reorder__match-label {
		flex: 1;
		min-width: 0;
	}

	.match-reorder__arrows {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex-shrink: 0;
	}

	.match-reorder__arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 18px;
		border: 1px solid #d4d4d8;
		border-radius: 4px;
		background: #fafafa;
		font-size: 9px;
		color: #666;
		cursor: pointer;
		padding: 0;
	}

	:global([data-theme='dark']) .match-reorder__arrow {
		border-color: #3a3258;
		background: #1d1934;
		color: #a89ec4;
	}

	.match-reorder__arrow:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.match-reorder__arrow:hover:not(:disabled) {
		background: color-mix(in srgb, var(--reorder-accent) 12%, #fafafa);
		border-color: var(--reorder-accent);
	}

	.match-reorder__status-icon {
		flex-shrink: 0;
		font-size: 16px;
		font-weight: 800;
		color: #22a66e;
	}

	.match-reorder__status-icon--wrong {
		color: #e67e22;
	}

	.match-reorder__actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 10px;
	}

	.match-reorder__check {
		padding: 8px 20px;
		border: 0;
		border-radius: 8px;
		background: var(--reorder-accent);
		color: #ffffff;
		font-family: inherit;
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 2px 8px color-mix(in srgb, var(--reorder-accent) 40%, transparent);
	}

	.match-reorder__check:hover {
		filter: brightness(1.08);
	}

	.match-reorder__result {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
		padding: 10px 14px;
		border-radius: 10px;
		background: color-mix(in srgb, #e67e22 10%, #ffffff);
		border: 1.5px solid #e67e22;
		font-size: 14px;
		color: #b45309;
		font-weight: 600;
	}

	:global([data-theme='dark']) .match-reorder__result {
		background: color-mix(in srgb, #e67e22 20%, #1d1934);
		color: #fdba74;
	}

	.match-reorder__result.is-perfect {
		background: color-mix(in srgb, #22a66e 12%, #ffffff);
		border-color: #22a66e;
		color: #1a8c5b;
	}

	:global([data-theme='dark']) .match-reorder__result.is-perfect {
		background: color-mix(in srgb, #22a66e 22%, #1d1934);
		color: #86efac;
	}

	.match-reorder__result-icon {
		font-size: 18px;
		font-weight: 800;
	}

	.match-reorder__result-label {
		flex: 1;
	}

	.match-reorder__reset {
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
		.match-reorder__term,
		.match-reorder__match {
			padding: 8px 10px;
			font-size: 13px;
		}

		.match-reorder__header-cell {
			padding: 6px 10px;
			font-size: 11px;
		}
	}
</style>
