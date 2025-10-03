<script lang="ts">
        import { createEventDispatcher } from 'svelte';
        import QuizQuestionCard from './quiz-question-card.svelte';
        import { Button } from '$lib/components/ui/button/index.js';
        import type { QuizInfoCardQuestion } from '$lib/types/quiz';

        type Status = 'neutral' | 'correct' | 'incorrect';

        const dispatch = createEventDispatcher<{ continue: void }>();

        type Props = {
                question: QuizInfoCardQuestion;
                continueLabel?: string;
                status?: Status;
        };

        let {
                question,
                continueLabel = question.continueLabel ?? 'Next',
                status: statusProp = 'neutral' as Status
        }: Props = $props();

        const eyebrow = $derived(question.eyebrow ?? 'Concept spotlight');

        function handleContinue() {
                dispatch('continue');
        }
</script>

<QuizQuestionCard
        title={question.prompt}
        status={statusProp}
        eyebrow={eyebrow}
        displayFooter={true}
>
        <div class="space-y-4">
                <p class="text-base leading-relaxed text-foreground/90">
                        {question.body}
                </p>
        </div>

        <div slot="footer" class="ml-auto flex items-center gap-2">
                <Button size="lg" onclick={handleContinue}>{continueLabel}</Button>
        </div>
</QuizQuestionCard>
