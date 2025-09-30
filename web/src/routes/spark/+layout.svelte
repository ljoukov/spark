<script lang="ts">
	let { children } = $props();
</script>

<div class="spark-surface">
	{@render children?.()}
</div>

<style>
	.spark-surface {
		min-height: 100vh;
		background: radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 45%),
			radial-gradient(circle at bottom right, rgba(236, 72, 153, 0.18), transparent 40%),
			color-mix(in srgb, var(--background) 94%, transparent 6%);
		transition: background 200ms ease;
	}

	:global(.dark) .spark-surface {
		background: radial-gradient(circle at top left, rgba(125, 211, 252, 0.14), transparent 48%),
			radial-gradient(circle at bottom right, rgba(244, 114, 182, 0.12), transparent 50%),
			color-mix(in srgb, var(--background) 96%, transparent 4%);
	}
</style>
