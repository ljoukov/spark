<script lang="ts">
        import { createEventDispatcher } from 'svelte';
        import QuizQuestionCard from './quiz-question-card.svelte';
        import { Button } from '$lib/components/ui/button/index.js';
        import type { QuizInfoCardQuestion } from '$lib/types/quiz';

        const dispatch = createEventDispatcher<{ continue: void }>();

        type Props = {
                question: QuizInfoCardQuestion;
                eyebrow?: string | null;
                continueLabel?: string;
        };

        let {
                question,
                eyebrow = undefined,
                continueLabel = 'Continue'
        }: Props = $props();

        const paragraphs = $derived(
                Array.isArray(question.body) ? [...question.body] : [question.body]
        );
        const resolvedLabel = $derived(question.actionLabel ?? continueLabel);

        function handleContinue() {
                dispatch('continue');
        }
</script>

<QuizQuestionCard
        title={question.prompt}
        eyebrow={eyebrow}
        status="neutral"
        displayFooter={false}
>
        <div class="space-y-4 text-base leading-relaxed text-muted-foreground">
                {#each paragraphs as paragraph, index}
                        <p class="text-foreground/90">{paragraph}</p>
                {/each}
                <div class="pt-2">
                        <Button size="lg" class="w-full sm:w-auto" onclick={handleContinue}>
                                {resolvedLabel}
                        </Button>
                </div>
        </div>
</QuizQuestionCard>
