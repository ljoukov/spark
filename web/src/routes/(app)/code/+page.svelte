<script lang="ts">
        import * as Dialog from '$lib/components/ui/dialog/index.js';
        import { Button } from '$lib/components/ui/button/index.js';
        import type { PageData } from './$types';

        let { data }: { data: PageData } = $props();

        const topics = $derived(data.topics);
        let dialogOpen = $state(true);

        function keepDialogOpen(open: boolean) {
                if (!open) {
                        dialogOpen = true;
                }
        }
</script>

<svelte:head>
        <title>Spark Code · Pick your first mission</title>
</svelte:head>

<section class="welcome-shell">
        <Dialog.Root open={dialogOpen} onOpenChange={keepDialogOpen}>
                <Dialog.Content class="welcome-dialog" role="dialog" aria-modal="true">
                        <Dialog.Header class="dialog-header">
                                        <Dialog.Title>Start with a quick win</Dialog.Title>
                                        <Dialog.Description>
                                                Choose a mini mission to unlock your first session plan. Each one blends idea cards,
                                                quick quizzes, and two coding warm-ups.
                                        </Dialog.Description>
                                </Dialog.Header>
                                <div class="topics-grid">
                                        {#each topics as topic}
                                                <form method="POST" action="?/start" class="topic-card">
                                                        <input type="hidden" name="topic" value={topic.id} />
                                                        <header class="card-header">
                                                                <span class="topic-emoji" aria-hidden="true">{topic.emoji}</span>
                                                                <div class="topic-text">
                                                                        <h2>{topic.title}</h2>
                                                                        <p>{topic.tagline}</p>
                                                                </div>
                                                        </header>
                                                        <p class="topic-highlight">{topic.highlight}</p>
                                                        <ul class="topic-bullets">
                                                                {#each topic.bullets as bullet}
                                                                        <li>{bullet}</li>
                                                                {/each}
                                                        </ul>
                                                        <div class="plan-preview">
                                                                <p class="plan-label">5-step plan</p>
                                                                <ol>
                                                                        {#each topic.planPreview as step, index}
                                                                                <li>
                                                                                        <span class="step-index">{index + 1}.</span>
                                                                                        <span class="step-icon" aria-hidden="true">{step.icon ?? ''}</span>
                                                                                        <span class="step-title">{step.title}</span>
                                                                                        {#if step.meta}
                                                                                                <span class="step-meta">{step.meta}</span>
                                                                                        {/if}
                                                                                </li>
                                                                        {/each}
                                                                </ol>
                                                        </div>
                                                        <div class="card-actions">
                                                                <Button type="submit">Start {topic.title}</Button>
                                                        </div>
                                                </form>
                                        {/each}
                                </div>
                        </Dialog.Content>
        </Dialog.Root>
</section>

<style>
        .welcome-shell {
                min-height: 100vh;
                background: radial-gradient(120% 120% at 50% -10%, rgba(255, 194, 120, 0.4), transparent),
                        radial-gradient(120% 120% at 0% 0%, rgba(109, 231, 222, 0.35), transparent),
                        var(--background, hsl(210 40% 96%));
                display: flex;
                align-items: center;
                justify-content: center;
                padding: clamp(1.5rem, 4vw, 3.5rem);
        }

        :global(.welcome-dialog) {
                position: relative;
                z-index: 10;
                width: min(960px, 100%);
                background: var(--dialog-bg, rgba(255, 255, 255, 0.98));
                border-radius: 1.5rem;
                padding: clamp(1.5rem, 3vw, 2.5rem);
                box-shadow: 0 40px 120px -60px rgba(15, 23, 42, 0.4);
                display: flex;
                flex-direction: column;
                gap: clamp(1.5rem, 3vw, 2.5rem);
        }

        :global(.dialog-header) {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
        }

        :global([data-slot="dialog-title"]) {
                font-size: clamp(1.6rem, 2.1vw, 2rem);
                font-weight: 700;
                color: var(--foreground, #111827);
        }

        :global([data-slot="dialog-description"]) {
                color: var(--muted-foreground, #475569);
                font-size: clamp(0.95rem, 1vw, 1.05rem);
                line-height: 1.5;
        }

        .topics-grid {
                display: grid;
                gap: clamp(1.25rem, 2vw, 1.75rem);
                grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }

        .topic-card {
                display: flex;
                flex-direction: column;
                gap: 1rem;
                padding: clamp(1.25rem, 2vw, 1.75rem);
                border-radius: 1.25rem;
                background: rgba(248, 250, 252, 0.9);
                border: 1px solid rgba(148, 163, 184, 0.18);
                transition: transform 160ms ease, box-shadow 160ms ease;
        }

        .topic-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 18px 60px -40px rgba(15, 23, 42, 0.5);
        }

        .card-header {
                display: flex;
                gap: 0.75rem;
                align-items: center;
        }

        .topic-emoji {
                font-size: clamp(1.8rem, 2.3vw, 2.2rem);
        }

        .topic-text h2 {
                margin: 0;
                font-size: clamp(1.2rem, 1.6vw, 1.4rem);
                font-weight: 700;
        }

        .topic-text p {
                margin: 0.25rem 0 0;
                color: var(--muted-foreground, #475569);
                font-size: clamp(0.9rem, 1vw, 1rem);
        }

        .topic-highlight {
                margin: 0;
                font-weight: 600;
                color: var(--foreground, #1f2937);
        }

        .topic-bullets {
                margin: 0;
                padding-left: 1.25rem;
                color: var(--muted-foreground, #475569);
                display: flex;
                flex-direction: column;
                gap: 0.35rem;
                font-size: clamp(0.88rem, 1vw, 0.95rem);
        }

        .plan-preview {
                background: rgba(255, 255, 255, 0.88);
                border: 1px solid rgba(148, 163, 184, 0.2);
                border-radius: 1rem;
                padding: 0.9rem 1rem;
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
        }

        .plan-label {
                font-size: 0.8rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                color: rgba(30, 64, 175, 0.85);
                margin: 0;
        }

        .plan-preview ol {
                list-style: none;
                margin: 0;
                padding: 0;
                display: flex;
                flex-direction: column;
                gap: 0.45rem;
        }

        .plan-preview li {
                display: grid;
                grid-template-columns: auto auto 1fr auto;
                gap: 0.5rem;
                align-items: center;
                font-size: clamp(0.85rem, 0.95vw, 0.95rem);
        }

        .step-index {
                font-weight: 600;
                color: rgba(30, 64, 175, 0.95);
        }

        .step-icon {
                font-size: 1.1rem;
        }

        .step-title {
                font-weight: 600;
        }

        .step-meta {
                justify-self: end;
                font-size: 0.75rem;
                color: rgba(71, 85, 105, 0.85);
        }

        .card-actions {
                display: flex;
                justify-content: flex-end;
        }

        @media (max-width: 720px) {
                :global(.welcome-dialog) {
                        width: 100%;
                        padding: 1.5rem;
                }

                .topics-grid {
                        grid-template-columns: 1fr;
                }
        }
</style>
