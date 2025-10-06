<script lang="ts">
        import { goto } from '$app/navigation';
        import { enhance } from '$app/forms';
        import type { SubmitFunction } from '@sveltejs/kit';
        import * as Dialog from '$lib/components/ui/dialog/index.js';
        import { Button } from '$lib/components/ui/button/index.js';
        import ArrowRight from '@lucide/svelte/icons/arrow-right';
        import type { PageData } from './$types';

        let { data }: { data: PageData } = $props();

        let dialogOpen = $state(true);
        let submittingId = $state<string | null>(null);
        let errorMessage = $state('');

        const handleSubmit: SubmitFunction = () => {
                return async ({ result }) => {
                        submittingId = null;
                        if (result.type === 'success') {
                                const payload = result.data as { sessionId?: string | null };
                                if (payload?.sessionId) {
                                        await goto(`/code/${payload.sessionId}`);
                                        return;
                                }
                                errorMessage = 'Session created, but we could not open it automatically. Please refresh.';
                                return;
                        }
                        if (result.type === 'failure') {
                                const failure = result.data as { message?: string } | undefined;
                                errorMessage = failure?.message ?? 'Please choose a topic to continue.';
                                return;
                        }
                        if (result.type === 'error') {
                                errorMessage = result.error?.message ?? 'Unexpected error. Please try again.';
                                return;
                        }
                        if (result.type === 'redirect') {
                                return;
                        }
                };
        };

        function handleDialogChange() {
                dialogOpen = true;
        }

        function prepareSubmit(topicId: string) {
                submittingId = topicId;
                errorMessage = '';
        }
</script>

<svelte:head>
        <title>Choose your first Spark Code session</title>
</svelte:head>

<div class="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
        <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-600/20 via-transparent to-pink-500/10"></div>
        <div class="relative mx-auto flex max-w-4xl flex-col gap-6 px-6 py-24 text-center sm:px-10">
                <p class="text-sm font-semibold uppercase tracking-[0.3em] text-indigo-300">Welcome to Spark Code</p>
                <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">Pick the adventure that looks most fun.</h1>
                <p class="text-base text-slate-300 sm:text-lg">
                        We built three mini-sessions that teach quick but powerful ideas. Choose one to create your personalised
                        plan and jump straight into /code.
                </p>
        </div>
</div>

<Dialog.Root open={dialogOpen} onOpenChange={handleDialogChange}>
        <Dialog.Content class="w-full max-w-5xl space-y-8 rounded-3xl border border-white/10 bg-slate-950/90 p-8 shadow-2xl backdrop-blur-lg sm:p-10">
                <Dialog.Header class="space-y-3 text-center">
                        <Dialog.Title class="text-3xl font-semibold text-white">Start with a welcome session</Dialog.Title>
                        <Dialog.Description class="text-base text-slate-300">
                                Choose one of the curated topics below. We will save the session to your workspace and open it instantly.
                        </Dialog.Description>
                </Dialog.Header>
                <div class="grid gap-6 lg:grid-cols-3">
                        {#each data.topics as topic (topic.id)}
                                <section class="flex h-full flex-col gap-5 rounded-2xl border border-white/10 bg-slate-900/60 p-6 text-left shadow-lg">
                                        <header class="space-y-2">
                                                <p class="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-200">{topic.title}</p>
                                                <h2 class="text-xl font-semibold text-white">{topic.tagline}</h2>
                                                <p class="text-sm text-slate-300">{topic.description}</p>
                                        </header>
                                        <ul class="space-y-2">
                                                {#each topic.takeaways as takeaway, index}
                                                        <li class="flex items-start gap-3 text-sm text-slate-200">
                                                                <span class="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-indigo-200">{index + 1}</span>
                                                                <span>{takeaway}</span>
                                                        </li>
                                                {/each}
                                        </ul>
                                        <div class="rounded-2xl bg-slate-950/60 p-4">
                                                <p class="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">5-step plan</p>
                                                <ul class="space-y-3">
                                                        {#each topic.plan as step}
                                                                <li class="flex items-center gap-3 text-sm">
                                                                        <span class="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/10 text-lg">{step.icon ?? (step.kind === 'quiz' ? '📝' : '💻')}</span>
                                                                        <div class="flex flex-col">
                                                                                <span class="font-medium text-white">{step.title}</span>
                                                                                <span class="text-xs text-slate-400">{step.meta ?? (step.kind === 'quiz' ? 'Quiz' : 'Code')}</span>
                                                                        </div>
                                                                </li>
                                                        {/each}
                                                </ul>
                                        </div>
                                        <form
                                                method="POST"
                                                action="?/selectTopic"
                                                use:enhance={handleSubmit}
                                                class="mt-auto"
                                                onsubmit={() => prepareSubmit(topic.id)}
                                        >
                                                <input type="hidden" name="topicId" value={topic.id} />
                                                <Button
                                                        type="submit"
                                                        class="group w-full"
                                                        disabled={submittingId === topic.id}
                                                        aria-busy={submittingId === topic.id}
                                                >
                                                        <span class="flex w-full items-center justify-center gap-2">
                                                                {submittingId === topic.id ? 'Preparing your session…' : 'Start this session'}
                                                                <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
                                                        </span>
                                                </Button>
                                        </form>
                                </section>
                        {/each}
                </div>
                {#if errorMessage}
                        <p class="text-sm text-rose-300">{errorMessage}</p>
                {/if}
        </Dialog.Content>
</Dialog.Root>
