import type { QuizDefinition } from '$lib/types/quiz';

export const dpWarmupQuiz: QuizDefinition = {
        id: 'dp-warmup-basics',
        title: 'Dynamic Programming Warmup',
        description: 'Quick refresher on subproblems, memo tables, and transitions before diving deeper.',
        topic: 'Dynamic Programming',
        estimatedMinutes: 4,
        stepId: 'warmup-quiz',
        completionCtaLabel: 'Done — back to plan',
        questions: [
                {
                        kind: 'multiple-choice',
                        id: 'dp-warmup-overlap',
                        prompt: 'What makes a problem a good fit for dynamic programming?',
                        progressLabel: 'Warmup · Q1',
                        hint: 'Focus on repeated work and reusable answers.',
                        explanation:
                                'Dynamic programming helps when subproblems repeat and the best answer can be composed from the best answers to those subproblems.',
                        options: [
                                { id: 'A', label: 'A', text: 'It has a binary search tree structure.' },
                                {
                                        id: 'B',
                                        label: 'B',
                                        text: 'Subproblems overlap and we can build the optimal answer from smaller ones.'
                                },
                                { id: 'C', label: 'C', text: 'It only works on sorted arrays.' },
                                {
                                        id: 'D',
                                        label: 'D',
                                        text: 'There are no base cases, so recursion can run forever.'
                                }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-warmup-table-direction',
                        prompt: 'When tabulating dp[i], what must be true about previously computed states?',
                        progressLabel: 'Warmup · Q2',
                        hint: 'Think about transition dependencies.',
                        explanation:
                                'We must visit states so every dependency is filled before we read it, otherwise dp[i] would look up stale data.',
                        options: [
                                { id: 'A', label: 'A', text: 'Every state only depends on larger indices.' },
                                {
                                        id: 'B',
                                        label: 'B',
                                        text: 'Dependencies may be unfilled; memoization will handle it.'
                                },
                                {
                                        id: 'C',
                                        label: 'C',
                                        text: 'All dependencies are computed before the current state is evaluated.'
                                },
                                { id: 'D', label: 'D', text: 'dp arrays must always be iterated right to left.' }
                        ],
                        correctOptionId: 'C'
                },
                {
                        kind: 'type-answer',
                        id: 'dp-warmup-basecase',
                        prompt: 'Fill in the blank: the base case dp[0] in a coin change count table should be _____.',
                        progressLabel: 'Warmup · Q3',
                        hint: 'How many ways can we make amount zero?',
                        explanation:
                                'We set dp[0] = 1 to represent the empty combination—the unique way to form amount zero.',
                        answer: '1',
                        acceptableAnswers: ['one']
                }
        ]
};

export const dpTopicDeck: QuizDefinition = {
        id: 'dp-topic-deck',
        title: 'DP on Counting Paths',
        description: 'Step through a simple grid-walk recurrence, then test what you learned.',
        topic: 'Dynamic Programming',
        estimatedMinutes: 6,
        stepId: 'topic-deck',
        completionCtaLabel: 'Done — back to plan',
        questions: [
                {
                        kind: 'info-card',
                        id: 'dp-topic-setup',
                        prompt: 'Scenario: counting grid paths',
                        progressLabel: 'Topic · Intro',
                        body: [
                                'We start in the top-left corner of a grid and can move only right or down. dp[r][c] counts the ways to reach cell (r, c).',
                                'Base cases: dp[0][c] = 1 and dp[r][0] = 1 because we can only move straight along the edge.'
                        ],
                        actionLabel: 'Next tip'
                },
                {
                        kind: 'info-card',
                        id: 'dp-topic-transition',
                        prompt: 'Transition reminder',
                        progressLabel: 'Topic · Step',
                        body: [
                                'For interior cells we add the top and left counts: dp[r][c] = dp[r - 1][c] + dp[r][c - 1].',
                                'This is the core idea we will quiz on next.'
                        ],
                        actionLabel: 'Got it'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-topic-base',
                        prompt: 'What value should dp[0][3] hold in a 4×4 grid?',
                        progressLabel: 'Topic · Q1',
                        hint: 'Look at the top edge moves.',
                        explanation:
                                'The top row only allows moving right, so there is exactly one way to reach any cell along that row.',
                        options: [
                                { id: 'A', label: 'A', text: '0' },
                                { id: 'B', label: 'B', text: '1' },
                                { id: 'C', label: 'C', text: '3' },
                                { id: 'D', label: 'D', text: '6' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-topic-transition-mcq',
                        prompt: 'dp[2][2] reads from which two neighbours?',
                        progressLabel: 'Topic · Q2',
                        hint: 'Trace the recurrence direction.',
                        explanation:
                                'We add paths from the cell above (1,2) and left (2,1) when computing dp[2][2].',
                        options: [
                                { id: 'A', label: 'A', text: '(1, 2) and (2, 1)' },
                                { id: 'B', label: 'B', text: '(1, 1) and (3, 3)' },
                                { id: 'C', label: 'C', text: '(0, 2) and (2, 0)' },
                                { id: 'D', label: 'D', text: '(2, 3) and (3, 2)' }
                        ],
                        correctOptionId: 'A'
                },
                {
                        kind: 'type-answer',
                        id: 'dp-topic-final',
                        prompt: 'How many paths reach the bottom-right of a 2×2 grid?',
                        progressLabel: 'Topic · Q3',
                        hint: 'Expand the recurrence or picture the moves.',
                        explanation:
                                'The recurrence yields 2 paths: right→down or down→right.',
                        answer: '2',
                        acceptableAnswers: ['two']
                }
        ]
};

export const dpFinalReviewQuiz: QuizDefinition = {
        id: 'dp-final-review',
        title: 'Final DP Review Quiz',
        description: 'Lock in the day\'s concepts with a quick check on memoization and tabulation.',
        topic: 'Dynamic Programming',
        estimatedMinutes: 4,
        stepId: 'final-review-quiz',
        completionCtaLabel: 'Done — back to plan',
        questions: [
                {
                        kind: 'multiple-choice',
                        id: 'dp-review-memory',
                        prompt: 'Why do we memoize the number of ways to climb n stairs?',
                        progressLabel: 'Review · Q1',
                        hint: 'Consider repeated branches in the recursion tree.',
                        explanation:
                                'Without memoization, each height splits into two calls that recompute the same counts. Storing results prevents exponential blow-up.',
                        options: [
                                {
                                        id: 'A',
                                        label: 'A',
                                        text: 'Because recursion is impossible without a memo table.'
                                },
                                {
                                        id: 'B',
                                        label: 'B',
                                        text: 'To reuse answers for the same remaining steps instead of recomputing them.'
                                },
                                {
                                        id: 'C',
                                        label: 'C',
                                        text: 'To guarantee constant-time transitions.'
                                },
                                {
                                        id: 'D',
                                        label: 'D',
                                        text: 'Because tabulation always uses more memory.'
                                }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-review-space',
                        prompt: 'When can we compress a 2D table into a 1D rolling array?',
                        progressLabel: 'Review · Q2',
                        hint: 'Check how each state reads previous data.',
                        explanation:
                                'We can roll the table when each cell only depends on the current row and the immediately previous row (or column), so overwriting does not break transitions.',
                        options: [
                                { id: 'A', label: 'A', text: 'Only if the graph of states has no cycles.' },
                                {
                                        id: 'B',
                                        label: 'B',
                                        text: 'Whenever transitions need at most one previously computed layer.'
                                },
                                { id: 'C', label: 'C', text: 'When the answer is zero.' },
                                { id: 'D', label: 'D', text: 'Never; 2D tables cannot be compressed.' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'type-answer',
                        id: 'dp-review-base',
                        prompt: 'What base value should memo[0] return for a Fibonacci-style recurrence?',
                        progressLabel: 'Review · Q3',
                        hint: 'Think about how many ways there are to reach step zero.',
                        explanation:
                                'Returning 0 would break the recurrence; we return 0th Fibonacci = 0 only when counting numbers. For ways to reach step zero, we return 1 to represent an empty path.',
                        answer: '1',
                        acceptableAnswers: ['one']
                }
        ]
};

export const quizRegistry: QuizDefinition[] = [dpWarmupQuiz, dpTopicDeck, dpFinalReviewQuiz];
