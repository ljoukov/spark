<script lang="ts">
        import { page } from '$app/stores';
        import type { PageData } from './$types';
        import * as Dialog from '$lib/components/ui/dialog/index.js';
        import { Button } from '$lib/components/ui/button/index.js';

        let { data }: { data: PageData } = $props();

        const topics = $derived(data.topics);
        const formError = $derived((($page.form ?? {}) as { message?: string }).message ?? '');
        let dialogOpen = $state(true);

        function handleDialogChange(open: boolean) {
                dialogOpen = open ? open : true;
        }
</script>

<svelte:head>
        <title>Spark Code · Choose your welcome mission</title>
</svelte:head>

<div class="min-h-screen bg-background/80 backdrop-blur-sm">
        <Dialog.Root open={dialogOpen} onOpenChange={handleDialogChange}>
                <Dialog.Content class="max-w-5xl">
                        {#if formError}
                                <p class="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                                        {formError}
                                </p>
                        {/if}
                        <Dialog.Header class="space-y-2">
                                <Dialog.Title class="text-left text-balance text-3xl font-semibold">
                                        Welcome to Spark Code
                                </Dialog.Title>
                                <Dialog.Description class="text-left text-muted-foreground">
                                        Pick a starter topic to generate your first session. Each plan mixes idea cards, quick
                                        quizzes, and two beginner-friendly coding problems.
                                </Dialog.Description>
                        </Dialog.Header>

                        <div class="grid gap-6">
                                {#each topics as topic}
                                        <form
                                                method="POST"
                                                action="?/choose"
                                                class="rounded-2xl border border-border/70 bg-muted/40 p-6 shadow-sm transition hover:border-border focus-within:border-primary"
                                        >
                                                <input type="hidden" name="topicId" value={topic.id} />
                                                <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                                        <div class="space-y-3">
                                                                <div>
                                                                        <p class="text-sm font-semibold uppercase tracking-widest text-primary/70">
                                                                                {topic.tagline}
                                                                        </p>
                                                                        <h3 class="text-2xl font-semibold text-foreground">
                                                                                {topic.title}
                                                                        </h3>
                                                                </div>
                                                                <p class="max-w-prose text-muted-foreground">{topic.description}</p>
                                                                <ul class="flex flex-wrap gap-2 text-sm text-muted-foreground">
                                                                        {#each topic.focusPoints as point}
                                                                                <li class="rounded-full bg-background px-3 py-1 font-medium">
                                                                                        {point}
                                                                                </li>
                                                                        {/each}
                                                                </ul>
                                                        </div>
                                                        <div class="flex shrink-0 flex-col items-end gap-3 text-right">
                                                                <span class="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                                                                        ≈ {topic.estimatedMinutes} min
                                                                </span>
                                                                <Button type="submit" class="w-full md:w-auto">
                                                                        Start this session
                                                                </Button>
                                                        </div>
                                                </div>

                                                <div class="mt-6 grid gap-3 md:grid-cols-2">
                                                        {#each topic.plan as step}
                                                                <div class="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
                                                                        <span class="text-xl" aria-hidden="true">{step.icon}</span>
                                                                        <div class="space-y-1">
                                                                                <div class="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                                                                                        <span>{step.meta}</span>
                                                                                        <span class="text-muted-foreground/50">•</span>
                                                                                        <span>{step.kind === 'quiz' ? 'Quiz step' : 'Coding problem'}</span>
                                                                                </div>
                                                                                <p class="text-base font-semibold text-foreground">{step.title}</p>
                                                                                {#if step.summary}
                                                                                        <p class="text-sm text-muted-foreground">{step.summary}</p>
                                                                                {/if}
                                                                        </div>
                                                                </div>
                                                        {/each}
                                                </div>
                                        </form>
                                {/each}
                        </div>
                </Dialog.Content>
        </Dialog.Root>
</div>
