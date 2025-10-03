<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import { sparkUser as sparkUserStore } from '$lib/mock/spark-data';
</script>

<div class="spark-settings-cover">
	<div class="spark-settings-modal" role="dialog" aria-modal="true">
		<header>
			<div>
				<h1>Settings</h1>
				<p>Manage your Spark account, preferences, and support options.</p>
			</div>
			<a class="spark-settings-close" href="/spark/home" aria-label="Close settings">Done</a>
		</header>

		<section class="spark-settings-profile">
			<img src={$sparkUserStore.avatar} alt={$sparkUserStore.name} />
			<div>
				<h2>{$sparkUserStore.name}</h2>
				<p>Triple Science • GCSE 2025</p>
			</div>
		</section>

		<ul class="spark-settings-list">
			<li><button type="button">Account</button></li>
			<li><button type="button">Boards &amp; subjects</button></li>
			<li><button type="button">Notifications</button></li>
			<li><button type="button">App info</button></li>
			<li>
				<a href="https://spark.study/legal" target="_blank" rel="noreferrer">Privacy &amp; Terms</a>
			</li>
			<li><a href="mailto:hello@spark.study">Help &amp; feedback</a></li>
			<li><button type="button">Logout</button></li>
		</ul>

		<footer>
			<Button href="/spark/home" variant="secondary">Done</Button>
		</footer>
	</div>
</div>

<style>
	.spark-settings-cover {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--background) 74%, transparent 26%);
		backdrop-filter: blur(16px);
		padding: clamp(1.5rem, 4vw, 3rem);
		z-index: 60;
	}

	.spark-settings-modal {
		width: min(520px, 100%);
		background: color-mix(in srgb, var(--surface-color) 96%, transparent 4%);
		border-radius: clamp(1.4rem, 4vw, 1.8rem);
		border: 1px solid color-mix(in srgb, var(--surface-border) 75%, transparent 25%);
		padding: clamp(1.75rem, 4vw, 2.25rem);
		display: grid;
		gap: 1.5rem;
		box-shadow: 0 36px 72px -56px var(--shadow-color);
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	header h1 {
		font-size: clamp(1.4rem, 3vw, 1.8rem);
		font-weight: 600;
	}

	header p {
		margin-top: 0.35rem;
		font-size: 0.95rem;
		color: color-mix(in srgb, var(--text-secondary) 78%, transparent 22%);
	}

	.spark-settings-close {
		font-size: 0.9rem;
		font-weight: 600;
		color: color-mix(in srgb, var(--text-secondary) 85%, transparent 15%);
		text-decoration: none;
	}

	.spark-settings-close:hover {
		color: var(--text-primary);
	}

	.spark-settings-profile {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		border-radius: 1.25rem;
		background: color-mix(in srgb, var(--accent) 20%, transparent 80%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 72%, transparent 28%);
	}

	.spark-settings-profile img {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 1.25rem;
		object-fit: cover;
		box-shadow: 0 16px 32px -24px var(--shadow-color);
	}

	.spark-settings-profile h2 {
		font-size: 1.1rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.spark-settings-profile p {
		margin: 0;
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--text-secondary) 78%, transparent 22%);
	}

	.spark-settings-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	.spark-settings-list li {
		background: color-mix(in srgb, var(--surface-color) 94%, transparent 6%);
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent 30%);
		border-radius: 1rem;
	}

	.spark-settings-list a,
	.spark-settings-list button {
		width: 100%;
		text-align: left;
		padding: 0.9rem 1rem;
		font-size: 0.95rem;
		font-weight: 500;
		color: inherit;
		text-decoration: none;
		background: none;
		border: none;
		border-radius: inherit;
		cursor: pointer;
		transition:
			background 160ms ease,
			transform 160ms ease;
	}

	.spark-settings-list a:hover,
	.spark-settings-list button:hover {
		background: color-mix(in srgb, var(--accent) 18%, transparent 82%);
		transform: translateY(-2px);
	}

	footer {
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 640px) {
		.spark-settings-modal {
			border-radius: 0;
			height: 100%;
			overflow-y: auto;
		}

		footer {
			justify-content: stretch;
		}

		:global(.spark-settings-modal footer [data-slot='button']) {
			width: 100%;
		}
	}
</style>
