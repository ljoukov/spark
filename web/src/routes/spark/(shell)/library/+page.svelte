<script lang="ts">
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { sparkUploadsStore } from '$lib/mock/spark-data';
	import { sparkCreateDialogOpen } from '$lib/stores/spark-ui';

	function openCreate() {
		sparkCreateDialogOpen.set(true);
	}
</script>

<section class="spark-library">
	<header class="spark-library__header">
		<div>
			<h1>Library</h1>
			<p>Organise every upload and jump straight into a tailored session.</p>
		</div>
		<button type="button" class={cn(buttonVariants({ size: 'lg' }))} onclick={openCreate}>
			New
		</button>
	</header>

	{#if $sparkUploadsStore.length > 0}
		<ul class="spark-library__list">
			{#each $sparkUploadsStore as upload, index}
				<li>
					<a class="spark-library__row" href={`/spark/setup?upload=${upload.id}`}>
						<div class="spark-library__row-index">{index + 1}</div>
						<div class="spark-library__row-main">
							<div class="spark-library__row-title">{upload.title}</div>
							<div class="spark-library__row-tags">
								<span>{upload.subject}</span>
								<span>{upload.specCodes}</span>
							</div>
						</div>
						<div class="spark-library__row-stats">
							<span>{upload.items} items</span>
							<span>Last used {upload.lastUsed}</span>
						</div>
					</a>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class="spark-library__actions"
							aria-label={`Manage ${upload.title}`}
						>
							<MoreVerticalIcon class="size-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" sideOffset={6} class="spark-library__menu">
							<DropdownMenu.Item onSelect={openCreate}>New variant</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={() => {}}>Rename</DropdownMenu.Item>
							<DropdownMenu.Separator />
							<DropdownMenu.Item class="destructive">Delete</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="spark-library__empty">
			<h2>No uploads yet</h2>
			<p>Bring your notes in via Create to craft instant practice sets.</p>
			<button type="button" class={cn(buttonVariants({}))} onclick={openCreate}> Start now </button>
		</div>
	{/if}
</section>

<style>
	.spark-library {
		display: grid;
		gap: clamp(1.5rem, 4vw, 2.5rem);
	}

	.spark-library__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1.5rem;
	}

	.spark-library__header h1 {
		font-size: clamp(1.5rem, 3vw, 1.9rem);
		font-weight: 600;
	}

	.spark-library__header p {
		font-size: 0.95rem;
		color: color-mix(in srgb, var(--text-secondary) 82%, transparent 18%);
	}

	.spark-library__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1rem;
	}

	.spark-library__list li {
		position: relative;
		background: color-mix(in srgb, var(--surface-color) 95%, transparent 5%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		border-radius: 1.25rem;
		padding: 1.25rem;
		display: grid;
		align-items: center;
		grid-template-columns: minmax(0, 1fr);
		box-shadow: 0 24px 48px -36px var(--shadow-color);
	}

	.spark-library__row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 1.5rem;
		text-decoration: none;
		color: inherit;
	}

	.spark-library__row-index {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.85rem;
		display: grid;
		place-items: center;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(14, 165, 233, 0.18));
		font-weight: 600;
	}

	.spark-library__row-main {
		display: grid;
		gap: 0.45rem;
	}

	.spark-library__row-title {
		font-weight: 600;
		font-size: 1.05rem;
	}

	.spark-library__row-tags {
		display: flex;
		gap: 0.65rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
		color: color-mix(in srgb, var(--text-secondary) 78%, transparent 22%);
	}

	.spark-library__row-stats {
		display: grid;
		gap: 0.4rem;
		text-align: right;
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	:global(.spark-library__actions) {
		position: absolute;
		top: 1rem;
		right: 1rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.9rem;
		background: color-mix(in srgb, var(--surface-color) 90%, transparent 10%);
		transition:
			background 160ms ease,
			transform 160ms ease;
	}

	:global(.spark-library__actions:hover) {
		background: color-mix(in srgb, var(--accent) 30%, transparent 70%);
		transform: translateY(-2px);
	}

	:global(.spark-library__menu) {
		border-radius: 1rem;
		padding: 0.35rem;
		min-width: 10rem;
		background: color-mix(in srgb, var(--surface-color) 96%, transparent 4%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 75%, transparent 25%);
	}

	:global(.spark-library__menu [role='menuitem']) {
		border-radius: 0.75rem;
		padding: 0.5rem 0.75rem;
	}

	:global(.spark-library__menu .destructive) {
		color: oklch(0.577 0.245 27.325);
	}

	.spark-library__empty {
		background: color-mix(in srgb, var(--accent) 16%, transparent 84%);
		border-radius: 1.5rem;
		padding: clamp(2rem, 5vw, 3rem);
		display: grid;
		gap: 0.75rem;
		text-align: center;
		justify-items: center;
	}

	.spark-library__empty h2 {
		font-size: 1.35rem;
		font-weight: 600;
	}

	.spark-library__empty p {
		font-size: 0.95rem;
		color: color-mix(in srgb, var(--text-secondary) 80%, transparent 20%);
	}

	@media (max-width: 720px) {
		.spark-library__row {
			grid-template-columns: auto 1fr;
		}

		.spark-library__row-stats {
			text-align: left;
			margin-top: 0.5rem;
		}
	}
</style>
