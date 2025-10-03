import type { CodeProgressStepKey } from '$lib/types/code-progress';

type CodePlanStep = {
        key: CodeProgressStepKey;
        title: string;
        icon: string;
        meta: string;
        description: string;
        href: string;
};

export const dynamicProgrammingPlan: readonly CodePlanStep[] = [
        {
                key: 'warmup',
                title: 'Warm-up quiz',
                icon: '⚡',
                meta: '3 Q · 4 min',
                description: 'Shake off the rust with quick DP fundamentals.',
                href: '/code/quiz/dp-warmup'
        },
        {
                key: 'topic',
                title: 'Topic deck',
                icon: '📘',
                meta: '5 cards · guided',
                description: 'Walk through the core DP mindset with gentle check-ins.',
                href: '/code/quiz/dp-topic'
        },
        {
                key: 'problem-one',
                title: 'Coin Change Ways',
                icon: '🪙',
                meta: 'DP · Easy',
                description: 'Count ways to form an amount with unlimited coins.',
                href: '/code/p/coin-change-ways'
        },
        {
                key: 'problem-two',
                title: 'Decode Ways',
                icon: '🔐',
                meta: 'DP · Easy',
                description: 'Use a simple DP to decode strings of digits.',
                href: '/code/p/decode-ways'
        },
        {
                key: 'review',
                title: 'Final review quiz',
                icon: '✅',
                meta: '3 Q · 4 min',
                description: 'Lock in the takeaways before moving on.',
                href: '/code/quiz/dp-review'
        }
] as const;

export const problemStepBySlug: Partial<Record<string, CodeProgressStepKey>> = {
        'coin-change-ways': 'problem-one',
        'decode-ways': 'problem-two'
};
