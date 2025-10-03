<script lang="ts">
        import { createEventDispatcher } from 'svelte';
        import QuizQuestionCard from './quiz-question-card.svelte';
        import { Button } from '$lib/components/ui/button/index.js';
        import type { QuizInfoCardQuestion } from '$lib/types/quiz';

        const dispatch = createEventDispatcher<{ continue: void }>();

        type Props = {
                question: QuizInfoCardQuestion;
                continueLabel?: string;
        };

        let { question, continueLabel = 'Continue' }: Props = $props();

        function handleContinue() {
                dispatch('continue');
        }
</script>

<QuizQuestionCard
        title={question.prompt}
        eyebrow={question.eyebrow ?? null}
        status="neutral"
        displayFooter={false}
>
        <div class="space-y-4">
                <p class="text-base leading-relaxed text-foreground/90 dark:text-foreground">
                        {question.body}
                </p>
                {#if question.bullets?.length}
                        <ul class="space-y-2 text-base leading-relaxed text-foreground/90">
                                {#each question.bullets as bullet}
                                        <li class="flex items-start gap-2">
                                                <span class="mt-1 inline-flex size-2 shrink-0 rounded-full bg-primary"></span>
                                                <span class="flex-1">{bullet}</span>
                                        </li>
                                {/each}
                        </ul>
                {/if}
        </div>

        <div class="mt-6 flex justify-end">
                <Button size="lg" onclick={handleContinue}>{continueLabel}</Button>
        </div>
</QuizQuestionCard>
