import { Timestamp } from 'firebase-admin/firestore';
import type { CodeProblem, PlanItem, QuizDefinition, Session } from '@spark/schemas';
import { getSession, saveSession, setCurrentSessionId } from './repo';
import { saveUserQuiz } from '../quiz/repo';
import { saveUserProblem } from '../code/problemRepo';

export type WelcomeTopicSummary = {
        id: string;
        title: string;
        emoji: string;
        tagline: string;
        highlight: string;
        bullets: string[];
        planPreview: Array<{
                id: string;
                title: string;
                kind: PlanItem['kind'];
                meta?: string;
                icon?: string;
        }>;
};

type WelcomeSessionTemplate = {
        id: string;
        sessionTitle: string;
        display: {
                title: string;
                emoji: string;
                tagline: string;
                highlight: string;
                bullets: string[];
        };
        plan: PlanItem[];
        quizzes: QuizDefinition[];
        problems: CodeProblem[];
};

const WELCOME_SESSION_TEMPLATES: readonly WelcomeSessionTemplate[] = [
        {
                id: 'welcome-modular-magic',
                sessionTitle: 'Clockwork Remainders',
                display: {
                        title: 'Clockwork Remainders',
                        emoji: '🕒',
                        tagline: 'Master clock arithmetic and spot repeating patterns quickly.',
                        highlight: 'Use modular thinking to tame loops, timestamps, and repeating states.',
                        bullets: [
                                'Clock arithmetic explained with intuitive visuals.',
                                'Residue classes show why different numbers behave the same.',
                                'Practice counting pairs whose sum is divisible by a modulus.'
                        ],
                },
                plan: [
                        {
                                id: 'mod-clock-intro',
                                kind: 'quiz',
                                title: 'Clock math in one glance',
                                summary: 'Two quick idea cards and a warm-up question.',
                                icon: '🕒',
                                meta: 'Primer',
                                progressKey: 'intro',
                        },
                        {
                                id: 'mod-residue-quiz',
                                kind: 'quiz',
                                title: 'Residue pattern check',
                                summary: 'Spot repeating remainders and congruent numbers.',
                                icon: '🔁',
                                meta: 'Quick check',
                                progressKey: 'residue',
                        },
                        {
                                id: 'mod-shortcuts-quiz',
                                kind: 'quiz',
                                title: 'Mod shortcuts toolkit',
                                summary: 'Mini tips for modular sums and differences.',
                                icon: '🧰',
                                meta: 'Trick cards',
                                progressKey: 'shortcuts',
                        },
                        {
                                id: 'mod-cycle-tracker',
                                kind: 'problem',
                                title: 'Cycle Tracker',
                                summary: 'Simulate a modular walk and list the first n remainders.',
                                icon: '📈',
                                meta: 'Coding warm-up',
                                difficulty: 'easy',
                                topic: 'Modular arithmetic',
                        },
                        {
                                id: 'mod-balanced-pairs',
                                kind: 'problem',
                                title: 'Balanced Remainder Pairs',
                                summary: 'Count pairs whose sum is divisible by k using remainder buckets.',
                                icon: '🤝',
                                meta: 'Apply it',
                                difficulty: 'easy',
                                topic: 'Counting',
                        },
                ],
                quizzes: [
                        {
                                id: 'mod-clock-intro',
                                title: 'Clock math in one glance',
                                topic: 'Modular arithmetic',
                                estimatedMinutes: 4,
                                description: 'Two fast idea cards plus a warm-up multiple-choice question.',
                                progressKey: 'intro',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'mod-clock-card-1',
                                                prompt: 'Remainders are clock positions',
                                                eyebrow: 'Idea card',
                                                body: 'Mod m asks “where do you land on a clock with m ticks?”. Every integer shares a slot with others that differ by multiples of m.',
                                                continueLabel: 'Next idea',
                                        },
                                        {
                                                kind: 'info-card',
                                                id: 'mod-clock-card-2',
                                                prompt: 'Same slot ⇒ same behaviour',
                                                eyebrow: 'Idea card',
                                                body: 'If a ≡ b (mod m) they give the same remainder when divided by m. That means any expression built from addition or subtraction will keep them in sync.',
                                                continueLabel: 'Try a question',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-clock-q1',
                                                prompt: 'On a clock with 12 positions, where does 17 land?',
                                                hint: 'Subtract full turns of 12.',
                                                explanation: '17 − 12 = 5 so 17 and 5 share the same slot modulo 12.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Position 1' },
                                                        { id: 'B', label: 'B', text: 'Position 3' },
                                                        { id: 'C', label: 'C', text: 'Position 5' },
                                                        { id: 'D', label: 'D', text: 'Position 11' },
                                                ],
                                                correctOptionId: 'C',
                                        },
                                ],
                        },
                        {
                                id: 'mod-residue-quiz',
                                title: 'Residue pattern check',
                                topic: 'Modular arithmetic',
                                estimatedMinutes: 4,
                                description: 'Notice repeating residues and what congruence really means.',
                                progressKey: 'residue',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'mod-residue-card',
                                                prompt: 'Residue classes',
                                                eyebrow: 'Idea card',
                                                body: 'Residues split numbers into m buckets. All numbers in bucket r look like r, r + m, r + 2m, …',
                                                continueLabel: 'Got it',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-residue-q1',
                                                prompt: 'What are the only possible values of n² mod 4?',
                                                hint: 'Test n ≡ 0,1,2,3 mod 4.',
                                                explanation: 'Squares of even numbers give remainder 0, squares of odd numbers give remainder 1.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0 or 1' },
                                                        { id: 'B', label: 'B', text: '0 or 2' },
                                                        { id: 'C', label: 'C', text: '1 or 3' },
                                                        { id: 'D', label: 'D', text: 'Every remainder is possible' },
                                                ],
                                                correctOptionId: 'A',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-residue-q2',
                                                prompt: 'Which statement is true about 29 and 5 with modulus 12?',
                                                hint: 'Compare remainders.',
                                                explanation: '29 − 5 = 24 which is a multiple of 12, so they share the same residue.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'They are not congruent because 29 is larger.' },
                                                        { id: 'B', label: 'B', text: 'They are congruent because 29 − 5 is divisible by 12.' },
                                                        { id: 'C', label: 'C', text: '29 has remainder 6 so it differs from 5.' },
                                                        { id: 'D', label: 'D', text: 'They are congruent only when modulus is 24.' },
                                                ],
                                                correctOptionId: 'B',
                                        },
                                ],
                        },
                        {
                                id: 'mod-shortcuts-quiz',
                                title: 'Mod shortcuts toolkit',
                                topic: 'Modular arithmetic',
                                estimatedMinutes: 5,
                                description: 'Learn quick tricks for modular sums and differences.',
                                progressKey: 'shortcuts',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'mod-shortcuts-card',
                                                prompt: 'Add, subtract, then reduce',
                                                eyebrow: 'Idea card',
                                                body: 'When adding or subtracting under mod m you can reduce at any step: (a mod m + b mod m) mod m = (a + b) mod m.',
                                                continueLabel: 'Try it',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-shortcuts-q1',
                                                prompt: 'Which expression equals (a − b) mod m for all integers?',
                                                hint: 'You can add multiples of m without changing the remainder.',
                                                explanation: 'Adding m keeps the value in the same residue class, so (a − b + m) mod m is always safe.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '(a − b + m) mod m' },
                                                        { id: 'B', label: 'B', text: '(a − b − 1) mod m' },
                                                        { id: 'C', label: 'C', text: '(b − a) mod m' },
                                                        { id: 'D', label: 'D', text: '(a + b) mod m' },
                                                ],
                                                correctOptionId: 'A',
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'mod-shortcuts-q2',
                                                prompt: 'Compute (123 + 987) mod 12.',
                                                hint: 'Reduce each part or the sum.',
                                                explanation: '123 ≡ 3, 987 ≡ 3, so the sum is 6 modulo 12.',
                                                answer: '6',
                                                acceptableAnswers: ['6'],
                                                placeholder: 'Enter a remainder',
                                        },
                                ],
                        },
                ],
                problems: [
                        {
                                slug: 'mod-cycle-tracker',
                                title: 'Cycle Tracker',
                                summary: 'Generate the repeating walk produced by adding a fixed step modulo a number.',
                                summaryBullets: [
                                        'Simulate (start + step·i) mod modulus.',
                                        'Return the first n remainders in order.',
                                        'Highlights how modular additions loop back.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Modular arithmetic',
                                topics: ['Modular arithmetic', 'Simulation'],
                                tags: ['mod', 'simulation', 'intro'],
                                tasks: [
                                        'Return an array containing the first n values of the modular walk.',
                                        'Each next value is (previous + step) mod modulus.',
                                        'Start from start mod modulus.'
                                ],
                                constraints: [
                                        '0 ≤ start, step ≤ 10^9',
                                        '2 ≤ modulus ≤ 10^4',
                                        '1 ≤ n ≤ 10^4'
                                ],
                                edgeCases: [
                                        'If modulus = 1 every value is 0.',
                                        'n = 1 should return just the starting remainder.',
                                        'Large start or step still reduce cleanly under the modulus.'
                                ],
                                hints: [
                                        'Compute the starting remainder once with start % modulus.',
                                        'Use a simple loop that pushes each value to the result list.',
                                        'Remember to update value = (value + step) % modulus each time.'
                                ],
                                followUpIdeas: [
                                        'Detect when the sequence starts repeating automatically.',
                                        'Support negative step values by normalising into [0, modulus).'
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'start = 7, step = 5, modulus = 12, n = 6',
                                                output: '[7, 0, 5, 10, 3, 8]',
                                                explanation: 'Add 5 each time and wrap around 12.',
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'start = 3, step = 3, modulus = 7, n = 4',
                                                output: '[3, 6, 2, 5]',
                                                explanation: '3→6→2→5 shows the 3-step cycle modulo 7.',
                                        },
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Linear simulation with modular reduction',
                                                overview: 'Track the current remainder and update it n times using modular addition.',
                                                steps: [
                                                        'Initialise current = start % modulus.',
                                                        'Repeat n times: append current then set current = (current + step) % modulus.',
                                                        'Return the collected list.',
                                                ],
                                                timeComplexity: 'O(n)',
                                                spaceComplexity: 'O(n)',
                                                keyIdeas: [
                                                        'Reducing each update keeps numbers small.',
                                                        'The walk automatically loops because only modulus distinct states exist.',
                                                ],
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Use arithmetic progression reasoning',
                                                        overview: 'Recognise the sequence is an arithmetic progression modulo modulus and pre-compute each term directly.',
                                                        steps: [
                                                                'For i from 0 to n−1 compute (start + i·step) % modulus.',
                                                                'Push each value into the result list.',
                                                        ],
                                                        timeComplexity: 'O(n)',
                                                        spaceComplexity: 'O(n)',
                                                        keyIdeas: ['Explicit formula', 'Same modular reduction idea'],
                                                },
                                        ],
                                },
                                source: {
                                        path: 'welcome/modular/cycle-tracker.md',
                                        markdown: `# Cycle Tracker\n\nYou start at \`start\`, add \`step\` each time, and take mod \`modulus\`. Produce the first \`n\` remainders so you can see the loop that appears.`,
                                },
                                metadataVersion: 1,
                                starterCode:
                                        `def remainder_cycle(start: int, step: int, modulus: int, n: int) -> list[int]:\n`
                                        + `    """Return the first n remainders of the modular walk."""\n`
                                        + `    result: list[int] = []\n`
                                        + `    # TODO: implement\n`
                                        + `    return result\n`,
                        },
                        {
                                slug: 'mod-balanced-pairs',
                                title: 'Balanced Remainder Pairs',
                                summary: 'Count unordered pairs of numbers whose sum is divisible by k.',
                                summaryBullets: [
                                        'Group numbers by remainder when divided by k.',
                                        'Match complementary remainders that sum to k.',
                                        'Handles zero and halfway remainders carefully.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Counting',
                                topics: ['Counting', 'Modular arithmetic'],
                                tags: ['mod', 'counting', 'hashmap'],
                                tasks: [
                                        'Return the number of index pairs (i, j) with i < j such that (nums[i] + nums[j]) % k == 0.',
                                        'Treat the array as unordered pairs: (i, j) and (j, i) count once.',
                                ],
                                constraints: [
                                        '1 ≤ nums.length ≤ 2 · 10^5',
                                        '1 ≤ k ≤ 10^4',
                                        '−10^9 ≤ nums[i] ≤ 10^9'
                                ],
                                edgeCases: [
                                        'k = 1 makes every pair valid.',
                                        'Remainder 0 pairs only with remainder 0.',
                                        'When k is even, remainder k/2 pairs only with itself.',
                                ],
                                hints: [
                                        'Count how many numbers fall into each remainder bucket.',
                                        'Pairs with remainder r need partners with remainder (k − r) % k.',
                                        'Handle r = 0 (and k even ⇒ r = k/2) using combinations n choose 2.',
                                ],
                                followUpIdeas: [
                                        'Return the actual pairs instead of just the count.',
                                        'Support streaming input where numbers arrive one at a time.',
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'nums = [1, 3, 2, 6, 4, 5], k = 3',
                                                output: '5',
                                                explanation: 'Valid pairs: (1,2), (1,5), (3,6), (2,4), (4,5).',
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'nums = [2, 2, 2, 2], k = 4',
                                                output: '6',
                                                explanation: 'All choose-2 pairs work because each remainder is 2 and 2 + 2 is divisible by 4.',
                                        },
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Frequency map of remainders',
                                                overview: 'Compute frequencies of each remainder, then add combinations of complementary buckets.',
                                                steps: [
                                                        'Normalise all remainders into [0, k).',
                                                        'Add C(freq[0], 2) for remainder 0.',
                                                        'For r from 1 to ⌊(k − 1)/2⌋ add freq[r] * freq[k − r].',
                                                        'If k is even, add C(freq[k/2], 2).',
                                                ],
                                                timeComplexity: 'O(n + k)',
                                                spaceComplexity: 'O(k)',
                                                keyIdeas: ['Complementary buckets', 'Combinatorics'],
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Quadratic scan',
                                                        overview: 'Check every pair directly with two loops. Works for tiny arrays only.',
                                                        steps: [
                                                                'Loop i from 0..n−1.',
                                                                'Loop j from i+1..n−1 and test (nums[i] + nums[j]) % k == 0.',
                                                        ],
                                                        timeComplexity: 'O(n²)',
                                                        spaceComplexity: 'O(1)',
                                                        keyIdeas: ['Brute force'],
                                                },
                                        ],
                                },
                                source: {
                                        path: 'welcome/modular/balanced-pairs.md',
                                        markdown: `# Balanced Remainder Pairs\n\nCount how many unordered pairs in the list sum to a multiple of \`k\` by grouping numbers into remainder buckets.`,
                                },
                                metadataVersion: 1,
                                starterCode:
                                        `def count_balanced_pairs(nums: list[int], k: int) -> int:\n`
                                        + `    """Return the number of unordered pairs whose sum is divisible by k."""\n`
                                        + `    # TODO: implement\n`
                                        + `    return 0\n`,
                        },
                ],
        },
        {
                id: 'welcome-binary-xor',
                sessionTitle: 'Binary Sleuths: XOR Tricks',
                display: {
                        title: 'Binary Sleuths: XOR Tricks',
                        emoji: '🧠',
                        tagline: 'Let XOR expose hidden patterns and parity secrets.',
                        highlight: 'Toggle bits, cancel duplicates, and build prefix XOR tools for fast queries.',
                        bullets: [
                                'Understand why a ⊕ a = 0 wipes duplicates away.',
                                'Use XOR to track parity in dynamic sets.',
                                'Apply prefix XOR to answer range questions instantly.'
                        ],
                },
                plan: [
                        {
                                id: 'xor-basics-primer',
                                kind: 'quiz',
                                title: 'XOR story time',
                                summary: 'Idea cards explaining XOR truth tables and cancellation.',
                                icon: '✨',
                                meta: 'Primer',
                                progressKey: 'primer',
                        },
                        {
                                id: 'xor-parity-quiz',
                                kind: 'quiz',
                                title: 'Parity detective',
                                summary: 'Quick checks on toggling bits and detecting odd counts.',
                                icon: '🕵️',
                                meta: 'Quick check',
                                progressKey: 'parity',
                        },
                        {
                                id: 'xor-prefix-play',
                                kind: 'quiz',
                                title: 'Prefix XOR playbook',
                                summary: 'See how prefix XOR answers subarray questions.',
                                icon: '📚',
                                meta: 'Trick cards',
                                progressKey: 'prefix',
                        },
                        {
                                id: 'xor-lonely-number',
                                kind: 'problem',
                                title: 'Lonely Number Hunt',
                                summary: 'Find the element that appears once when everything else appears twice.',
                                icon: '🔦',
                                meta: 'Coding warm-up',
                                difficulty: 'easy',
                                topic: 'Bit manipulation',
                        },
                        {
                                id: 'xor-prefix-queries',
                                kind: 'problem',
                                title: 'Lightning Range XOR',
                                summary: 'Answer XOR range queries using a prefix array.',
                                icon: '⚡️',
                                meta: 'Apply it',
                                difficulty: 'easy',
                                topic: 'Prefix XOR',
                        },
                ],
                quizzes: [
                        {
                                id: 'xor-basics-primer',
                                title: 'XOR story time',
                                topic: 'Bitwise operations',
                                estimatedMinutes: 4,
                                description: 'Two idea cards and a quick truth-table check to anchor XOR.',
                                progressKey: 'primer',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'xor-basics-card-1',
                                                prompt: 'XOR as “different?”',
                                                eyebrow: 'Idea card',
                                                body: 'a ⊕ b returns 1 when the bits differ and 0 when they match. It behaves like an exclusive-or question.',
                                                continueLabel: 'Next idea',
                                        },
                                        {
                                                kind: 'info-card',
                                                id: 'xor-basics-card-2',
                                                prompt: 'Cancel identical numbers',
                                                eyebrow: 'Idea card',
                                                body: 'Because a ⊕ a = 0 and a ⊕ 0 = a, XORing a list collapses every pair of equals, leaving only unpaired values.',
                                                continueLabel: 'Try a check',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-basics-q1',
                                                prompt: 'What is 1 ⊕ 1 ⊕ 0?',
                                                hint: 'Work left to right.',
                                                explanation: '1 ⊕ 1 = 0, and 0 ⊕ 0 = 0.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '1' },
                                                        { id: 'C', label: 'C', text: '2' },
                                                        { id: 'D', label: 'D', text: 'Depends on parentheses' },
                                                ],
                                                correctOptionId: 'A',
                                        },
                                ],
                        },
                        {
                                id: 'xor-parity-quiz',
                                title: 'Parity detective',
                                topic: 'Bitwise operations',
                                estimatedMinutes: 4,
                                description: 'Check how XOR tracks whether a count is odd or even.',
                                progressKey: 'parity',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-parity-q1',
                                                prompt: 'You XOR together IDs of players joining and leaving. What does the final XOR tell you?',
                                                hint: 'Think about duplicates cancelling.',
                                                explanation: 'Only players that joined without leaving remain in the XOR; if everyone left, the XOR is 0.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'It counts how many players joined overall.' },
                                                        { id: 'B', label: 'B', text: 'It equals the XOR of players still present.' },
                                                        { id: 'C', label: 'C', text: 'It becomes negative when more than two players remain.' },
                                                        { id: 'D', label: 'D', text: 'It is unrelated to the events.' },
                                                ],
                                                correctOptionId: 'B',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-parity-q2',
                                                prompt: 'If parity ⊕= 5 toggles each time number 5 appears, what does parity track?',
                                                hint: 'XORing 5 twice gives 0.',
                                                explanation: 'The parity variable becomes 5 when 5 appears an odd number of times; otherwise it is 0.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'The total number of elements processed.' },
                                                        { id: 'B', label: 'B', text: 'Whether 5 has appeared an odd number of times.' },
                                                        { id: 'C', label: 'C', text: 'The maximum value seen so far.' },
                                                        { id: 'D', label: 'D', text: 'The sum of all inputs.' },
                                                ],
                                                correctOptionId: 'B',
                                        },
                                ],
                        },
                        {
                                id: 'xor-prefix-play',
                                title: 'Prefix XOR playbook',
                                topic: 'Bitwise operations',
                                estimatedMinutes: 5,
                                description: 'See how prefix XOR arrays answer range queries in O(1).',
                                progressKey: 'prefix',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'xor-prefix-card',
                                                prompt: 'Prefix trick',
                                                eyebrow: 'Idea card',
                                                body: 'Store pref[i] = a₀ ⊕ a₁ ⊕ … ⊕ aᵢ. Then XOR on [l, r] is pref[r] ⊕ pref[l−1].',
                                                continueLabel: 'Answer time',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-prefix-q1',
                                                prompt: 'Given pref = [0, 5, 2, 6], what is XOR on indices [1, 2]?',
                                                hint: 'Use pref[2] ⊕ pref[0].',
                                                explanation: 'pref[2] = 2 and pref[0] = 0, so the answer is 2.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '2' },
                                                        { id: 'C', label: 'C', text: '4' },
                                                        { id: 'D', label: 'D', text: '6' },
                                                ],
                                                correctOptionId: 'B',
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'xor-prefix-q2',
                                                prompt: 'If pref[4] = 7 and pref[1] = 3, what is XOR on [2, 4]?',
                                                hint: 'pref[4] ⊕ pref[1].',
                                                explanation: '7 ⊕ 3 = 4.',
                                                answer: '4',
                                                acceptableAnswers: ['4'],
                                                placeholder: 'Enter the XOR',
                                        },
                                ],
                        },
                ],
                problems: [
                        {
                                slug: 'xor-lonely-number',
                                title: 'Lonely Number Hunt',
                                summary: 'Find the unique integer that appears exactly once while others appear twice.',
                                summaryBullets: [
                                        'XOR cancels duplicate pairs.',
                                        'Single pass over the array.',
                                        'No extra memory needed beyond one accumulator.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Bit manipulation',
                                topics: ['Bit manipulation'],
                                tags: ['xor', 'array'],
                                tasks: [
                                        'Return the value that appears exactly once.',
                                        'Every other value appears exactly twice.',
                                ],
                                constraints: [
                                        '1 ≤ nums.length ≤ 10^5',
                                        '−2^31 ≤ nums[i] < 2^31'
                                ],
                                edgeCases: [
                                        'Array of length 1 should return that element.',
                                        'Negative numbers behave the same under XOR.',
                                ],
                                hints: [
                                        'Start with result = 0.',
                                        'XOR every value into result.',
                                        'The leftover is the answer.',
                                ],
                                followUpIdeas: [
                                        'What if every element appears three times except one?',
                                        'Return both singletons if two numbers appear once each.',
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'nums = [2, 3, 2]',
                                                output: '3',
                                                explanation: '2 ⊕ 3 ⊕ 2 = 3.',
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'nums = [7]',
                                                output: '7',
                                                explanation: 'Only one element, so it is the answer.',
                                        },
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Single XOR sweep',
                                                overview: 'Use XOR to cancel duplicate numbers, leaving the unique element.',
                                                steps: [
                                                        'Initialise answer = 0.',
                                                        'For each value v in nums do answer ^= v.',
                                                        'Return answer.',
                                                ],
                                                timeComplexity: 'O(n)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: ['Cancellation', 'Streaming XOR'],
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Hash map counts',
                                                        overview: 'Count occurrences with a dictionary and return the key with count 1.',
                                                        steps: [
                                                                'Build frequency map.',
                                                                'Find entry with count 1.',
                                                        ],
                                                        timeComplexity: 'O(n)',
                                                        spaceComplexity: 'O(n)',
                                                        keyIdeas: ['Frequency counting'],
                                                },
                                        ],
                                },
                                source: {
                                        path: 'welcome/xor/lonely-number.md',
                                        markdown: `# Lonely Number Hunt\n\nEvery element appears twice except one. XOR everything together so pairs cancel and the unpaired value survives.`,
                                },
                                metadataVersion: 1,
                                starterCode:
                                        `def lonely_number(nums: list[int]) -> int:\n`
                                        + `    """Return the element that appears exactly once."""\n`
                                        + `    # TODO: implement\n`
                                        + `    return 0\n`,
                        },
                        {
                                slug: 'xor-prefix-queries',
                                title: 'Lightning Range XOR',
                                summary: 'Answer XOR queries on subarrays using a prefix XOR array.',
                                summaryBullets: [
                                        'Build prefix XOR so each query becomes two lookups.',
                                        'Handle many queries efficiently.',
                                        'Classic use of associativity and self-inverse behaviour.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Prefix XOR',
                                topics: ['Bit manipulation', 'Prefix XOR'],
                                tags: ['xor', 'prefix', 'queries'],
                                tasks: [
                                        'Given nums and queries of [l, r], return XOR of nums[l..r] for each query.',
                                        '0-based indices, inclusive ranges.',
                                ],
                                constraints: [
                                        '1 ≤ nums.length ≤ 2 · 10^5',
                                        '1 ≤ queries.length ≤ 2 · 10^5',
                                        '0 ≤ l ≤ r < nums.length'
                                ],
                                edgeCases: [
                                        'Single-element range should return that element.',
                                        'Large numbers still work because XOR is bitwise.',
                                ],
                                hints: [
                                        'Build pref where pref[0] = 0 and pref[i+1] = pref[i] ⊕ nums[i].',
                                        'Answer query [l, r] with pref[r+1] ⊕ pref[l].',
                                        'Store answers in order of queries.',
                                ],
                                followUpIdeas: [
                                        'Support online updates by using a Fenwick tree with XOR.',
                                        'Answer prefix XOR queries with exclusive range (l, r].',
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'nums = [3, 1, 4, 2], queries = [[0, 1], [1, 3]]',
                                                output: '[2, 7]',
                                                explanation: '[0,1] ⇒ 3 ⊕ 1 = 2, [1,3] ⇒ 1 ⊕ 4 ⊕ 2 = 7.',
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'nums = [5, 5, 5], queries = [[0, 2]]',
                                                output: '5',
                                                explanation: '5 ⊕ 5 ⊕ 5 = 5.',
                                        },
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Prefix XOR array',
                                                overview: 'Precompute prefix XOR values so each query is answered in O(1).',
                                                steps: [
                                                        'Create pref array of length n + 1 with pref[0] = 0.',
                                                        'Fill pref[i+1] = pref[i] ⊕ nums[i].',
                                                        'For each [l, r] push pref[r+1] ⊕ pref[l] to the answer list.',
                                                ],
                                                timeComplexity: 'O(n + q)',
                                                spaceComplexity: 'O(n)',
                                                keyIdeas: ['Associativity', 'Self-inverse XOR'],
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Per-query looping',
                                                        overview: 'For each query, loop from l to r and XOR elements directly.',
                                                        steps: [
                                                                'Repeat XOR accumulation per query.',
                                                        ],
                                                        timeComplexity: 'O(q · n)',
                                                        spaceComplexity: 'O(1)',
                                                        keyIdeas: ['Brute force'],
                                                },
                                        ],
                                },
                                source: {
                                        path: 'welcome/xor/prefix-queries.md',
                                        markdown: `# Lightning Range XOR\n\nPrecompute prefix XOR values once so every range query is answered by XORing two prefixes.`,
                                },
                                metadataVersion: 1,
                                starterCode:
                                        `def range_xor(nums: list[int], queries: list[tuple[int, int]]) -> list[int]:\n`
                                        + `    """Return XOR for each inclusive range [l, r]."""\n`
                                        + `    # TODO: implement\n`
                                        + `    return []\n`,
                        },
                ],
        },
        {
                id: 'welcome-nim-playbook',
                sessionTitle: 'Winning Nim Moves',
                display: {
                        title: 'Winning Nim Moves',
                        emoji: '🔥',
                        tagline: 'Learn the nim-sum trick to take control of impartial games.',
                        highlight: 'Turn piles of stones into binary stories and always find the winning move.',
                        bullets: [
                                'Introduce impartial games through the classic Nim setup.',
                                'Use XOR (nim-sum) as the invariant that decides winners.',
                                'Practice computing actual winning moves, not just who wins.'
                        ],
                },
                plan: [
                        {
                                id: 'nim-story-primer',
                                kind: 'quiz',
                                title: 'Meet the Nim game',
                                summary: 'Story cards explaining rules and nim-sum idea.',
                                icon: '🎲',
                                meta: 'Primer',
                                progressKey: 'primer',
                        },
                        {
                                id: 'nim-xor-quiz',
                                kind: 'quiz',
                                title: 'Nim-sum inspector',
                                summary: 'Check nim-sum calculations on small piles.',
                                icon: '🔍',
                                meta: 'Quick check',
                                progressKey: 'inspector',
                        },
                        {
                                id: 'nim-endgame-quiz',
                                kind: 'quiz',
                                title: 'Endgame instincts',
                                summary: 'Decide what the winning move should look like.',
                                icon: '🏁',
                                meta: 'Strategy quiz',
                                progressKey: 'endgame',
                        },
                        {
                                id: 'nim-basic-winner',
                                kind: 'problem',
                                title: 'Nim Winner Detector',
                                summary: 'Decide if the first player has a forced win.',
                                icon: '✅',
                                meta: 'Coding warm-up',
                                difficulty: 'easy',
                                topic: 'Game theory',
                        },
                        {
                                id: 'nim-suggest-move',
                                kind: 'problem',
                                title: 'Winning Move Finder',
                                summary: 'Output one winning move using nim-sum guidance.',
                                icon: '🎯',
                                meta: 'Apply it',
                                difficulty: 'easy',
                                topic: 'Game theory',
                        },
                ],
                quizzes: [
                        {
                                id: 'nim-story-primer',
                                title: 'Meet the Nim game',
                                topic: 'Game theory',
                                estimatedMinutes: 4,
                                description: 'Idea cards covering the rules of Nim and the nim-sum invariant.',
                                progressKey: 'primer',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'nim-story-card-1',
                                                prompt: 'Nim in one minute',
                                                eyebrow: 'Idea card',
                                                body: 'Players take turns removing any number of stones from exactly one pile. Whoever takes the last stone wins.',
                                                continueLabel: 'Next idea',
                                        },
                                        {
                                                kind: 'info-card',
                                                id: 'nim-story-card-2',
                                                prompt: 'Nim-sum magic',
                                                eyebrow: 'Idea card',
                                                body: 'Write pile sizes in binary and XOR them. A zero nim-sum means the current position is losing if the opponent plays perfectly.',
                                                continueLabel: 'Try a question',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'nim-story-q1',
                                                prompt: 'You see piles [1, 4, 5]. What is the nim-sum?',
                                                hint: 'Compute 1 ⊕ 4 ⊕ 5.',
                                                explanation: '1 ⊕ 4 = 5 and 5 ⊕ 5 = 0, so the nim-sum is 0.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '1' },
                                                        { id: 'C', label: 'C', text: '4' },
                                                        { id: 'D', label: 'D', text: '5' },
                                                ],
                                                correctOptionId: 'A',
                                        },
                                ],
                        },
                        {
                                id: 'nim-xor-quiz',
                                title: 'Nim-sum inspector',
                                topic: 'Game theory',
                                estimatedMinutes: 4,
                                description: 'Practice nim-sum computations on quick scenarios.',
                                progressKey: 'inspector',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'nim-inspector-q1',
                                                prompt: 'Which position is winning for the player to move?',
                                                hint: 'Non-zero nim-sum means winning.',
                                                explanation: 'Only [2, 3, 4] has nim-sum 5 (non-zero).',
                                                options: [
                                                        { id: 'A', label: 'A', text: '[1, 2, 3]' },
                                                        { id: 'B', label: 'B', text: '[2, 3, 4]' },
                                                        { id: 'C', label: 'C', text: '[1, 1, 2, 2]' },
                                                        { id: 'D', label: 'D', text: '[7, 7]' },
                                                ],
                                                correctOptionId: 'B',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'nim-inspector-q2',
                                                prompt: 'For piles [3, 6, 8], what is the nim-sum?',
                                                hint: 'Compute 3 ⊕ 6 ⊕ 8.',
                                                explanation: '3 ⊕ 6 = 5 and 5 ⊕ 8 = 13.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '5' },
                                                        { id: 'C', label: 'C', text: '13' },
                                                        { id: 'D', label: 'D', text: '14' },
                                                ],
                                                correctOptionId: 'C',
                                        },
                                ],
                        },
                        {
                                id: 'nim-endgame-quiz',
                                title: 'Endgame instincts',
                                topic: 'Game theory',
                                estimatedMinutes: 5,
                                description: 'Decide how to move to reach a zero nim-sum.',
                                progressKey: 'endgame',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'nim-endgame-card',
                                                prompt: 'Aim for zero nim-sum',
                                                eyebrow: 'Strategy tip',
                                                body: 'From a winning position (nim-sum ≠ 0) remove stones so the nim-sum becomes 0. Choose a pile whose top bit matches the nim-sum.',
                                                continueLabel: 'Apply it',
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'nim-endgame-q1',
                                                prompt: 'Piles [1, 4, 5] have nim-sum 0. What does that mean?',
                                                hint: 'Zero nim-sum is losing for the player to move.',
                                                explanation: 'The player to move is in a losing position if the opponent plays perfectly.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Current player wins with any move.' },
                                                        { id: 'B', label: 'B', text: 'Current player loses if the opponent mirrors optimally.' },
                                                        { id: 'C', label: 'C', text: 'It is a draw.' },
                                                        { id: 'D', label: 'D', text: 'The game restarts.' },
                                                ],
                                                correctOptionId: 'B',
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'nim-endgame-q2',
                                                prompt: 'Piles [2, 4, 6] have nim-sum 0. If you add a pile of size 3, what is the nim-sum now?',
                                                hint: '0 ⊕ 3.',
                                                explanation: 'Adding pile 3 makes the nim-sum 3.',
                                                answer: '3',
                                                acceptableAnswers: ['3'],
                                                placeholder: 'Enter nim-sum',
                                        },
                                ],
                        },
                ],
                problems: [
                        {
                                slug: 'nim-basic-winner',
                                title: 'Nim Winner Detector',
                                summary: 'Determine if the first player to move can force a win under optimal play.',
                                summaryBullets: [
                                        'Compute nim-sum of all piles.',
                                        'Zero nim-sum ⇒ losing; non-zero ⇒ winning.',
                                        'One pass through the pile list.',
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Game theory',
                                topics: ['Game theory', 'Bit manipulation'],
                                tags: ['nim', 'xor'],
                                tasks: [
                                        'Return True if the first player wins, otherwise False.',
                                ],
                                constraints: [
                                        '1 ≤ piles.length ≤ 10^5',
                                        '0 ≤ piles[i] ≤ 10^9'
                                ],
                                edgeCases: [
                                        'All piles zero ⇒ nim-sum zero ⇒ losing.',
                                        'Single non-zero pile ⇒ winning.',
                                ],
                                hints: [
                                        'Initialise nim_sum = 0 and XOR every pile size.',
                                        'Return nim_sum != 0.',
                                ],
                                followUpIdeas: [
                                        'Support misère Nim where taking the last stone loses.',
                                        'Handle games with different move rules (Wythoff, turning turtles).',
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'piles = [1, 4, 5]',
                                                output: 'False',
                                                explanation: 'Nim-sum is 0, so the first player loses.',
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'piles = [2, 3, 4]',
                                                output: 'True',
                                                explanation: 'Nim-sum is 5, so the first player has a winning move.',
                                        },
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Compute nim-sum once',
                                                overview: 'XOR all pile sizes and check if the result is zero.',
                                                steps: [
                                                        'Set nim = 0.',
                                                        'For each pile size p set nim ^= p.',
                                                        'Return nim != 0.',
                                                ],
                                                timeComplexity: 'O(n)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: ['Nim-sum invariant'],
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Recursive game tree (for tiny inputs)',
                                                        overview: 'Simulate all moves recursively. Works only for tiny piles but builds intuition.',
                                                        steps: [
                                                                'Recurse on every legal move.',
                                                                'Check if any move leads to losing position for opponent.',
                                                        ],
                                                        timeComplexity: 'Exponential',
                                                        spaceComplexity: 'O(n)',
                                                        keyIdeas: ['Backtracking'],
                                                },
                                        ],
                                },
                                source: {
                                        path: 'welcome/nim/basic-winner.md',
                                        markdown: `# Nim Winner Detector\n\nCompute the nim-sum of the piles. Non-zero means the player to move can force a win with perfect play.`,
                                },
                                metadataVersion: 1,
                                starterCode:
                                        `def first_player_wins(piles: list[int]) -> bool:\n`
                                        + `    """Return True if the first player wins under normal Nim rules."""\n`
                                        + `    # TODO: implement\n`
                                        + `    return False\n`,
                        },
                        {
                                slug: 'nim-suggest-move',
                                title: 'Winning Move Finder',
                                summary: 'Given a winning Nim position, output one move that makes the nim-sum zero.',
                                summaryBullets: [
                                        'Find the highest bit set in the nim-sum.',
                                        'Choose a pile containing that bit and reduce it.',
                                        'Return the pile index and how many stones to remove.',
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Game theory',
                                topics: ['Game theory', 'Bit manipulation'],
                                tags: ['nim', 'xor', 'strategy'],
                                tasks: [
                                        'Return (pileIndex, stonesRemoved) representing a winning move.',
                                        'If position is losing (nim-sum 0), return (-1, 0).',
                                ],
                                constraints: [
                                        '1 ≤ piles.length ≤ 10^5',
                                        '0 ≤ piles[i] ≤ 10^9'
                                ],
                                edgeCases: [
                                        'If nim-sum is zero, there is no winning move.',
                                        'If multiple winning moves exist, any one is fine.',
                                ],
                                hints: [
                                        'Compute nim-sum first; if zero return (-1, 0).',
                                        'Find a pile where (pile ⊕ nim_sum) < pile.',
                                        'Remove stones so the pile becomes pile ⊕ nim_sum.',
                                ],
                                followUpIdeas: [
                                        'List all winning moves instead of one.',
                                        'Explain the move in natural language (e.g., “take 3 from pile 2”).',
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'piles = [2, 3, 4]',
                                                output: '(2, 1)',
                                                explanation: 'Nim-sum 5. Changing pile 2 (0-indexed) from 4 to 4 ⊕ 5 = 1 removes 3 stones. Returning (2, 3) would also work.',
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'piles = [1, 4, 5]',
                                                output: '(-1, 0)',
                                                explanation: 'Nim-sum is 0 so no winning move.',
                                        },
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Target the high bit of the nim-sum',
                                                overview: 'Pick a pile containing the highest set bit of the nim-sum and reduce it so the new pile value equals pile ⊕ nim_sum.',
                                                steps: [
                                                        'Compute nim_sum of all piles.',
                                                        'If nim_sum == 0 return (-1, 0).',
                                                        'Find first index i with (piles[i] ⊕ nim_sum) < piles[i].',
                                                        'Let target = piles[i] ⊕ nim_sum and removed = piles[i] - target.',
                                                        'Return (i, removed).',
                                                ],
                                                timeComplexity: 'O(n)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: ['Nim-sum invariant', 'Greedy choice of pile'],
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Brute-force search',
                                                        overview: 'Try every legal move and check which results yield nim-sum 0.',
                                                        steps: [
                                                                'For each pile simulate removing 1..pile stones.',
                                                                'Stop when resulting nim-sum is zero.',
                                                        ],
                                                        timeComplexity: 'O(total stones)',
                                                        spaceComplexity: 'O(1)',
                                                        keyIdeas: ['Exhaustive search'],
                                                },
                                        ],
                                },
                                source: {
                                        path: 'welcome/nim/winning-move.md',
                                        markdown: `# Winning Move Finder\n\nFind any move that turns the current Nim position into a zero nim-sum state. Return the pile index and how many stones to remove.`,
                                },
                                metadataVersion: 1,
                                starterCode:
                                        `def winning_move(piles: list[int]) -> tuple[int, int]:\n`
                                        + `    """Return (pileIndex, stonesRemoved) for a winning move or (-1, 0)."""\n`
                                        + `    # TODO: implement\n`
                                        + `    return -1, 0\n`,
                        },
                ],
        },
];

const TEMPLATE_BY_ID = new Map(WELCOME_SESSION_TEMPLATES.map((template) => [template.id, template] as const));

export function listWelcomeTopicSummaries(): WelcomeTopicSummary[] {
        return WELCOME_SESSION_TEMPLATES.map((template) => ({
                id: template.id,
                title: template.display.title,
                emoji: template.display.emoji,
                tagline: template.display.tagline,
                highlight: template.display.highlight,
                bullets: [...template.display.bullets],
                planPreview: template.plan.map((item) => ({
                        id: item.id,
                        title: item.title,
                        kind: item.kind,
                        meta: item.meta,
                        icon: item.icon,
                })),
        }));
}

export async function createWelcomeSessionForUser(
        userId: string,
        templateId: string
): Promise<Session> {
        const template = TEMPLATE_BY_ID.get(templateId);
        if (!template) {
                throw new Error(`Unknown welcome session template: ${templateId}`);
        }

        const existing = await getSession(userId, template.id);
        if (existing) {
                await setCurrentSessionId(userId, existing.id).catch((error) => {
                        console.warn('Unable to set current session for returning user', error);
                });
                return existing;
        }

        const createdAt = Timestamp.now().toDate();
        const session: Session = {
                id: template.id,
                title: template.sessionTitle,
                createdAt,
                plan: template.plan,
        };

        await saveSession(userId, session);

        for (const quiz of template.quizzes) {
                await saveUserQuiz(userId, session.id, quiz);
        }
        for (const problem of template.problems) {
                await saveUserProblem(userId, session.id, problem);
        }

        await setCurrentSessionId(userId, session.id).catch((error) => {
                console.warn('Unable to set current session after welcome creation', error);
        });

        return session;
}
