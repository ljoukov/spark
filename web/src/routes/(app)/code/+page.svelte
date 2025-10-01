<svelte:head>
	<title>Spark App</title>
</svelte:head>

<section class="dashboard-hero">
	<h1>Ready to pick up where you left off?</h1>
	<p>Upload a new set of notes or jump back into your latest GCSE practice session.</p>
	<div class="dashboard-actions">
		<button type="button" class="dashboard-button primary">New scan</button>
		<button type="button" class="dashboard-button secondary">View recent quizzes</button>
	</div>
</section>

<style>
	.dashboard-hero {
		display: grid;
		gap: clamp(1.25rem, 2.2vw, 1.75rem);
		padding: clamp(1.2rem, 1.5vw, 1.6rem);
		border-radius: clamp(1.5rem, 2.5vw, 2rem);
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid rgba(148, 163, 184, 0.18);
		box-shadow:
			0 30px 90px -60px rgba(15, 23, 42, 0.4),
			0 18px 45px -40px rgba(15, 23, 42, 0.35);
		max-width: 56rem;
	}

	:global([data-theme='dark'] .dashboard-hero),
	:global(:root:not([data-theme='light']) .dashboard-hero) {
		background: rgba(6, 11, 25, 0.82);
		border-color: rgba(148, 163, 184, 0.22);
	}

	.dashboard-hero h1 {
		margin: 0;
		font-size: clamp(1.8rem, 2.5vw, 2.4rem);
		font-weight: 600;
		line-height: 1.1;
	}

	.dashboard-hero p {
		margin: 0;
		font-size: clamp(1rem, 1.4vw, 1.1rem);
		line-height: 1.6;
		color: var(--app-subtitle-color, rgba(30, 41, 59, 0.78));
	}

	.dashboard-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
	}

	.dashboard-button {
		border-radius: 9999px;
		padding: 0.75rem 1.6rem;
		font-size: 0.95rem;
		font-weight: 600;
		border: none;
		cursor: pointer;
	}

	.dashboard-button.primary {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.92), rgba(59, 130, 246, 0.72));
		color: #fff;
		box-shadow: 0 18px 45px -24px rgba(37, 99, 235, 0.75);
	}

	.dashboard-button.secondary {
		background: rgba(15, 23, 42, 0.06);
		color: rgba(15, 23, 42, 0.88);
		border: 1px solid rgba(148, 163, 184, 0.24);
	}

	:global([data-theme='dark'] .dashboard-button.secondary),
	:global(:root:not([data-theme='light']) .dashboard-button.secondary) {
		background: rgba(148, 163, 184, 0.12);
		color: rgba(226, 232, 240, 0.88);
		border-color: rgba(148, 163, 184, 0.26);
	}

	@media (max-width: 640px) {
		.dashboard-hero {
			grid-template-columns: 1fr;
		}

		.dashboard-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.dashboard-button {
			width: 100%;
		}
	}
</style>
