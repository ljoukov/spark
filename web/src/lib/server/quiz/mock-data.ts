import type { QuizDefinition } from '$lib/types/quiz';

export const dynamicProgrammingWarmupQuiz: QuizDefinition = {
        id: 'dp-warmup-quiz',
        title: 'DP Warm-up: Core Ideas',
        topic: 'Dynamic Programming',
        estimatedMinutes: 4,
        progressKey: 'warmup',
        description: 'Three quick checks on overlapping subproblems, base cases, and tabulation flow.',
        questions: [
                {
                        kind: 'multiple-choice',
                        id: 'dp-warmup-overlap',
                        prompt: 'When do overlapping subproblems appear?',
                        hint: 'Look for recursion that revisits the same state.',
                        explanation:
                                'Overlapping subproblems happen when different recursion branches compute the same state, such as dp(amount) for the same amount in coin change.',
                        options: [
                                { id: 'A', label: 'A', text: 'When each recursive call produces a unique state' },
                                { id: 'B', label: 'B', text: 'When the same subproblem is needed in multiple branches' },
                                { id: 'C', label: 'C', text: 'Only when a problem uses graphs' },
                                { id: 'D', label: 'D', text: 'Whenever a greedy choice is possible' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-warmup-base-case',
                        prompt: 'In a counting DP (ways to form a sum), what does the base case dp[0] usually equal?',
                        hint: 'Consider how many ways exist to pick nothing.',
                        explanation:
                                'Setting dp[0] = 1 encodes the single way to make zero — pick no elements. It seeds the recurrence for positive amounts.',
                        options: [
                                { id: 'A', label: 'A', text: '0, because no work is needed' },
                                { id: 'B', label: 'B', text: '1, representing the empty choice' },
                                { id: 'C', label: 'C', text: 'The smallest coin value' },
                                { id: 'D', label: 'D', text: 'Undefined until we process input' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-warmup-order',
                        prompt: 'Why do tabulation solutions fill states in a specific order?',
                        hint: 'Think about dependencies between states.',
                        explanation:
                                'Tabulation evaluates states so that every dependency is ready. The order respects the recurrence graph, similar to a topological order.',
                        options: [
                                { id: 'A', label: 'A', text: 'To match the call stack order of recursion exactly' },
                                { id: 'B', label: 'B', text: 'So each state reads values that were already computed' },
                                { id: 'C', label: 'C', text: 'Because arrays must be filled from left to right' },
                                { id: 'D', label: 'D', text: 'To minimise memory usage with memoization' }
                        ],
                        correctOptionId: 'B'
                }
        ]
};

export const dynamicProgrammingTopicDeck: QuizDefinition = {
        id: 'dp-topic-deck',
        title: 'Topic Deep Dive: Coin Change Transitions',
        topic: 'Dynamic Programming',
        estimatedMinutes: 6,
        progressKey: 'topic',
        description: 'Two quick concept cards and three guided questions to lock in bottom-up coin change intuition.',
        questions: [
                {
                        kind: 'info-card',
                        id: 'dp-topic-card-1',
                        prompt: 'Snapshot the state',
                        eyebrow: 'Concept spotlight',
                        body: 'For coin change we define dp[amount] as the number of ways to reach “amount”. The base case dp[0] = 1 means the empty selection is valid. Every other state will build on this anchor.',
                        continueLabel: 'Next concept'
                },
                {
                        kind: 'info-card',
                        id: 'dp-topic-card-2',
                        prompt: 'Build transitions carefully',
                        eyebrow: 'Concept spotlight',
                        body: 'When iterating coins outside the amount loop, each coin contributes combinations without caring about order. The recurrence becomes dp[amount] += dp[amount - coin] whenever amount ≥ coin.',
                        continueLabel: "Let's quiz it"
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-topic-question-1',
                        prompt: 'Why does iterating coins outermost avoid double counting order?',
                        hint: 'Consider how often each coin is revisited for a given amount.',
                        explanation:
                                'Processing coins in the outer loop ensures each combination of coins is built once. Amounts only expand forward using the coins we have already considered.',
                        options: [
                                { id: 'A', label: 'A', text: 'It forces the algorithm to use each coin at most once.' },
                                { id: 'B', label: 'B', text: 'Amounts never see a coin that has not been fully processed before.' },
                                { id: 'C', label: 'C', text: 'It sorts the coins so permutations collapse naturally.' },
                                { id: 'D', label: 'D', text: 'It lets us skip the base case entirely.' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-topic-question-2',
                        prompt: 'If dp[amount] counts combinations, what does dp[amount - coin] contribute in the recurrence?',
                        hint: 'Relate the subproblem to a smaller target.',
                        explanation:
                                'dp[amount - coin] counts all combinations that form the smaller amount; adding the current coin extends each of those to reach the larger amount.',
                        options: [
                                { id: 'A', label: 'A', text: 'Only the combination that uses the largest coin.' },
                                { id: 'B', label: 'B', text: 'All ways to form the reduced amount so we can append the current coin.' },
                                { id: 'C', label: 'C', text: 'A placeholder zero until the outer loop ends.' },
                                { id: 'D', label: 'D', text: 'The minimum number of coins required.' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-topic-question-3',
                        prompt: 'What happens if we flip the loops and iterate amounts outside coins?',
                        hint: 'Watch what happens to ordering.',
                        explanation:
                                'Iterating amounts first counts permutations because each amount can revisit every coin in every order, inflating the total compared with combinations.',
                        options: [
                                { id: 'A', label: 'A', text: 'We still count combinations because subtraction is commutative.' },
                                { id: 'B', label: 'B', text: 'We start counting ordered permutations of coins instead of combinations.' },
                                { id: 'C', label: 'C', text: 'The algorithm fails for larger coin values.' },
                                { id: 'D', label: 'D', text: 'dp[0] must be set to 0 to stay correct.' }
                        ],
                        correctOptionId: 'B'
                }
        ]
};

export const dynamicProgrammingReviewQuiz: QuizDefinition = {
        id: 'dp-review-quiz',
        title: 'DP Review: Ready for Easy Interviews',
        topic: 'Dynamic Programming',
        estimatedMinutes: 5,
        progressKey: 'review',
        description: 'Wrap up with scenario-based questions that mirror easy LeetCode DP prompts.',
        questions: [
                {
                        kind: 'multiple-choice',
                        id: 'dp-review-stairs',
                        prompt: 'You are counting ways to climb n stairs taking 1 or 2 steps. Which recurrence fits?',
                        hint: 'Each state depends on the previous two.',
                        explanation:
                                'dp[i] = dp[i - 1] + dp[i - 2] adds the paths that end with a 1-step and a 2-step, mirroring the Fibonacci pattern.',
                        options: [
                                { id: 'A', label: 'A', text: 'dp[i] = dp[i - 1] + 1' },
                                { id: 'B', label: 'B', text: 'dp[i] = dp[i - 1] + dp[i - 2]' },
                                { id: 'C', label: 'C', text: 'dp[i] = 2 * dp[i - 1]' },
                                { id: 'D', label: 'D', text: 'dp[i] = dp[i - 1] - dp[i - 2]' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-review-grid',
                        prompt: 'For unique paths in an m×n grid moving only right or down, which base cases initialise the DP table?',
                        hint: 'Think about the top row and left column.',
                        explanation:
                                'Cells in the top row and left column each have exactly one path leading to them, so setting them to 1 lets the rest of the table build off their values.',
                        options: [
                                { id: 'A', label: 'A', text: 'Set the diagonal to 1 and everything else to 0.' },
                                { id: 'B', label: 'B', text: 'Set the top row and left column to 1.' },
                                { id: 'C', label: 'C', text: 'Set only dp[0][0] = 1 and leave the rest empty.' },
                                { id: 'D', label: 'D', text: 'Set every cell to 0 to start.' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-review-memo',
                        prompt: 'In a memoized recursion for house robber, when do we store results in the cache?',
                        hint: 'We avoid recomputing overlapping states.',
                        explanation:
                                'After computing the best loot from a given index, we store it before returning so future calls reuse the cached result.',
                        options: [
                                { id: 'A', label: 'A', text: 'Before recursing so we can skip work entirely.' },
                                { id: 'B', label: 'B', text: 'Right after solving a subproblem so repeated calls can reuse it.' },
                                { id: 'C', label: 'C', text: 'Only when the answer is zero.' },
                                { id: 'D', label: 'D', text: 'Never—we recompute each branch for clarity.' }
                        ],
                        correctOptionId: 'B'
                }
        ]
};

export const dynamicProgrammingQuizzes = [
        dynamicProgrammingWarmupQuiz,
        dynamicProgrammingTopicDeck,
        dynamicProgrammingReviewQuiz
] satisfies readonly QuizDefinition[];
