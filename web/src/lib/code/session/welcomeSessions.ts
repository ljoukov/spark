import type { CodeProblem, PlanItem, QuizDefinition } from '@spark/schemas';

export type WelcomeSessionTemplate = {
        /**
         * Stable identifier used for client selection.
         * This does not include the per-user suffix appended when persisting.
         */
        id: string;
        title: string;
        tagline: string;
        description: string;
        focusPoints: readonly string[];
        estimatedMinutes: number;
        session: {
                id: string;
                title: string;
                plan: PlanItem[];
        };
        quizzes: QuizDefinition[];
        problems: CodeProblem[];
};

export const WELCOME_SESSIONS: readonly WelcomeSessionTemplate[] = [
        {
                id: 'welcome-mod-clocks',
                title: 'Clockwork Mods',
                tagline: 'Master remainders using clock arithmetic tricks.',
                description:
                        'Learn how clocks make modular arithmetic feel natural, then practise by crunching friendly remainder puzzles.',
                focusPoints: [
                        'Build intuition for remainders using clock faces',
                        'Use modular arithmetic to keep numbers tame',
                        'Apply mods to simple but practical coding tasks'
                ],
                estimatedMinutes: 18,
                session: {
                        id: 'mod-clock-welcome',
                        title: 'Clock arithmetic mini quest',
                        plan: [
                                {
                                        id: 'mod-clock-intro',
                                        kind: 'quiz',
                                        title: 'Clock arithmetic primer',
                                        summary: 'Two quick idea cards explain why remainders wrap like a clock.',
                                        icon: '🕒',
                                        meta: 'Theory cards',
                                        progressKey: 'intro'
                                },
                                {
                                        id: 'mod-clock-patterns',
                                        kind: 'quiz',
                                        title: 'Spot the remainder pattern',
                                        summary: 'Check your instincts on cycles and negatives with tiny MCQs.',
                                        icon: '🔁',
                                        meta: 'Quiz',
                                        progressKey: 'pattern'
                                },
                                {
                                        id: 'looping-scoreboard',
                                        kind: 'problem',
                                        title: 'Looping scoreboard',
                                        summary: 'Simulate an endlessly wrapping scoreboard in just a few lines.',
                                        icon: '🎯',
                                        meta: 'Problem',
                                        difficulty: 'easy',
                                        topic: 'Modular arithmetic'
                                },
                                {
                                        id: 'mod-clock-mental',
                                        kind: 'quiz',
                                        title: 'Mental mod drills',
                                        summary: 'Short answer practice to cement shortcuts for big numbers.',
                                        icon: '⚡️',
                                        meta: 'Quiz',
                                        progressKey: 'mental'
                                },
                                {
                                        id: 'huge-number-remainder',
                                        kind: 'problem',
                                        title: 'Huge number remainder',
                                        summary: 'Turn a giant decimal string into a quick remainder without overflow.',
                                        icon: '🧮',
                                        meta: 'Problem',
                                        difficulty: 'easy',
                                        topic: 'Number theory'
                                }
                        ]
                },
                quizzes: [
                        {
                                id: 'mod-clock-intro',
                                title: 'Clock arithmetic primer',
                                topic: 'Modular arithmetic',
                                estimatedMinutes: 4,
                                progressKey: 'intro',
                                description: 'Two friendly idea cards and a check question to anchor the idea of wrapping.',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'mod-clock-card-1',
                                                prompt: 'Why clocks teach remainders',
                                                eyebrow: 'Idea card',
                                                body: 'Think of counting hours: after 12 comes 1 again. Modular arithmetic copies this: 14 ≡ 2 (mod 12) because stepping 14 hours forward lands on the same place as 2 hours.',
                                                continueLabel: 'Next'
                                        },
                                        {
                                                kind: 'info-card',
                                                id: 'mod-clock-card-2',
                                                prompt: 'Negative steps',
                                                eyebrow: 'Idea card',
                                                body: 'Moving backwards is just moving forward the other way. On a clock, −3 hours is the same as adding 9 hours. That is why −3 ≡ 9 (mod 12).',
                                                continueLabel: 'Got it'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-clock-check',
                                                prompt: 'On a 12-hour clock, what time is 29 hours after 3 o’clock?',
                                                hint: 'Remove full turns of 12 hours.',
                                                explanation: '29 = 12 + 12 + 5, so you land 5 hours after 3 → 8 o’clock.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '2 o’clock' },
                                                        { id: 'B', label: 'B', text: '5 o’clock' },
                                                        { id: 'C', label: 'C', text: '8 o’clock' },
                                                        { id: 'D', label: 'D', text: '11 o’clock' }
                                                ],
                                                correctOptionId: 'C'
                                        }
                                ]
                        },
                        {
                                id: 'mod-clock-patterns',
                                title: 'Spot the remainder pattern',
                                topic: 'Modular arithmetic',
                                estimatedMinutes: 3,
                                progressKey: 'pattern',
                                description: 'Three bite-sized MCQs to test your feel for cycles and negatives.',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-cycle-length',
                                                prompt: 'Numbers repeat every 6 on a mod 6 clock. Which pair matches the same spot?',
                                                hint: 'Take each number mod 6.',
                                                explanation: '17 mod 6 is 5 and −1 mod 6 is also 5. They share the same remainder.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '17 and −1' },
                                                        { id: 'B', label: 'B', text: '14 and 6' },
                                                        { id: 'C', label: 'C', text: '10 and 5' },
                                                        { id: 'D', label: 'D', text: '7 and 0' }
                                                ],
                                                correctOptionId: 'A'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-negative',
                                                prompt: 'What is −8 mod 5 written as a positive remainder?',
                                                hint: 'Add 5 until it is non-negative.',
                                                explanation: '−8 + 5 + 5 = 2, so the positive remainder is 2.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '−3' },
                                                        { id: 'B', label: 'B', text: '0' },
                                                        { id: 'C', label: 'C', text: '2' },
                                                        { id: 'D', label: 'D', text: '3' }
                                                ],
                                                correctOptionId: 'C'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-cycle-skip',
                                                prompt: 'If today is Thursday, what day will it be in 20 days (mod 7)?',
                                                hint: '20 mod 7 = 6.',
                                                explanation: '20 ≡ 6 (mod 7), so move 6 days ahead: Thursday → Wednesday.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Tuesday' },
                                                        { id: 'B', label: 'B', text: 'Wednesday' },
                                                        { id: 'C', label: 'C', text: 'Thursday' },
                                                        { id: 'D', label: 'D', text: 'Friday' }
                                                ],
                                                correctOptionId: 'B'
                                        }
                                ]
                        },
                        {
                                id: 'mod-clock-mental',
                                title: 'Mental mod drills',
                                topic: 'Modular arithmetic',
                                estimatedMinutes: 3,
                                progressKey: 'mental',
                                description: 'Short answer questions where you slice big numbers down using mod rules.',
                                questions: [
                                        {
                                                kind: 'type-answer',
                                                id: 'mod-mental-1',
                                                prompt: 'Compute 10,000,007 mod 9.',
                                                hint: 'Use the fact that 9 divides 10,000,008.',
                                                explanation: '10,000,007 ≡ −1 ≡ 8 (mod 9).',
                                                answer: '8',
                                                acceptableAnswers: ['8']
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'mod-mental-2',
                                                prompt: 'What is the last digit of 7^53?',
                                                hint: 'The last digit repeats every 4 powers for numbers coprime with 10.',
                                                explanation: '7^1 → 7, 7^2 → 9, 7^3 → 3, 7^4 → 1 then repeats. 53 mod 4 = 1 ⇒ last digit 7.',
                                                answer: '7',
                                                acceptableAnswers: ['7']
                                        }
                                ]
                        }
                ],
                problems: [
                        {
                                slug: 'looping-scoreboard',
                                title: 'Looping Scoreboard',
                                summary: 'Keep a match scoreboard within range by applying a modulus after every update.',
                                summaryBullets: [
                                        'Apply modulo after each increment to stay within the display range',
                                        'Handle negative adjustments by wrapping them back into [0, m)',
                                        'Simple one-pass simulation ideal for modular warm-ups'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Modular arithmetic',
                                topics: ['Modular arithmetic', 'Simulation'],
                                tags: ['mod', 'simulation', 'intro'],
                                tasks: [
                                        'Given the modulus m and a list of score changes, return the final displayed score',
                                        'Apply wrapping after each change so the score always stays between 0 and m − 1'
                                ],
                                constraints: [
                                        '1 ≤ m ≤ 10^6',
                                        '1 ≤ n ≤ 10^5 updates',
                                        'Each update fits in a signed 32-bit integer'
                                ],
                                edgeCases: [
                                        'Large negative updates should wrap correctly',
                                        'Multiple wraps may happen in one update when |delta| ≥ m',
                                        'Start value is zero before any updates'
                                ],
                                hints: [
                                        'Normalise each running total with ((value % m) + m) % m',
                                        'Process updates sequentially; no fancy data structures needed',
                                        'Watch for languages where % keeps the sign of the dividend'
                                ],
                                followUpIdeas: [
                                        'Add a query mode to report the score after each update',
                                        'Track both home and away scores with independent moduli'
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'm = 12, updates = [5, 9, -4]',
                                                output: '10',
                                                explanation: '0→5→2→10 using mod 12 after each step.'
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'm = 7, updates = [14, -3, 20]',
                                                output: '3',
                                                explanation: '14 wraps to 0, then −3 → 4, then +20 → 3 (since 20 mod 7 = 6).'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Running sum with safe modulus',
                                                overview:
                                                        'Maintain the running score and clamp it into [0, m) after every change using a positive modulus helper.',
                                                steps: [
                                                        'Start with score = 0',
                                                        'For each delta, set score = ((score + delta) % m + m) % m',
                                                        'Return the final score'
                                                ],
                                                timeComplexity: 'O(n)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: [
                                                        'Modulo keeps results inside the display range',
                                                        'Adding m before taking % handles negative numbers'
                                                ]
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Normalise once per update batch',
                                                        overview: 'Sum all updates first, then apply the safe modulus just once at the end. Equivalent but less streaming-friendly.',
                                                        steps: [
                                                                'Compute total = sum(updates)',
                                                                'Return ((total % m) + m) % m'
                                                        ],
                                                        timeComplexity: 'O(n)',
                                                        spaceComplexity: 'O(1)',
                                                        keyIdeas: ['Modulo distributes over addition']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'generated/welcome/looping-scoreboard.md',
                                        markdown:
                                                '# Looping Scoreboard\n\nYou operate a simple scoreboard that shows numbers from 0 to m − 1. Each time a team scores you add (or subtract) a value. To keep the display tidy you wrap the number with modulo m after every change. Given m and the list of updates, return the final displayed score.'
                                },
                                metadataVersion: 1,
                                starterCode:
                                        '' +
                                        'def looping_scoreboard(m: int, updates: list[int]) -> int:\n' +
                                        '    score = 0\n' +
                                        '    for delta in updates:\n' +
                                        '        score = (score + delta) % m\n' +
                                        '        if score < 0:\n' +
                                        '            score += m\n' +
                                        '    return score\n'
                        },
                        {
                                slug: 'huge-number-remainder',
                                title: 'Huge Number Remainder',
                                summary: 'Turn a massive decimal string into a manageable remainder modulo m.',
                                summaryBullets: [
                                        'Process digits left to right without converting to big integers',
                                        'Use modular multiplication to keep numbers bounded',
                                        'Classic trick for handling enormous inputs safely'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Number theory',
                                topics: ['Modular arithmetic', 'Strings'],
                                tags: ['mod', 'string', 'intro'],
                                tasks: [
                                        'Given a decimal string s and modulus m, return s mod m',
                                        'Assume s can have up to 10^5 digits so direct parsing will overflow standard types'
                                ],
                                constraints: [
                                        '1 ≤ |s| ≤ 100000',
                                        's contains digits only and may start with 0',
                                        '2 ≤ m ≤ 10^9'
                                ],
                                edgeCases: [
                                        'String may represent zero',
                                        'm may not be prime',
                                        'Leading zeros should not change the answer'
                                ],
                                hints: [
                                        'Keep a rolling remainder: rem = (rem * 10 + digit) % m',
                                        'Process the string once from left to right',
                                        'Convert each character to its numeric value with ord(c) - ord("0")'
                                ],
                                followUpIdeas: [
                                        'Support bases other than 10',
                                        'Handle negative numbers or output the modulo for several m values at once'
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 's = "987654321123456789", m = 11',
                                                output: '3',
                                                explanation: 'Rolling mod gives final remainder 3.'
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 's = "00042", m = 9',
                                                output: '6',
                                                explanation: '42 mod 9 = 6; leading zeros do not matter.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Single pass rolling remainder',
                                                overview:
                                                        'Iterate over digits, updating the remainder by multiplying by 10 and adding the new digit before taking mod m.',
                                                steps: [
                                                        'Initialise remainder = 0',
                                                        'For each character c in s, set digit = ord(c) - ord("0")',
                                                        'Update remainder = (remainder * 10 + digit) % m',
                                                        'Return remainder'
                                                ],
                                                timeComplexity: 'O(|s|)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: [
                                                        'Modulo distributes over addition and multiplication',
                                                        'Avoids big-integer libraries while staying exact'
                                                ]
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Process blocks of digits',
                                                        overview: 'Read chunks of k digits at a time to reduce mod operations—useful if language costs for % are high.',
                                                        steps: [
                                                                'Take digits in base 10^k blocks',
                                                                'Multiply remainder by 10^k mod m, add block value, then mod again'
                                                        ],
                                                        timeComplexity: 'O(|s|)',
                                                        spaceComplexity: 'O(1)',
                                                        keyIdeas: ['Same maths, different batching']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'generated/welcome/huge-number-remainder.md',
                                        markdown:
                                                '# Huge Number Remainder\n\nYou are given a decimal string so long that it cannot be parsed into a built-in integer type. Compute its remainder when divided by m using modular arithmetic: read each digit, update a rolling remainder, and never let the number blow up.'
                                },
                                metadataVersion: 1,
                                starterCode:
                                        '' +
                                        'def huge_number_remainder(s: str, m: int) -> int:\n' +
                                        '    remainder = 0\n' +
                                        '    for ch in s:\n' +
                                        '        digit = ord(ch) - ord("0")\n' +
                                        '        remainder = (remainder * 10 + digit) % m\n' +
                                        '    return remainder\n'
                        }
                ]
        },
        {
                id: 'welcome-bit-parity',
                title: 'Parity Puzzles with XOR',
                tagline: 'Use XOR to track parity, flips, and hidden bits.',
                description:
                        'Discover how XOR captures even/odd behaviour, then solve light-switch style problems that rely on parity tracking.',
                focusPoints: [
                        'Understand XOR as “different or same” for bits',
                        'Use parity to spot the unique element in a crowd',
                        'Model toggle-heavy puzzles with prefix XORs'
                ],
                estimatedMinutes: 20,
                session: {
                        id: 'xor-parity-welcome',
                        title: 'Parity and XOR warm-up',
                        plan: [
                                {
                                        id: 'xor-parity-intro',
                                        kind: 'quiz',
                                        title: 'Parity as XOR',
                                        summary: 'Idea cards plus a quick question introduce XOR as parity tracker.',
                                        icon: '💡',
                                        meta: 'Theory cards',
                                        progressKey: 'intro'
                                },
                                {
                                        id: 'xor-quick-check',
                                        kind: 'quiz',
                                        title: 'Quick XOR checks',
                                        summary: 'Short MCQs cement algebra rules for XOR.',
                                        icon: '❓',
                                        meta: 'Quiz',
                                        progressKey: 'check'
                                },
                                {
                                        id: 'single-odd-switch',
                                        kind: 'problem',
                                        title: 'Single odd switch',
                                        summary: 'Find the element that appears an odd number of times using XOR.',
                                        icon: '🔦',
                                        meta: 'Problem',
                                        difficulty: 'easy',
                                        topic: 'Bit manipulation'
                                },
                                {
                                        id: 'xor-prefix-practice',
                                        kind: 'quiz',
                                        title: 'Prefix parity drills',
                                        summary: 'Compute prefix XORs to answer toggle questions quickly.',
                                        icon: '🧠',
                                        meta: 'Quiz',
                                        progressKey: 'prefix'
                                },
                                {
                                        id: 'lights-on-intervals',
                                        kind: 'problem',
                                        title: 'Lights on intervals',
                                        summary: 'Track toggles over ranges by leaning on prefix XOR arrays.',
                                        icon: '💡',
                                        meta: 'Problem',
                                        difficulty: 'easy',
                                        topic: 'Bit manipulation'
                                }
                        ]
                },
                quizzes: [
                        {
                                id: 'xor-parity-intro',
                                title: 'Parity as XOR',
                                topic: 'Bit manipulation',
                                estimatedMinutes: 4,
                                progressKey: 'intro',
                                description: 'A tiny deck describing XOR and parity with one confirm question.',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'xor-card-1',
                                                prompt: 'XOR is parity',
                                                eyebrow: 'Idea card',
                                                body: 'For bits, XOR returns 1 when inputs differ. Chain many numbers together and XOR tells you if an odd number of them had a 1 in that bit position.',
                                                continueLabel: 'Next idea'
                                        },
                                        {
                                                kind: 'info-card',
                                                id: 'xor-card-2',
                                                prompt: 'Self-cancelling pairs',
                                                eyebrow: 'Idea card',
                                                body: 'Because a ⊕ a = 0, any even number of repeats disappears inside an XOR fold. That is why XOR helps when exactly one thing appears an odd number of times.',
                                                continueLabel: 'Check me'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-check',
                                                prompt: 'What is 13 ⊕ 13 ⊕ 7?',
                                                hint: 'XORing something with itself cancels.',
                                                explanation: '13 ⊕ 13 = 0 so the whole expression is just 7.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '7' },
                                                        { id: 'C', label: 'C', text: '13' },
                                                        { id: 'D', label: 'D', text: '20' }
                                                ],
                                                correctOptionId: 'B'
                                        }
                                ]
                        },
                        {
                                id: 'xor-quick-check',
                                title: 'Quick XOR checks',
                                topic: 'Bit manipulation',
                                estimatedMinutes: 3,
                                progressKey: 'check',
                                description: 'Three multiple-choice questions covering core XOR rules.',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-associative',
                                                prompt: 'Which property lets us reorder XOR without changing the result?',
                                                hint: 'Think about grouping and swapping.',
                                                explanation: 'XOR is associative and commutative, so we can regroup freely.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Associativity and commutativity' },
                                                        { id: 'B', label: 'B', text: 'Distributivity over division' },
                                                        { id: 'C', label: 'C', text: 'Idempotence' },
                                                        { id: 'D', label: 'D', text: 'Monotonicity' }
                                                ],
                                                correctOptionId: 'A'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-zero',
                                                prompt: 'What is the effect of XORing a number with 0?',
                                                hint: 'Check the truth table.',
                                                explanation: '0 is the identity for XOR, so the number stays the same.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'It becomes 1' },
                                                        { id: 'B', label: 'B', text: 'It flips all bits' },
                                                        { id: 'C', label: 'C', text: 'It stays unchanged' },
                                                        { id: 'D', label: 'D', text: 'It doubles' }
                                                ],
                                                correctOptionId: 'C'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-two',
                                                prompt: 'What is 5 ⊕ 2 ⊕ 5?',
                                                hint: 'Cancel the duplicates.',
                                                explanation: '5 ⊕ 5 cancels, leaving 2.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '2' },
                                                        { id: 'C', label: 'C', text: '5' },
                                                        { id: 'D', label: 'D', text: '7' }
                                                ],
                                                correctOptionId: 'B'
                                        }
                                ]
                        },
                        {
                                id: 'xor-prefix-practice',
                                title: 'Prefix parity drills',
                                topic: 'Bit manipulation',
                                estimatedMinutes: 4,
                                progressKey: 'prefix',
                                description: 'Practise computing prefix XORs for toggle puzzles.',
                                questions: [
                                        {
                                                kind: 'type-answer',
                                                id: 'xor-prefix-1',
                                                prompt: 'Given array [1, 2, 3, 4], what is the prefix XOR up to index 3 (1-indexed)?',
                                                hint: 'Compute 1 ⊕ 2 ⊕ 3.',
                                                explanation: '1 ⊕ 2 ⊕ 3 = (1 ⊕ 2) ⊕ 3 = 3 ⊕ 3 = 0.',
                                                answer: '0',
                                                acceptableAnswers: ['0']
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'xor-prefix-2',
                                                prompt: 'Switches toggled on intervals [1,3], [2,4]. How many times is switch 2 toggled?',
                                                hint: 'Count ranges covering index 2.',
                                                explanation: 'Index 2 appears in both ranges → toggled twice → back to off.',
                                                answer: '2',
                                                acceptableAnswers: ['2']
                                        }
                                ]
                        }
                ],
                problems: [
                        {
                                slug: 'single-odd-switch',
                                title: 'Single Odd Switch',
                                summary: 'Find the one value with odd frequency using a full-array XOR.',
                                summaryBullets: [
                                        'Fold the array with XOR; duplicates cancel out',
                                        'No sorting or hash maps required',
                                        'Classic parity trick frequently used in interviews'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Bit manipulation',
                                topics: ['Bit manipulation', 'Arrays'],
                                tags: ['xor', 'parity', 'intro'],
                                tasks: [
                                        'Given an array where every value appears an even number of times except one, return that unique value',
                                        'Use O(1) extra space'
                                ],
                                constraints: [
                                        '1 ≤ n ≤ 10^5',
                                        'Array elements fit in 32-bit signed integers',
                                        'Exactly one value has odd frequency'
                                ],
                                edgeCases: [
                                        'n = 1 should return the single element',
                                        'Large arrays should stay linear time',
                                        'Negative numbers behave the same under XOR'
                                ],
                                hints: [
                                        'Initialise result = 0 and XOR every element into it',
                                        'Remember that a ⊕ a = 0',
                                        'Associativity lets you XOR in any order'
                                ],
                                followUpIdeas: [
                                        'What if two numbers appear odd times?',
                                        'Can you adapt this to streaming data?'
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'nums = [2, 3, 2]',
                                                output: '3',
                                                explanation: '2 cancels with 2; leftover is 3.'
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'nums = [5, 1, 5, 1, 5]',
                                                output: '5',
                                                explanation: 'Pairs of (5,5) and (1,1) vanish; final result 5.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Fold with XOR',
                                                overview: 'Iterate through the array once, XORing into an accumulator. Everything that appears an even number of times cancels.',
                                                steps: [
                                                        'Set result = 0',
                                                        'For each value v, set result = result ⊕ v',
                                                        'Return result'
                                                ],
                                                timeComplexity: 'O(n)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: [
                                                        'XOR is associative and commutative',
                                                        'Pairs annihilate each other'
                                                ]
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Counting with a hash map',
                                                        overview: 'Use a map from value to frequency. Easier to reason about but uses O(n) space.',
                                                        steps: [
                                                                'Count each value',
                                                                'Return the key with odd count'
                                                        ],
                                                        timeComplexity: 'O(n)',
                                                        spaceComplexity: 'O(n)',
                                                        keyIdeas: ['Useful when you cannot rely on parity trick']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'generated/welcome/single-odd-switch.md',
                                        markdown:
                                                '# Single Odd Switch\n\nYou are watching a wall of switches that flip on and off. Every switch flips an even number of times except one mischievous switch that flips an odd number of times. By XORing every switch label together, the even ones cancel, leaving the odd one. Implement that trick.'
                                },
                                metadataVersion: 1,
                                starterCode:
                                        '' +
                                        'def single_odd_switch(nums: list[int]) -> int:\n' +
                                        '    result = 0\n' +
                                        '    for value in nums:\n' +
                                        '        result ^= value\n' +
                                        '    return result\n'
                        },
                        {
                                slug: 'lights-on-intervals',
                                title: 'Lights on Intervals',
                                summary: 'Track a row of lights where each query toggles a full interval.',
                                summaryBullets: [
                                        'Convert interval toggles into prefix XOR differences',
                                        'Compute final states in linear time',
                                        'Shows parity as a data-structure superpower'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Bit manipulation',
                                topics: ['Bit manipulation', 'Prefix sums'],
                                tags: ['xor', 'prefix', 'interval'],
                                tasks: [
                                        'Given n lights (initially off) and q toggle operations on inclusive intervals, return the final on/off pattern',
                                        'Each operation toggles every light in [l, r]'
                                ],
                                constraints: [
                                        '1 ≤ n ≤ 10^5',
                                        '1 ≤ q ≤ 10^5',
                                        '1 ≤ l ≤ r ≤ n'
                                ],
                                edgeCases: [
                                        'Intervals touching at boundaries',
                                        'Single-element intervals',
                                        'Many overlapping ranges'
                                ],
                                hints: [
                                        'Use a difference array where diff[l] ^= 1 and diff[r+1] ^= 1',
                                        'Prefix XOR over diff gives toggles per position',
                                        'A light is on if its prefix XOR is 1'
                                ],
                                followUpIdeas: [
                                        'Answer online queries as they arrive',
                                        'Support turning ranges on/off explicitly, not just toggling'
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'n = 5, ops = [[1,3],[2,4]]',
                                                output: '[1, 0, 0, 1, 0]',
                                                explanation: 'Lights 1-3 toggle, then 2-4 toggle. Final states: [on, off, off, on, off].'
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'n = 4, ops = [[1,4],[1,4]]',
                                                output: '[0, 0, 0, 0]',
                                                explanation: 'Two identical toggles cancel out.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Difference array with prefix XOR',
                                                overview:
                                                        'Track toggles in a difference array using XOR, then prefix XOR to recover whether each position was toggled an odd number of times.',
                                                steps: [
                                                        'Initialise diff array of size n + 1 with zeros',
                                                        'For each [l, r], do diff[l] ^= 1 and diff[r + 1] ^= 1 if r + 1 ≤ n',
                                                        'Scan positions 1..n taking running ^= to know if light is on',
                                                        'Return final list of 0/1 values'
                                                ],
                                                timeComplexity: 'O(n + q)',
                                                spaceComplexity: 'O(n)',
                                                keyIdeas: [
                                                        'Prefix XOR mirrors prefix sums but with parity',
                                                        'Difference arrays turn range updates into two point updates'
                                                ]
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Simulate each operation',
                                                        overview: 'Toggle each range directly. Works but costs O(nq). Useful for understanding before optimising.',
                                                        steps: [
                                                                'For each [l, r], loop i from l to r and flip lights[i]'
                                                        ],
                                                        timeComplexity: 'O(nq)',
                                                        spaceComplexity: 'O(n)',
                                                        keyIdeas: ['Baseline approach to contrast with prefix XOR']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'generated/welcome/lights-on-intervals.md',
                                        markdown:
                                                '# Lights on Intervals\n\nYou manage a strip of lights. Each instruction toggles every light between l and r inclusive. Instead of simulating each toggle individually, store a difference array of XOR markers. A prefix XOR tells you if a position was toggled an odd number of times, which means the light ends on.'
                                },
                                metadataVersion: 1,
                                starterCode:
                                        '' +
                                        'def lights_on_intervals(n: int, ops: list[tuple[int, int]]) -> list[int]:\n' +
                                        '    diff = [0] * (n + 1)\n' +
                                        '    for l, r in ops:\n' +
                                        '        diff[l - 1] ^= 1\n' +
                                        '        if r < n:\n' +
                                        '            diff[r] ^= 1\n' +
                                        '    result = []\n' +
                                        '    cur = 0\n' +
                                        '    for i in range(n):\n' +
                                        '        cur ^= diff[i]\n' +
                                        '        result.append(cur)\n' +
                                        '    return result\n'
                        }
                ]
        },
        {
                id: 'welcome-fib-codes',
                title: 'Fibonacci Coding Tricks',
                tagline: 'Represent numbers with non-adjacent Fibonacci pieces.',
                description:
                        'Zeckendorf’s theorem says every number has a unique sum of non-touching Fibonacci numbers—learn how to build and decode it.',
                focusPoints: [
                        'Generate Fibonacci numbers big enough for a target',
                        'Greedy selection builds the unique Zeckendorf representation',
                        'Use the representation to solve simple coding challenges'
                ],
                estimatedMinutes: 22,
                session: {
                        id: 'fib-coding-welcome',
                        title: 'Zeckendorf warm welcome',
                        plan: [
                                {
                                        id: 'fib-zeckendorf-intro',
                                        kind: 'quiz',
                                        title: 'Zeckendorf 101',
                                        summary: 'Two idea cards show why non-adjacent Fibonacci sums are special.',
                                        icon: '🌀',
                                        meta: 'Theory cards',
                                        progressKey: 'intro'
                                },
                                {
                                        id: 'fib-greedy-check',
                                        kind: 'quiz',
                                        title: 'Greedy works? prove it!',
                                        summary: 'Answer mini questions about the greedy algorithm.',
                                        icon: '🧩',
                                        meta: 'Quiz',
                                        progressKey: 'greedy'
                                },
                                {
                                        id: 'fib-decompose-number',
                                        kind: 'problem',
                                        title: 'Fibonacci decomposition',
                                        summary: 'Convert a number into its Zeckendorf representation.',
                                        icon: '🔢',
                                        meta: 'Problem',
                                        difficulty: 'easy',
                                        topic: 'Number theory'
                                },
                                {
                                        id: 'fib-binary-quiz',
                                        kind: 'quiz',
                                        title: 'Read Fibonacci code words',
                                        summary: 'Decode short Zeckendorf-style bitstrings.',
                                        icon: '📜',
                                        meta: 'Quiz',
                                        progressKey: 'decode'
                                },
                                {
                                        id: 'fib-interval-sum',
                                        kind: 'problem',
                                        title: 'Count Fibonacci codes',
                                        summary: 'Count representations within a range without adjacency clashes.',
                                        icon: '📈',
                                        meta: 'Problem',
                                        difficulty: 'easy',
                                        topic: 'Dynamic programming'
                                }
                        ]
                },
                quizzes: [
                        {
                                id: 'fib-zeckendorf-intro',
                                title: 'Zeckendorf 101',
                                topic: 'Number theory',
                                estimatedMinutes: 4,
                                progressKey: 'intro',
                                description: 'Idea cards walk through Zeckendorf’s theorem with a friendly example.',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'fib-card-1',
                                                prompt: 'Every number, unique recipe',
                                                eyebrow: 'Idea card',
                                                body: 'Zeckendorf’s theorem: every positive integer can be written uniquely as a sum of non-consecutive Fibonacci numbers (using F1 = 1, F2 = 2).',
                                                continueLabel: 'Next insight'
                                        },
                                        {
                                                kind: 'info-card',
                                                id: 'fib-card-2',
                                                prompt: 'Greedy selection',
                                                eyebrow: 'Idea card',
                                                body: 'To find the representation, grab the largest Fibonacci ≤ n, subtract it, then repeat with the remainder skipping the immediate next Fibonacci to avoid adjacency.',
                                                continueLabel: 'Quiz me'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'fib-card-check',
                                                prompt: 'Which set is a valid Zeckendorf sum for 46?',
                                                hint: 'Use Fibonacci numbers 1,2,3,5,8,13,21,34,55…',
                                                explanation: '34 + 8 + 3 + 1 = 46 with no consecutive Fibonacci numbers.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '34 + 8 + 3 + 1' },
                                                        { id: 'B', label: 'B', text: '34 + 13 - 1' },
                                                        { id: 'C', label: 'C', text: '21 + 13 + 8 + 4' },
                                                        { id: 'D', label: 'D', text: '21 + 13 + 8 + 3 + 1' }
                                                ],
                                                correctOptionId: 'A'
                                        }
                                ]
                        },
                        {
                                id: 'fib-greedy-check',
                                title: 'Greedy works? prove it!',
                                topic: 'Number theory',
                                estimatedMinutes: 4,
                                progressKey: 'greedy',
                                description: 'Questions double-check why the greedy choice is safe.',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'fib-greedy-largest',
                                                prompt: 'Why must the representation include the largest Fibonacci ≤ n?',
                                                hint: 'Otherwise you would need more smaller numbers and risk adjacency.',
                                                explanation: 'Skipping it would force using smaller consecutive Fibonacci numbers, breaking the no-adjacency rule.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Because Fibonacci numbers are prime' },
                                                        { id: 'B', label: 'B', text: 'Because the greedy step avoids needing consecutive terms' },
                                                        { id: 'C', label: 'C', text: 'Because 1 must always appear' },
                                                        { id: 'D', label: 'D', text: 'Because Fibonacci numbers form a geometric series' }
                                                ],
                                                correctOptionId: 'B'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'fib-skip-next',
                                                prompt: 'Why do we skip the next Fibonacci number after picking one?',
                                                hint: 'Adjacent Fibonacci numbers should not be used together.',
                                                explanation: 'Skipping ensures the final set has no consecutive Fibonacci numbers.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Because it keeps the count of terms even' },
                                                        { id: 'B', label: 'B', text: 'Because the next Fibonacci would create an adjacent pair' },
                                                        { id: 'C', label: 'C', text: 'Because the next Fibonacci is always odd' },
                                                        { id: 'D', label: 'D', text: 'Because Fibonacci numbers repeat digits' }
                                                ],
                                                correctOptionId: 'B'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'fib-unique',
                                                prompt: 'Why is the representation unique?',
                                                hint: 'Think about the largest Fibonacci used.',
                                                explanation: 'If two representations differed, compare the largest Fibonacci in each—one must be larger, contradicting minimality.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Because Fibonacci numbers are all distinct primes' },
                                                        { id: 'B', label: 'B', text: 'Because each step removes the largest remaining Fibonacci' },
                                                        { id: 'C', label: 'C', text: 'Because the sum of every other Fibonacci is geometric' },
                                                        { id: 'D', label: 'D', text: 'Because Zeckendorf proved it with induction on digits' }
                                                ],
                                                correctOptionId: 'B'
                                        }
                                ]
                        },
                        {
                                id: 'fib-binary-quiz',
                                title: 'Read Fibonacci code words',
                                topic: 'Number theory',
                                estimatedMinutes: 4,
                                progressKey: 'decode',
                                description: 'Decode short bitstrings that use Fibonacci positions instead of powers of two.',
                                questions: [
                                        {
                                                kind: 'type-answer',
                                                id: 'fib-decode-1',
                                                prompt: 'Using Fibonacci weights [1,2,3,5,8,13,…], what number does the code 100101 (leftmost is highest weight) represent?',
                                                hint: 'Match bits with Fibonacci numbers skipping neighbours.',
                                                explanation: '1·13 + 0·8 + 0·5 + 1·3 + 0·2 + 1·1 = 17.',
                                                answer: '17',
                                                acceptableAnswers: ['17']
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'fib-decode-2',
                                                prompt: 'Which Fibonacci code represents 25?',
                                                hint: '25 = 21 + 3 + 1.',
                                                explanation: 'Bits for 21, 3, 1 with zeros in between: 100101.',
                                                answer: '100101',
                                                acceptableAnswers: ['100101']
                                        }
                                ]
                        }
                ],
                problems: [
                        {
                                slug: 'fib-decompose-number',
                                title: 'Fibonacci Decomposition',
                                summary: 'Produce the Zeckendorf representation of n as non-adjacent Fibonacci numbers.',
                                summaryBullets: [
                                        'Generate Fibonacci numbers up to n',
                                        'Greedy subtraction yields the representation',
                                        'Return the selected Fibonacci numbers in descending order'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Number theory',
                                topics: ['Number theory', 'Greedy'],
                                tags: ['fibonacci', 'zeckendorf', 'greedy'],
                                tasks: [
                                        'Given n (1 ≤ n ≤ 10^9), return the Fibonacci numbers used in its Zeckendorf representation in descending order',
                                        'Use Fibonacci sequence starting 1, 2, 3, 5, …'
                                ],
                                constraints: [
                                        '1 ≤ n ≤ 10^9',
                                        'Output length ≤ 45 (Fibonacci numbers grow fast)'
                                ],
                                edgeCases: [
                                        'n equals a Fibonacci number',
                                        'n is small (1 or 2)',
                                        'Multiple consecutive Fibonacci numbers should never appear together'
                                ],
                                hints: [
                                        'Precompute Fibonacci numbers up to n',
                                        'Traverse the list backwards, selecting numbers ≤ remaining',
                                        'Skip the Fibonacci immediately before the one you choose'
                                ],
                                followUpIdeas: [
                                        'Return a binary string representation instead of the list',
                                        'Support multiple queries efficiently'
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'n = 46',
                                                output: '[34, 8, 3, 1]',
                                                explanation: '46 = 34 + 8 + 3 + 1 with no consecutive Fibonacci numbers.'
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'n = 19',
                                                output: '[13, 5, 1]',
                                                explanation: '19 = 13 + 5 + 1.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Greedy from largest Fibonacci',
                                                overview:
                                                        'Generate Fibonacci numbers up to n, then traverse from largest to smallest picking numbers while subtracting from the remainder.',
                                                steps: [
                                                        'Build Fibonacci numbers until the last exceeds n',
                                                        'Iterate backwards through the list',
                                                        'If fib ≤ remaining, add it to the answer and subtract it',
                                                        'Return the collected numbers'
                                                ],
                                                timeComplexity: 'O(F)',
                                                spaceComplexity: 'O(F)',
                                                keyIdeas: [
                                                        'Greedy works because Fibonacci numbers grow quickly',
                                                        'No consecutive Fibonacci numbers are ever chosen'
                                                ]
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Recursive decomposition',
                                                        overview: 'Find the largest Fibonacci ≤ n recursively and append results. Conceptually simple but similar complexity.',
                                                        steps: [
                                                                'Find largest Fibonacci f ≤ n',
                                                                'Recurse on n − f',
                                                                'Combine results'
                                                        ],
                                                        timeComplexity: 'O(F)',
                                                        spaceComplexity: 'O(F)',
                                                        keyIdeas: ['Same greedy idea expressed recursively']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'generated/welcome/fib-decompose-number.md',
                                        markdown:
                                                '# Fibonacci Decomposition\n\nZeckendorf’s theorem guarantees that every integer has a unique sum of non-adjacent Fibonacci numbers. Generate the Fibonacci sequence up to n, then greedily subtract the largest numbers that fit. Return the numbers you picked.'
                                },
                                metadataVersion: 1,
                                starterCode:
                                        '' +
                                        'def fib_decompose_number(n: int) -> list[int]:\n' +
                                        '    fibs = [1, 2]\n' +
                                        '    while fibs[-1] <= n:\n' +
                                        '        fibs.append(fibs[-1] + fibs[-2])\n' +
                                        '    result: list[int] = []\n' +
                                        '    remaining = n\n' +
                                        '    for value in reversed(fibs[:-1]):\n' +
                                        '        if value <= remaining:\n' +
                                        '            result.append(value)\n' +
                                        '            remaining -= value\n' +
                                        '    return result\n'
                        },
                        {
                                slug: 'fib-interval-count',
                                title: 'Count Fibonacci Codes',
                                summary: 'Count how many binary strings of length k avoid consecutive 1s using Fibonacci numbers.',
                                summaryBullets: [
                                        'Dynamic programming with Fibonacci recurrence',
                                        'Connects coding theory with classic sequences',
                                        'Returns counts for ranges using prefix sums'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Dynamic programming',
                                topics: ['Dynamic programming', 'Combinatorics'],
                                tags: ['fibonacci', 'dp', 'strings'],
                                tasks: [
                                        'Given integers L and R (1 ≤ L ≤ R ≤ 60), count binary strings of length between L and R inclusive with no adjacent 1s',
                                        'Return the total count as an integer'
                                ],
                                constraints: [
                                        '1 ≤ L ≤ R ≤ 60',
                                        'Result fits in 64-bit unsigned integer'
                                ],
                                edgeCases: [
                                        'L = R',
                                        'Small lengths like 1 or 2',
                                        'Upper bound near 60 requiring memoisation'
                                ],
                                hints: [
                                        'Number of valid strings of length k equals Fibonacci(k + 2)',
                                        'Precompute prefix sums to answer intervals quickly',
                                        'Use iterative DP to avoid recursion depth issues'
                                ],
                                followUpIdeas: [
                                        'Count strings where no three 1s appear in a row',
                                        'Return the actual strings for tiny ranges'
                                ],
                                examples: [
                                        {
                                                label: 'Example 1',
                                                input: 'L = 2, R = 3',
                                                output: '7',
                                                explanation: 'Length 2 → 3 strings, length 3 → 4 strings, total 7.'
                                        },
                                        {
                                                label: 'Example 2',
                                                input: 'L = 1, R = 1',
                                                output: '2',
                                                explanation: 'Valid strings: 0 and 1.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'DP matches Fibonacci',
                                                overview:
                                                        'dp[k] = dp[k − 1] + dp[k − 2] counts strings without adjacent 1s. Precompute dp up to R + 2, then accumulate prefix sums to answer the range quickly.',
                                                steps: [
                                                        'Initialise dp[0] = 1, dp[1] = 2 (strings of length 0 and 1)',
                                                        'Iterate up to R + 2 computing dp[k] = dp[k - 1] + dp[k - 2]',
                                                        'The number of strings of length n is dp[n + 2]',
                                                        'Build prefix sums and subtract to get the interval count'
                                                ],
                                                timeComplexity: 'O(R)',
                                                spaceComplexity: 'O(R)',
                                                keyIdeas: [
                                                        'Zeckendorf coding forbids consecutive 1s',
                                                        'Same recurrence as Fibonacci numbers'
                                                ]
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Recursive memoisation',
                                                        overview: 'Memoise a function f(n) = f(n − 1) + f(n − 2) with base cases, then sum results for the range.',
                                                        steps: [
                                                                'Define f(0) = 1, f(1) = 2',
                                                                'Use recursion with memo to compute f(n)',
                                                                'Sum f(k) for k in [L, R]'
                                                        ],
                                                        timeComplexity: 'O(R)',
                                                        spaceComplexity: 'O(R)',
                                                        keyIdeas: ['Direct translation of Fibonacci recurrence']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'generated/welcome/fib-interval-count.md',
                                        markdown:
                                                '# Count Fibonacci Codes\n\nBinary strings with no consecutive 1s are the building blocks of Fibonacci coding. The count of such strings of length n follows the Fibonacci recurrence. Precompute the counts, build prefix sums, and answer how many valid code words fall in an inclusive length range [L, R].'
                                },
                                metadataVersion: 1,
                                starterCode:
                                        '' +
                                        'def count_fibonacci_codes(L: int, R: int) -> int:\n' +
                                        '    dp = [0] * (R + 3)\n' +
                                        '    dp[0] = 1\n' +
                                        '    dp[1] = 2\n' +
                                        '    for i in range(2, R + 3):\n' +
                                        '        dp[i] = dp[i - 1] + dp[i - 2]\n' +
                                        '    prefix = [0] * (R + 3)\n' +
                                        '    for n in range(1, R + 1):\n' +
                                        '        prefix[n] = prefix[n - 1] + dp[n + 1]\n' +
                                        '    return prefix[R] - prefix[L - 1]\n'
                        }
                ]
        }
] as const satisfies readonly WelcomeSessionTemplate[];

export type WelcomeTopicSummary = {
        id: string;
        title: string;
        tagline: string;
        description: string;
        focusPoints: readonly string[];
        estimatedMinutes: number;
        plan: readonly {
                id: string;
                title: string;
                icon: string;
                meta: string;
                summary: string;
                kind: PlanItem['kind'];
        }[];
};

export function getWelcomeTopicSummaries(): WelcomeTopicSummary[] {
        return WELCOME_SESSIONS.map((session) => ({
                id: session.id,
                title: session.title,
                tagline: session.tagline,
                description: session.description,
                focusPoints: session.focusPoints,
                estimatedMinutes: session.estimatedMinutes,
                plan: session.session.plan.map((item) => ({
                        id: item.id,
                        title: item.title,
                        icon: item.icon ?? (item.kind === 'quiz' ? '📝' : '💻'),
                        meta: item.meta ?? (item.kind === 'quiz' ? 'Quiz' : 'Problem'),
                        summary: item.summary ?? item.description ?? '',
                        kind: item.kind
                }))
        }));
}

export function getWelcomeSessionTemplate(id: string): WelcomeSessionTemplate | null {
        return WELCOME_SESSIONS.find((session) => session.id === id) ?? null;
}
