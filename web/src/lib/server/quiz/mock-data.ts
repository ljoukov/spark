import type { QuizDefinition } from '$lib/types/quiz';

export const dynamicProgrammingWarmupQuiz: QuizDefinition = {
        id: 'dp-warmup',
        title: 'DP Warm-up Quiz',
        topic: 'Dynamic Programming',
        estimatedMinutes: 4,
        description: 'Three quick questions to make sure the DP basics are fresh.',
        progressKey: 'warmup',
        questions: [
                {
                        kind: 'multiple-choice',
                        id: 'dp-signal-fit',
                        prompt: 'When is a DP approach usually a good fit?',
                        hint: 'Look for repeat work and the ability to build larger answers.',
                        explanation:
                                'Dynamic programming shines when subproblems repeat and the final answer can be composed from optimal subproblem answers.',
                        options: [
                                { id: 'A', label: 'A', text: 'Whenever the input size is small' },
                                { id: 'B', label: 'B', text: 'When greedy choice is clearly optimal' },
                                {
                                        id: 'C',
                                        label: 'C',
                                        text: 'When subproblems overlap and combine into an optimal whole'
                                },
                                { id: 'D', label: 'D', text: 'If the solution only needs sorting' }
                        ],
                        correctOptionId: 'C'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-base-cases',
                        prompt: 'Why do we seed base cases before filling a DP table?',
                        hint: 'Think about the very first states we depend on.',
                        explanation:
                                'Base cases stop recursion or kick off tabulation so every later state has something concrete to lean on.',
                        options: [
                                { id: 'A', label: 'A', text: 'To avoid using recursion entirely' },
                                { id: 'B', label: 'B', text: 'They remove the need for transitions' },
                                {
                                        id: 'C',
                                        label: 'C',
                                        text: 'They provide the first solved states required by later transitions'
                                },
                                { id: 'D', label: 'D', text: 'To guarantee O(1) memory' }
                        ],
                        correctOptionId: 'C'
                },
                {
                        kind: 'type-answer',
                        id: 'dp-memo-term',
                        prompt: 'What do we call the top-down technique that caches answers to avoid duplicate recursion?',
                        hint: 'It pairs recursion with a map or array.',
                        explanation: 'Top-down DP with a cache is called memoization.',
                        answer: 'memoization',
                        acceptableAnswers: ['memoisation']
                }
        ]
};

export const dynamicProgrammingTopicDeck: QuizDefinition = {
        id: 'dp-topic',
        title: 'DP Topic Deck',
        topic: 'Dynamic Programming',
        estimatedMinutes: 6,
        description: 'Two quick info cards followed by three gentle check-ins to cement the DP mindset.',
        progressKey: 'topic',
        questions: [
                {
                        kind: 'info-card',
                        id: 'dp-info-states',
                        prompt: 'Build a simple DP state',
                        body: 'Think of DP as bookkeeping. We choose a state that captures “progress so far”—for 1D problems that is often the index or amount we have already processed. A smaller state means fewer entries to fill.',
                        bullets: [
                                'Pick a clear meaning for dp[i], e.g. number of ways to reach total i.',
                                'List the smallest states that can be answered immediately (base cases).'
                        ],
                        actionLabel: 'Got it'
                },
                {
                        kind: 'info-card',
                        id: 'dp-info-transitions',
                        prompt: 'Plan the transitions',
                        body: 'Ask “How can I move from one state to the next?” For coin change, every coin lets you extend a smaller amount. For decoding, a one- or two-digit chunk extends the prefix answer.',
                        bullets: [
                                'Transitions only use already-computed states.',
                                'Keep each step tiny: add a coin, read one or two characters, etc.'
                        ],
                        actionLabel: 'Next card'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-state-definition',
                        prompt: 'If dp[i] stores the number of ways to reach amount i, what should dp[0] be?',
                        explanation: 'We set dp[0] = 1 to represent the single way to make zero (choose no coins).',
                        options: [
                                { id: 'A', label: 'A', text: '0, because no coins are used' },
                                { id: 'B', label: 'B', text: '1, representing the empty combination' },
                                { id: 'C', label: 'C', text: 'Depends on the coin set' },
                                { id: 'D', label: 'D', text: 'The smallest coin value' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-transition-choice',
                        prompt: 'For decoding ways, which transition keeps the DP table easy?',
                        hint: 'Focus on how many characters you consume each step.',
                        explanation:
                                'We extend the prefix by consuming one digit (if valid) or two digits (if they form 10–26). Each adds the count from the earlier prefix.',
                        options: [
                                { id: 'A', label: 'A', text: 'Jump three digits at a time' },
                                { id: 'B', label: 'B', text: 'Only use the previous digit' },
                                {
                                        id: 'C',
                                        label: 'C',
                                        text: 'Add the counts from one-digit and two-digit extensions when valid'
                                },
                                { id: 'D', label: 'D', text: 'Multiply the counts together' }
                        ],
                        correctOptionId: 'C'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-iteration-order',
                        prompt: 'When tabulating a 1D DP such as coin change, which iteration order keeps dependencies ready?',
                        explanation:
                                'Iterating amount from 0 upwards ensures every smaller amount is already computed when we need it.',
                        options: [
                                { id: 'A', label: 'A', text: 'Descending from target to 0' },
                                { id: 'B', label: 'B', text: 'Random order' },
                                { id: 'C', label: 'C', text: 'Ascending from 0 to target' },
                                { id: 'D', label: 'D', text: 'Only iterate the base cases' }
                        ],
                        correctOptionId: 'C'
                }
        ]
};

export const dynamicProgrammingReviewQuiz: QuizDefinition = {
        id: 'dp-review',
        title: 'DP Review Quiz',
        topic: 'Dynamic Programming',
        estimatedMinutes: 4,
        description: 'A final, easy check to lock in what you just practiced.',
        progressKey: 'review',
        questions: [
                {
                        kind: 'multiple-choice',
                        id: 'dp-why-tabulate',
                        prompt: 'Why does tabulation help avoid recursion depth issues?',
                        explanation:
                                'Tabulation fills the table iteratively, so we never build a deep call stack and still reuse every computed state.',
                        options: [
                                { id: 'A', label: 'A', text: 'It uses divide and conquer instead of DP' },
                                { id: 'B', label: 'B', text: 'We precompute answers iteratively without recursion' },
                                { id: 'C', label: 'C', text: 'It randomly guesses answers then fixes them' },
                                { id: 'D', label: 'D', text: 'It sorts the input to avoid recursion' }
                        ],
                        correctOptionId: 'B'
                },
                {
                        kind: 'multiple-choice',
                        id: 'dp-space-trick',
                        prompt: 'When can you safely compress a 2D DP into a 1D array?',
                        hint: 'Only when transitions rely on the previous row or column.',
                        explanation:
                                'If each state only depends on the immediately previous row or column, we can reuse a rolling array without losing data.',
                        options: [
                                { id: 'A', label: 'A', text: 'Whenever the answer fits in memory' },
                                { id: 'B', label: 'B', text: 'Only when the table is symmetric' },
                                {
                                        id: 'C',
                                        label: 'C',
                                        text: 'When transitions read from a limited window such as the prior row'
                                },
                                { id: 'D', label: 'D', text: 'Never—it always changes the answer' }
                        ],
                        correctOptionId: 'C'
                },
                {
                        kind: 'type-answer',
                        id: 'dp-reuse-answer',
                        prompt: 'Fill in the blank: Dynamic programming trades ______ for time.',
                        hint: 'We store answers so we do not recompute them.',
                        explanation: 'Dynamic programming spends extra memory to avoid recomputation.',
                        answer: 'memory',
                        acceptableAnswers: ['space']
                }
        ]
};
