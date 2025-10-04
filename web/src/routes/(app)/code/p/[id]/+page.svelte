<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;
	void data;

	const MIN_HORIZONTAL_PERCENT = 15;
	const MIN_VERTICAL_PERCENT = 20;

	let workspaceEl: HTMLDivElement | null = null;
	let rightStackEl: HTMLDivElement | null = null;

	let horizontalSplit = 50;
	let verticalSplit = 67;

	type DragKind = 'horizontal' | 'vertical';
	type DragState = {
		kind: DragKind;
		pointerId: number;
		handle: HTMLElement;
	};

	let dragState: DragState | null = null;

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

	function startDrag(kind: DragKind, event: PointerEvent) {
		const handle = event.currentTarget as HTMLElement | null;
		if (!handle) {
			return;
		}
		event.preventDefault();
		dragState = { kind, pointerId: event.pointerId, handle };
		handle.setPointerCapture?.(event.pointerId);
	}

	function finishDrag(event: PointerEvent) {
		if (!dragState) {
			return;
		}
		if (event.pointerId !== dragState.pointerId) {
			return;
		}
		dragState.handle.releasePointerCapture?.(dragState.pointerId);
		dragState = null;
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragState) {
			return;
		}
		if (dragState.kind === 'horizontal' && workspaceEl) {
			const rect = workspaceEl.getBoundingClientRect();
			if (rect.width === 0) {
				return;
			}
			const percent = ((event.clientX - rect.left) / rect.width) * 100;
			horizontalSplit = clamp(percent, MIN_HORIZONTAL_PERCENT, 100 - MIN_HORIZONTAL_PERCENT);
			return;
		}
		if (dragState.kind === 'vertical' && rightStackEl) {
			const rect = rightStackEl.getBoundingClientRect();
			if (rect.height === 0) {
				return;
			}
			const percent = ((event.clientY - rect.top) / rect.height) * 100;
			verticalSplit = clamp(percent, MIN_VERTICAL_PERCENT, 100 - MIN_VERTICAL_PERCENT);
		}
	}

	function handlePointerUp(event: PointerEvent) {
		finishDrag(event);
	}

	function adjustSplit(kind: DragKind, delta: number) {
		if (kind === 'horizontal') {
			horizontalSplit = clamp(
				horizontalSplit + delta,
				MIN_HORIZONTAL_PERCENT,
				100 - MIN_HORIZONTAL_PERCENT
			);
			return;
		}
		verticalSplit = clamp(verticalSplit + delta, MIN_VERTICAL_PERCENT, 100 - MIN_VERTICAL_PERCENT);
	}

	function handleHandleKey(kind: DragKind, event: KeyboardEvent) {
		const step = event.shiftKey ? 5 : 2;
		if (kind === 'horizontal') {
			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				adjustSplit('horizontal', -step);
				return;
			}
			if (event.key === 'ArrowRight') {
				event.preventDefault();
				adjustSplit('horizontal', step);
				return;
			}
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			adjustSplit('vertical', -step);
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			adjustSplit('vertical', step);
		}
	}
</script>

<svelte:window on:pointermove={handlePointerMove} on:pointerup={handlePointerUp} on:pointercancel={handlePointerUp} />

<section class="page-frame">
	<header class="app-header">
		<span class="app-header__title">App header</span>
	</header>
	<div class="workspace-page">
		<div class="workspace" bind:this={workspaceEl}>
			<div
				class="pane pane--left"
				style:width={`${horizontalSplit}%`}
				style:flex-basis={`${horizontalSplit}%`}
			>
				<h1 class="pane-title">Hello world</h1>
				<p class="pane-copy">Drag the separators to adjust the layout.</p>
			</div>
			<div
				class="handle handle--vertical"
				role="separator"
				aria-label="Resize workspace panes"
				aria-orientation="vertical"
				aria-valuemin={MIN_HORIZONTAL_PERCENT}
				aria-valuemax={100 - MIN_HORIZONTAL_PERCENT}
				aria-valuenow={Math.round(horizontalSplit)}
				tabindex="0"
				on:pointerdown={(event) => startDrag('horizontal', event)}
				on:pointerup={handlePointerUp}
				on:lostpointercapture={handlePointerUp}
				on:keydown={(event) => handleHandleKey('horizontal', event)}
			></div>
			<div
				class="pane pane--right"
				style:width={`${100 - horizontalSplit}%`}
				style:flex-basis={`${100 - horizontalSplit}%`}
			>
				<div class="right-stack" bind:this={rightStackEl}>
					<div
						class="pane-section pane-section--editor"
						style:height={`${verticalSplit}%`}
						style:flex-basis={`${verticalSplit}%`}
					>
						<h2 class="pane-title">Editor Pane</h2>
						<p class="pane-copy">This area mimics the editor content.</p>
					</div>
					<div
						class="handle handle--horizontal"
						role="separator"
						aria-label="Resize editor and output panes"
						aria-orientation="horizontal"
						aria-valuemin={MIN_VERTICAL_PERCENT}
						aria-valuemax={100 - MIN_VERTICAL_PERCENT}
						aria-valuenow={Math.round(verticalSplit)}
						tabindex="0"
						on:pointerdown={(event) => startDrag('vertical', event)}
						on:pointerup={handlePointerUp}
						on:lostpointercapture={handlePointerUp}
						on:keydown={(event) => handleHandleKey('vertical', event)}
					></div>
					<div
						class="pane-section pane-section--output"
						style:height={`${100 - verticalSplit}%`}
						style:flex-basis={`${100 - verticalSplit}%`}
					>
						<h2 class="pane-title">Output Pane</h2>
						<p class="pane-copy">Output placeholder.</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>

<style lang="postcss">
	:global(.app-content) {
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
	}

	.page-frame {
		display: flex;
		flex-direction: column;
		width: 100dvw;
		height: 100dvh;
		overflow: hidden;
		background: radial-gradient(circle at top, rgba(15, 23, 42, 0.08), transparent 65%);
	}

	.app-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid rgba(148, 163, 184, 0.26);
		background: rgba(15, 23, 42, 0.78);
		color: #e2e8f0;
	}

	.app-header__title {
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.workspace-page {
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		height: 100%;
		width: 100%;
		padding: 1rem;
	}

	.workspace {
		position: relative;
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		border: 1px solid rgba(148, 163, 184, 0.26);
		border-radius: 0.75rem;
		background: rgba(15, 23, 42, 0.04);
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
		overflow: hidden;
	}

	.pane {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		flex: 0 0 auto;
		min-width: 0;
		min-height: 0;
		padding: 1.25rem;
	}

	.pane--left {
		background: rgba(255, 255, 255, 0.78);
	}

	.pane--right {
		flex: 1 1 auto;
	}

	.right-stack {
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		flex-direction: column;
		gap: 0.75rem;
	}

	.pane-section {
		flex: 0 0 auto;
		min-height: 0;
		border: 1px solid rgba(148, 163, 184, 0.26);
		border-radius: 0.6rem;
		padding: 1rem;
		background: #fff;
		box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow: hidden;
	}

	.pane-section--output {
		background: rgba(241, 245, 249, 0.75);
	}

	.pane-title {
		font-size: 0.95rem;
		font-weight: 600;
	}

	.pane-copy {
		font-size: 0.83rem;
		line-height: 1.5;
		color: #64748b;
	}

	.handle {
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(148, 163, 184, 0.18);
		flex: 0 0 auto;
		transition: background 0.2s ease;
	}

	.handle--vertical {
		width: 0.65rem;
		cursor: col-resize;
	}

	.handle--horizontal {
		height: 0.65rem;
		cursor: row-resize;
	}

	.handle:hover,
	.handle:focus-visible,
	.handle:active {
		background: rgba(148, 163, 184, 0.32);
	}

	.handle:focus-visible {
		outline: 2px solid rgba(59, 130, 246, 0.8);
		outline-offset: 2px;
	}
</style>
