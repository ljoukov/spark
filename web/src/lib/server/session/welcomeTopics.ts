import type { CodeProblem, PlanItem, QuizDefinition } from '@spark/schemas';

type WelcomeTopic = {
        id: string;
        title: string;
        tagline: string;
        description: string;
        takeaways: string[];
        plan: PlanItem[];
        quizzes: QuizDefinition[];
        problems: CodeProblem[];
};

const WELCOME_TOPICS: WelcomeTopic[] = [
        {
                id: 'welcome-mod-clock',
                title: 'Clock Arithmetic Tricks',
                tagline: 'Use remainders to make time, patterns, and divisibility snap into place.',
                description:
                        'Build intuition for modular arithmetic using clocks, then apply it to quick mental checks and simple programs.',
                takeaways: [
                        'Think in loops: numbers can wrap around just like hours on a clock.',
                        'Negative numbers also have friendly remainders when you normalise them.',
                        'Small remainder patterns unlock fast checks for divisibility and timing puzzles.'
                ],
                plan: [
                        {
                                id: 'mod-clock-story',
                                kind: 'quiz',
                                title: 'Clock arithmetic crash course',
                                summary: 'Two idea cards show how “mod” wraps numbers on a clock face.',
                                description:
                                        'Get the mental model first: same remainder means same spot on the clock.',
                                icon: '🕒',
                                meta: 'Mini-lesson',
                                progressKey: 'intro'
                        },
                        {
                                id: 'mod-remainder-drills',
                                kind: 'quiz',
                                title: 'Spot the remainder',
                                summary: 'Rapid-fire checks to make clock thinking automatic.',
                                icon: '🎯',
                                meta: 'Quiz',
                                progressKey: 'checks'
                        },
                        {
                                id: 'mod-friendly-remainder',
                                kind: 'problem',
                                title: 'Friendly remainder helper',
                                summary: 'Code a helper that always returns a non-negative remainder.',
                                description:
                                        'Great for normalising indices or wrapping timers without branching all over.',
                                icon: '🛠️',
                                meta: 'Code practice',
                                difficulty: 'easy',
                                topic: 'Modular arithmetic'
                        },
                        {
                                id: 'mod-quick-uses',
                                kind: 'quiz',
                                title: 'Daily mod superpowers',
                                summary: 'See mod in action with calendars, tiling and divisibility tricks.',
                                icon: '💡',
                                meta: 'Applications',
                                progressKey: 'uses'
                        },
                        {
                                id: 'mod-clock-addition',
                                kind: 'problem',
                                title: 'Wrap-around clock planner',
                                summary: 'Calculate finish times even when the minutes spill past midnight.',
                                description:
                                        'Perfect practice for mixing modulus with small real-world data structures.',
                                icon: '⌚',
                                meta: 'Code practice',
                                difficulty: 'easy',
                                topic: 'Modular arithmetic'
                        }
                ],
                quizzes: [
                        {
                                id: 'mod-clock-story',
                                title: 'Clock arithmetic crash course',
                                topic: 'Modular arithmetic',
                                description: 'Wrap numbers the way hours wrap around a clock.',
                                estimatedMinutes: 4,
                                progressKey: 'intro',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'mod-clock-story-card-1',
                                                prompt: 'Same spot, same remainder',
                                                eyebrow: 'Idea card',
                                                body: 'If two numbers leave the same remainder when divided by m, they land on the same point of an m-hour clock. We write this as a ≡ b (mod m).',
                                                continueLabel: 'Keep going'
                                        },
                                        {
                                                kind: 'info-card',
                                                id: 'mod-clock-story-card-2',
                                                prompt: 'Wrapping works both ways',
                                                eyebrow: 'Idea card',
                                                body: 'Add or subtract multiples of m and the position on the clock does not change. That is why 27 and -5 both sit on 3 o’clock when m = 12.',
                                                continueLabel: 'Try a question'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-clock-story-q1',
                                                prompt: 'On a 12-hour clock, which time is the same position as 41 hours past midnight?',
                                                hint: 'Find the remainder when dividing 41 by 12.',
                                                explanation:
                                                        '41 ÷ 12 leaves remainder 5, so it is the same as 5 o’clock.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '1 o’clock' },
                                                        { id: 'B', label: 'B', text: '5 o’clock' },
                                                        { id: 'C', label: 'C', text: '9 o’clock' },
                                                        { id: 'D', label: 'D', text: '11 o’clock' }
                                                ],
                                                correctOptionId: 'B'
                                        }
                                ]
                        },
                        {
                                id: 'mod-remainder-drills',
                                title: 'Spot the remainder',
                                topic: 'Modular arithmetic',
                                description: 'Quick checks that reinforce the clock model.',
                                estimatedMinutes: 4,
                                progressKey: 'checks',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-remainder-drills-q1',
                                                prompt: 'What is 73 mod 8?',
                                                hint: 'Subtract multiples of 8 until you fall inside 0–7.',
                                                explanation: '72 is a multiple of 8, so 73 leaves remainder 1.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '1' },
                                                        { id: 'C', label: 'C', text: '5' },
                                                        { id: 'D', label: 'D', text: '9' }
                                                ],
                                                correctOptionId: 'B'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-remainder-drills-q2',
                                                prompt: 'Which pair is congruent mod 9?',
                                                hint: 'Look for numbers with the same remainder on a 9-hour clock.',
                                                explanation: '35 and 17 both leave remainder 8 when divided by 9.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '14 and 5' },
                                                        { id: 'B', label: 'B', text: '28 and 10' },
                                                        { id: 'C', label: 'C', text: '35 and 17' },
                                                        { id: 'D', label: 'D', text: '42 and 14' }
                                                ],
                                                correctOptionId: 'C'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-remainder-drills-q3',
                                                prompt: 'Which statement is true?',
                                                hint: 'Try the clock idea on each pair.',
                                                explanation: 'Both 50 and -10 land on 2 when working mod 12.',
                                                options: [
                                                        {
                                                                id: 'A',
                                                                label: 'A',
                                                                text: '50 ≡ -10 (mod 12) because both are two steps past a multiple of 12'
                                                        },
                                                        { id: 'B', label: 'B', text: '20 ≡ 5 (mod 3)' },
                                                        { id: 'C', label: 'C', text: '19 ≡ 4 (mod 8)' },
                                                        { id: 'D', label: 'D', text: '7 ≡ -5 (mod 6)' }
                                                ],
                                                correctOptionId: 'A'
                                        }
                                ]
                        },
                        {
                                id: 'mod-quick-uses',
                                title: 'Daily mod superpowers',
                                topic: 'Modular arithmetic',
                                description: 'See practical uses for mod beyond textbook drills.',
                                estimatedMinutes: 5,
                                progressKey: 'uses',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-quick-uses-q1',
                                                prompt: 'A wallpaper pattern repeats every 7 tiles. Tile 58 has colour A. Which tile also has colour A?',
                                                hint: 'Find numbers with the same remainder mod 7.',
                                                explanation: '58 mod 7 = 2, so any tile ≡ 2 (mod 7) shares the colour. Tile 93 leaves the same remainder.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '71' },
                                                        { id: 'B', label: 'B', text: '86' },
                                                        { id: 'C', label: 'C', text: '93' },
                                                        { id: 'D', label: 'D', text: '103' }
                                                ],
                                                correctOptionId: 'C'
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'mod-quick-uses-q2',
                                                prompt: 'The digital root trick says a number is divisible by 9 if the sum of its digits is divisible by 9. What is 8,452 mod 9?',
                                                hint: 'Add the digits and reduce again if needed.',
                                                explanation:
                                                        '8 + 4 + 5 + 2 = 19, and 1 + 9 = 10, and 1 + 0 = 1, so the remainder is 1.',
                                                answer: '1',
                                                acceptableAnswers: ['01', '1']
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'mod-quick-uses-q3',
                                                prompt: 'It is 23:40 now. How many minutes until the clock shows 02:10 again?',
                                                hint: 'Think in minutes mod 24×60.',
                                                explanation: '23:40 to 02:10 is 150 minutes. 02:10 repeats every 1,440 minutes, so the next time is in 150 minutes.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '110 minutes' },
                                                        { id: 'B', label: 'B', text: '130 minutes' },
                                                        { id: 'C', label: 'C', text: '150 minutes' },
                                                        { id: 'D', label: 'D', text: '170 minutes' }
                                                ],
                                                correctOptionId: 'C'
                                        }
                                ]
                        }
                ],
                problems: [
                        {
                                slug: 'mod-friendly-remainder',
                                title: 'Friendly remainder helper',
                                summary: 'Return the smallest non-negative remainder for n mod m.',
                                summaryBullets: [
                                        'Handles negative inputs without branching in every call.',
                                        'Keeps answers in the clean 0 to m - 1 range.',
                                        'Great building block for circular buffers and repeating patterns.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Modular arithmetic',
                                topics: ['number theory', 'modular arithmetic'],
                                tags: ['math', 'normalisation', 'fundamentals'],
                                tasks: [
                                        'Implement friendlyRemainder(n, m) → remainder where 0 ≤ remainder < m.',
                                        'Do it in O(1) time using arithmetic only; avoid loops.'
                                ],
                                constraints: [
                                        '−10^12 ≤ n ≤ 10^12',
                                        '2 ≤ m ≤ 10^9'
                                ],
                                edgeCases: [
                                        'n already between 0 and m − 1',
                                        'n is negative',
                                        'n is a multiple of m'
                                ],
                                hints: [
                                        'The raw remainder operator in many languages keeps the sign of n.',
                                        'Add m before taking mod again to push a negative remainder into range.'
                                ],
                                followUpIdeas: [
                                        'Generalise the helper so it works with BigInt inputs.',
                                        'Use it to implement a circular queue indexer.'
                                ],
                                examples: [
                                        {
                                                label: 'Wrap a negative',
                                                input: 'n = -5, m = 12',
                                                output: '7',
                                                explanation: '-5 ≡ 7 (mod 12), so 7 is the friendly remainder.'
                                        },
                                        {
                                                label: 'Already in range',
                                                input: 'n = 19, m = 7',
                                                output: '5',
                                                explanation: '19 mod 7 = 5 and needs no further adjustment.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Double-mod trick',
                                                overview:
                                                        'Take the built-in remainder, add m to shift negatives into range, then mod again.',
                                                steps: [
                                                        'Compute raw = n % m.',
                                                        'Return (raw + m) % m to guarantee 0 ≤ result < m.'
                                                ],
                                                timeComplexity: 'O(1)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: [
                                                        'Modulo arithmetic is periodic, so adding m keeps the congruence class.',
                                                        'Applying mod twice is safe and cheap.'
                                                ]
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Loop subtraction (educational)',
                                                        overview:
                                                                'Repeatedly subtract or add m until the value sits in range.',
                                                        steps: [
                                                                'While result < 0 add m.',
                                                                'While result ≥ m subtract m.'
                                                        ],
                                                        timeComplexity: 'O(|n| / m)',
                                                        spaceComplexity: 'O(1)',
                                                        keyIdeas: ['Conceptually simple but too slow for large |n|.']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'welcome/modular/friendly-remainder.md',
                                        markdown: `### Why this matters\nMany languages keep the sign of n when you use %. Normalising the result keeps indices and timers predictable.\n\n### Implementation notes\nUse a helper so other problems can rely on it. Testing with large positive and negative values catches edge cases quickly.`,
                                },
                                metadataVersion: 1,
                                starterCode: `export function friendlyRemainder(n: number, m: number): number {\n        // TODO: implement the double-mod trick\n        return 0;\n}`
                        },
                        {
                                slug: 'mod-clock-addition',
                                title: 'Wrap-around clock planner',
                                summary: 'Add minutes to a time-of-day while staying inside 00:00–23:59.',
                                summaryBullets: [
                                        'Treat the day as 1,440-minute cycle.',
                                        'Reuse modular arithmetic to wrap past midnight.',
                                        'Return formatted HH:MM strings with leading zeros.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Modular arithmetic',
                                topics: ['time arithmetic', 'simulation'],
                                tags: ['strings', 'math', 'formatting'],
                                tasks: [
                                        'Given startHour, startMinute, and deltaMinutes, compute the finishing time.',
                                        'Return the answer as a HH:MM string in 24-hour format.'
                                ],
                                constraints: [
                                        '0 ≤ startHour < 24',
                                        '0 ≤ startMinute < 60',
                                        '−10^6 ≤ deltaMinutes ≤ 10^6'
                                ],
                                edgeCases: [
                                        'Negative deltas that travel back past midnight',
                                        'Large positive deltas that skip multiple days',
                                        'Zero delta should return the original time'
                                ],
                                hints: [
                                        'Convert everything to minutes, add the delta, then normalise with mod 1,440.',
                                        'Pad the hour and minute with leading zeros when formatting.'
                                ],
                                followUpIdeas: [
                                        'Extend it to also report the number of full days passed.',
                                        'Add support for different cycle lengths (e.g. Pomodoro timers).'
                                ],
                                examples: [
                                        {
                                                label: 'Simple forward wrap',
                                                input: 'start = 22:30, delta = 200',
                                                output: '01:50',
                                                explanation: '22:30 plus 200 minutes = 1,350 minutes total; mod 1,440 gives 110, i.e. 1:50.'
                                        },
                                        {
                                                label: 'Going backwards',
                                                input: 'start = 03:15, delta = -200',
                                                output: '23:55',
                                                explanation: 'Normalising keeps the answer positive even when moving backwards.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Total minutes + friendly remainder',
                                                overview:
                                                        'Flatten the time into total minutes, add the delta, then reuse the friendly remainder helper idea.',
                                                steps: [
                                                        'total = startHour × 60 + startMinute + deltaMinutes',
                                                        'normalised = ((total % 1440) + 1440) % 1440',
                                                        'hour = Math.floor(normalised / 60), minute = normalised % 60'
                                                ],
                                                timeComplexity: 'O(1)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: [
                                                        '1,440 minutes capture a full day.',
                                                        'Use modular arithmetic to avoid conditional branches.'
                                                ]
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Iterative stepping',
                                                        overview: 'Move minute by minute to illustrate the cycle.',
                                                        steps: ['Increment minute, wrap at 60, then adjust hour and wrap at 24.'],
                                                        timeComplexity: 'O(|delta|)',
                                                        spaceComplexity: 'O(1)',
                                                        keyIdeas: ['Educational but far too slow for large deltas.']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'welcome/modular/clock-planner.md',
                                        markdown: `### Clock planning use case\nSchedulers, games, and IoT timers all need this pattern. Combine it with the friendlyRemainder helper for clean code.\n\n### Testing idea\nCheck values near midnight and ensure you always print two digits for hours and minutes.`,
                                },
                                metadataVersion: 1,
                                starterCode: `export function planFinishTime(startHour: number, startMinute: number, deltaMinutes: number): string {\n        // TODO: compute the wrap-around time\n        return '00:00';\n}`
                        }
                ]
        },
        {
                id: 'welcome-xor-parity',
                title: 'Binary XOR Magic',
                tagline: 'Discover how parity and XOR reveal hidden structure in puzzles and code.',
                description:
                        'Learn the rules of XOR, practise spotting parity invariants, and solve two bite-sized coding challenges that lean on them.',
                takeaways: [
                        'XOR is addition without carry—perfect for tracking parity.',
                        'Flipping twice cancels out, so many puzzles reduce to counting toggles.',
                        'Prefix XORs let you answer “odd or even?” questions instantly.'
                ],
                plan: [
                        {
                                id: 'xor-bits-story',
                                kind: 'quiz',
                                title: 'Meet XOR',
                                summary: 'Idea cards show how XOR behaves with bits and parity.',
                                description: 'See why XOR is its own inverse and how it behaves with repeated flips.',
                                icon: '✨',
                                meta: 'Mini-lesson',
                                progressKey: 'intro'
                        },
                        {
                                id: 'xor-quick-check',
                                kind: 'quiz',
                                title: 'Parity warm-up',
                                summary: 'Check that you can predict XOR outcomes quickly.',
                                icon: '🎯',
                                meta: 'Quiz',
                                progressKey: 'checks'
                        },
                        {
                                id: 'xor-single-out',
                                kind: 'problem',
                                title: 'Find the odd-one-out',
                                summary: 'Use XOR to locate the number that appears an odd number of times.',
                                description:
                                        'Classic interview warm-up that showcases how XOR cancels duplicates.',
                                icon: '🕵️',
                                meta: 'Code practice',
                                difficulty: 'easy',
                                topic: 'Bit manipulation'
                        },
                        {
                                id: 'xor-power-moves',
                                kind: 'quiz',
                                title: 'XOR in action',
                                summary: 'Explore invariants in games and toggling problems.',
                                icon: '🧠',
                                meta: 'Applications',
                                progressKey: 'uses'
                        },
                        {
                                id: 'xor-light-grid',
                                kind: 'problem',
                                title: 'Toggling lights quickly',
                                summary: 'Track a grid of lights when rows and columns flip.',
                                description:
                                        'Work out the final pattern using parity instead of simulating every cell.',
                                icon: '💡',
                                meta: 'Code practice',
                                difficulty: 'easy',
                                topic: 'Bit manipulation'
                        }
                ],
                quizzes: [
                        {
                                id: 'xor-bits-story',
                                title: 'Meet XOR',
                                topic: 'Bitwise reasoning',
                                description: 'Understand XOR as “addition without carry”.',
                                estimatedMinutes: 4,
                                progressKey: 'intro',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'xor-bits-story-card-1',
                                                prompt: 'Flip logic',
                                                eyebrow: 'Idea card',
                                                body: 'XOR compares bits: 0⊕0 = 0, 1⊕0 = 1, 1⊕1 = 0. It is like adding bits and dropping any carry.',
                                                continueLabel: 'Next insight'
                                        },
                                        {
                                                kind: 'info-card',
                                                id: 'xor-bits-story-card-2',
                                                prompt: 'Self-inverse superpower',
                                                eyebrow: 'Idea card',
                                                body: 'Because a⊕a = 0 and a⊕0 = a, XORing the same value twice cancels it out. That is why XOR is perfect for tracking parity.',
                                                continueLabel: 'Check understanding'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-bits-story-q1',
                                                prompt: 'What is 10110₂ ⊕ 01011₂?',
                                                hint: 'XOR bit by bit: 1⊕0=1, 0⊕1=1, etc.',
                                                explanation: 'The XOR is 11101₂, which is 29 in decimal.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '11101₂' },
                                                        { id: 'B', label: 'B', text: '11100₂' },
                                                        { id: 'C', label: 'C', text: '11001₂' },
                                                        { id: 'D', label: 'D', text: '01101₂' }
                                                ],
                                                correctOptionId: 'A'
                                        }
                                ]
                        },
                        {
                                id: 'xor-quick-check',
                                title: 'Parity warm-up',
                                topic: 'Bitwise reasoning',
                                description: 'Predict XOR outcomes in small puzzles.',
                                estimatedMinutes: 4,
                                progressKey: 'checks',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-quick-check-q1',
                                                prompt: 'If you XOR all numbers from 1 to 6, what is the result?',
                                                hint: 'Look for pairs that cancel.',
                                                explanation: '1⊕2⊕3⊕4⊕5⊕6 = (1⊕2⊕3⊕4)⊕(5⊕6) = 4⊕3 = 7.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '3' },
                                                        { id: 'C', label: 'C', text: '4' },
                                                        { id: 'D', label: 'D', text: '7' }
                                                ],
                                                correctOptionId: 'D'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-quick-check-q2',
                                                prompt: 'You toggle a light by XORing it with 1. Starting at 0, after applying [1, 0, 1, 1], what is the state?',
                                                hint: 'Remember XOR with 0 keeps the current value.',
                                                explanation: '0⊕1=1, 1⊕0=1, 1⊕1=0, 0⊕1=1 → final state 1.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '1' }
                                                ],
                                                correctOptionId: 'B'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-quick-check-q3',
                                                prompt: 'Which identity is always true?',
                                                hint: 'Combine associativity and cancellation.',
                                                explanation: '(a⊕b)⊕a = b because the a terms cancel.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '(a⊕b)⊕a = b' },
                                                        { id: 'B', label: 'B', text: 'a⊕(b⊕b) = a⊕b' },
                                                        { id: 'C', label: 'C', text: 'a⊕b = a + b' },
                                                        { id: 'D', label: 'D', text: 'a⊕a⊕a = a' }
                                                ],
                                                correctOptionId: 'A'
                                        }
                                ]
                        },
                        {
                                id: 'xor-power-moves',
                                title: 'XOR in action',
                                topic: 'Bitwise reasoning',
                                description: 'Apply XOR to toggling puzzles and game states.',
                                estimatedMinutes: 5,
                                progressKey: 'uses',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-power-moves-q1',
                                                prompt: 'In a game you may add or remove 2 stones. Why does tracking piles mod 2 help you decide the winner?',
                                                hint: 'Think about parity invariants.',
                                                explanation: 'Removing or adding 2 never changes parity, so the parity of each pile is invariant.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Because parity never changes so you can predict end states.' },
                                                        { id: 'B', label: 'B', text: 'Because XOR makes numbers larger.' },
                                                        { id: 'C', label: 'C', text: 'Because addition with carry is faster.' },
                                                        { id: 'D', label: 'D', text: 'Because parity tells you the exact number of moves left.' }
                                                ],
                                                correctOptionId: 'A'
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'xor-power-moves-q2',
                                                prompt: 'You maintain prefix XORs of an array. If prefix[5] = 11 and prefix[9] = 4, what is XOR of elements 6..9?',
                                                hint: 'Use the cancellation property.',
                                                explanation: 'prefix[9] ⊕ prefix[5] = 4 ⊕ 11 = 15.',
                                                answer: '15',
                                                acceptableAnswers: ['15']
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'xor-power-moves-q3',
                                                prompt: 'A light starts off. You toggle entire rows (R) or columns (C) of a grid. Sequence: R1, C1, R1. What is the final state of the top-left cell?',
                                                hint: 'Count how many times the cell is flipped.',
                                                explanation: 'The cell flips three times → odd → on (1).',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Off' },
                                                        { id: 'B', label: 'B', text: 'On' }
                                                ],
                                                correctOptionId: 'B'
                                        }
                                ]
                        }
                ],
                problems: [
                        {
                                slug: 'xor-single-out',
                                title: 'Find the odd-one-out',
                                summary: 'Given an array where every value appears an even number of times except one, return the odd value.',
                                summaryBullets: [
                                        'Cancels duplicates using XOR.',
                                        'Runs in O(n) time and O(1) memory.',
                                        'Common warm-up for bitwise thinking.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Bit manipulation',
                                topics: ['bitwise', 'arrays'],
                                tags: ['xor', 'parity', 'hash-free'],
                                tasks: [
                                        'Implement findOddOneOut(values: number[]): number.',
                                        'Assume there is exactly one value with odd frequency.'
                                ],
                                constraints: [
                                        '1 ≤ values.length ≤ 10^5',
                                        '−10^9 ≤ values[i] ≤ 10^9'
                                ],
                                edgeCases: [
                                        'Single element array',
                                        'Negative values',
                                        'Large arrays with many repeats'
                                ],
                                hints: [
                                        'Remember that x ⊕ x = 0 and 0 ⊕ x = x.',
                                        'Fold the array with XOR and watch everything cancel.'
                                ],
                                followUpIdeas: [
                                        'Adapt the idea when two values have odd frequency.',
                                        'Use XOR to find the missing number in 1..n.'
                                ],
                                examples: [
                                        {
                                                label: 'Basic example',
                                                input: '[5, 3, 5, 4, 4]',
                                                output: '3',
                                                explanation: 'Pairs cancel; 3 remains.'
                                        },
                                        {
                                                label: 'Negative value',
                                                input: '[−7, 2, 2, −7, 6]',
                                                output: '6',
                                                explanation: '6 appears once; everything else appears twice.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Fold with XOR',
                                                overview: 'Initialise answer = 0 and XOR every element into it.',
                                                steps: [
                                                        'Set result = 0.',
                                                        'For each value v, set result = result ⊕ v.',
                                                        'Return result.'
                                                ],
                                                timeComplexity: 'O(n)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: ['XOR cancels duplicates and keeps parity information.']
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Hash map counting',
                                                        overview: 'Count frequencies in a map and return the odd one.',
                                                        steps: [
                                                                'Build a map of value → count.',
                                                                'Return the key with odd count.'
                                                        ],
                                                        timeComplexity: 'O(n)',
                                                        spaceComplexity: 'O(n)',
                                                        keyIdeas: ['Works but wastes memory compared to XOR.']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'welcome/xor/find-odd-one.md',
                                        markdown: `### Why XOR works\nPairs cancel because  x ⊕ x = 0 . Folding everything leaves only the odd-count value.\n\n### Extension\nTry adapting the idea to locate two odd-count values using bit masks.`,
                                },
                                metadataVersion: 1,
                                starterCode: `export function findOddOneOut(values: number[]): number {\n        // TODO: fold with XOR\n        return 0;\n}`
                        },
                        {
                                slug: 'xor-light-grid',
                                title: 'Toggling lights quickly',
                                summary: 'Track a grid of lights after flipping whole rows or columns.',
                                summaryBullets: [
                                        'Treat each row/column flip as XOR with 1.',
                                        'Count flips instead of simulating the entire grid.',
                                        'Return the number of lights that are on in the final pattern.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Bit manipulation',
                                topics: ['parity', 'simulation'],
                                tags: ['xor', 'counting', 'matrices'],
                                tasks: [
                                        'You are given n, m, and a list of operations like "R2" (flip row 2) or "C1" (flip column 1).',
                                        'Return how many lights are on after all operations, starting from all off.'
                                ],
                                constraints: [
                                        '1 ≤ n, m ≤ 500',
                                        '0 ≤ operations.length ≤ 10^5'
                                ],
                                edgeCases: [
                                        'No operations',
                                        'Flipping the same row or column many times',
                                        'Single row or single column grids'
                                ],
                                hints: [
                                        'Track parity for each row and column separately.',
                                        'A cell ends on if rowParity[i] ⊕ columnParity[j] = 1.'
                                ],
                                followUpIdeas: [
                                        'Support rectangular sub-grid toggles.',
                                        'Output the full grid state instead of just the count.'
                                ],
                                examples: [
                                        {
                                                label: 'Small grid',
                                                input: 'n = 2, m = 3, ops = ["R1", "C2", "R1"]',
                                                output: '3',
                                                explanation: 'Row 1 flips twice (off), column 2 flips once; three cells are on.'
                                        },
                                        {
                                                label: 'No operations',
                                                input: 'n = 3, m = 3, ops = []',
                                                output: '0',
                                                explanation: 'Grid stays dark.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Parity tracking',
                                                overview:
                                                        'Use boolean arrays for rows and columns. Flip entries when operations arrive, then count cells with odd total flips.',
                                                steps: [
                                                        'Maintain rowParity[n] and colParity[m].',
                                                        'For op "Rk" toggle rowParity[k]. For "Ck" toggle colParity[k].',
                                                        'Count cells where rowParity[i] XOR colParity[j] is true.'
                                                ],
                                                timeComplexity: 'O(nm + ops)',
                                                spaceComplexity: 'O(n + m)',
                                                keyIdeas: [
                                                        'XOR models toggles compactly.',
                                                        'Counting uses parity instead of explicit simulation per operation.'
                                                ]
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Naive simulation',
                                                        overview: 'Flip every cell in the target row or column each time.',
                                                        steps: ['For each operation, iterate the entire row or column.'],
                                                        timeComplexity: 'O(ops × (n + m))',
                                                        spaceComplexity: 'O(nm)',
                                                        keyIdeas: ['Too slow for large grids, but clarifies the behaviour.']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'welcome/xor/light-grid.md',
                                        markdown: `### Practical angle\nParity tracking shows up in chessboard puzzles, LED matrices, and parity-based games.\n\n### Optimisation note\nCounting on the fly is possible: maintain counts of rows/cols toggled odd times to avoid the O(nm) sweep.`,
                                },
                                metadataVersion: 1,
                                starterCode: `export function countLightsOn(n: number, m: number, operations: string[]): number {\n        // TODO: track parity for rows and columns\n        return 0;\n}`
                        }
                ]
        },
        {
                id: 'welcome-last-digit',
                title: 'Last-Digit Patterns',
                tagline: 'Predict the final digit of huge powers and products using tiny cycles.',
                description:
                        'Use modular patterns to tame exponential growth, then code helpers that make last-digit questions instant.',
                takeaways: [
                        'Every base has a short cycle when you look only at the last digit.',
                        'Euler and Fermat give the theory, but you can memorise tiny loops to move fast.',
                        'Maintaining the last digit of a running product is a perfect streaming exercise.'
                ],
                plan: [
                        {
                                id: 'last-digit-story',
                                kind: 'quiz',
                                title: 'Cycle spotting',
                                summary: 'Idea cards reveal how powers repeat mod 10.',
                                description: 'See the pattern table for digits 0–9.',
                                icon: '🔁',
                                meta: 'Mini-lesson',
                                progressKey: 'intro'
                        },
                        {
                                id: 'last-digit-patterns',
                                kind: 'quiz',
                                title: 'Pattern drills',
                                summary: 'Practise picking the right cycle position quickly.',
                                icon: '🎯',
                                meta: 'Quiz',
                                progressKey: 'checks'
                        },
                        {
                                id: 'last-digit-fast-power',
                                kind: 'problem',
                                title: 'Lightning last digit',
                                summary: 'Compute the last digit of a^b for huge exponents.',
                                description: 'Use cycle lengths instead of large integer arithmetic.',
                                icon: '⚡',
                                meta: 'Code practice',
                                difficulty: 'easy',
                                topic: 'Modular arithmetic'
                        },
                        {
                                id: 'last-digit-shortcuts',
                                kind: 'quiz',
                                title: 'Shortcut mastery',
                                summary: 'Apply mod 4, mod 2, and digital roots to mixed questions.',
                                icon: '🧠',
                                meta: 'Applications',
                                progressKey: 'uses'
                        },
                        {
                                id: 'last-digit-running-product',
                                kind: 'problem',
                                title: 'Streamed last digit tracker',
                                summary: 'Maintain the final digit while multiplying a stream of numbers.',
                                description: 'Handle zeros, negatives, and big inputs gracefully.',
                                icon: '📈',
                                meta: 'Code practice',
                                difficulty: 'easy',
                                topic: 'Modular arithmetic'
                        }
                ],
                quizzes: [
                        {
                                id: 'last-digit-story',
                                title: 'Cycle spotting',
                                topic: 'Modular arithmetic',
                                description: 'Understand why powers repeat mod 10.',
                                estimatedMinutes: 4,
                                progressKey: 'intro',
                                questions: [
                                        {
                                                kind: 'info-card',
                                                id: 'last-digit-story-card-1',
                                                prompt: 'Tiny cycles everywhere',
                                                eyebrow: 'Idea card',
                                                body: 'Look at the last digit only. 2¹=2, 2²=4, 2³=8, 2⁴=6, 2⁵=2… The cycle length is 4. Every base from 1 to 9 has a short cycle like this.',
                                                continueLabel: 'Next idea'
                                        },
                                        {
                                                kind: 'info-card',
                                                id: 'last-digit-story-card-2',
                                                prompt: 'Use exponent mod cycle length',
                                                eyebrow: 'Idea card',
                                                body: 'If the cycle length for base a is L, then a^b and a^(b mod L) have the same last digit (with 0 treated as L).',
                                                continueLabel: 'Check yourself'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'last-digit-story-q1',
                                                prompt: 'What is the cycle for the base 7?',
                                                hint: 'List the first few powers of 7 mod 10.',
                                                explanation: '7¹=7, 7²=9, 7³=3, 7⁴=1, then it repeats → cycle length 4.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '2' },
                                                        { id: 'B', label: 'B', text: '4' },
                                                        { id: 'C', label: 'C', text: '5' },
                                                        { id: 'D', label: 'D', text: '10' }
                                                ],
                                                correctOptionId: 'B'
                                        }
                                ]
                        },
                        {
                                id: 'last-digit-patterns',
                                title: 'Pattern drills',
                                topic: 'Modular arithmetic',
                                description: 'Quick practice using the cycle trick.',
                                estimatedMinutes: 4,
                                progressKey: 'checks',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'last-digit-patterns-q1',
                                                prompt: 'Find the last digit of 3^47.',
                                                hint: 'Cycle length for 3 is 4.',
                                                explanation: '47 mod 4 = 3 → same as 3³ → last digit 7.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '1' },
                                                        { id: 'B', label: 'B', text: '3' },
                                                        { id: 'C', label: 'C', text: '7' },
                                                        { id: 'D', label: 'D', text: '9' }
                                                ],
                                                correctOptionId: 'C'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'last-digit-patterns-q2',
                                                prompt: 'What is the last digit of 6^2024?',
                                                hint: 'Check the cycle for base 6.',
                                                explanation: '6ⁿ ends in 6 for n ≥ 1.',
                                                options: [
                                                        { id: 'A', label: 'A', text: '0' },
                                                        { id: 'B', label: 'B', text: '2' },
                                                        { id: 'C', label: 'C', text: '4' },
                                                        { id: 'D', label: 'D', text: '6' }
                                                ],
                                                correctOptionId: 'D'
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'last-digit-patterns-q3',
                                                prompt: 'What is the last digit of 9^73?',
                                                hint: 'Cycle for 9 has length 2.',
                                                explanation: '73 mod 2 = 1 → same as 9¹ → last digit 9.',
                                                answer: '9',
                                                acceptableAnswers: ['9']
                                        }
                                ]
                        },
                        {
                                id: 'last-digit-shortcuts',
                                title: 'Shortcut mastery',
                                topic: 'Modular arithmetic',
                                description: 'Mix cycles with parity and digital roots.',
                                estimatedMinutes: 5,
                                progressKey: 'uses',
                                questions: [
                                        {
                                                kind: 'multiple-choice',
                                                id: 'last-digit-shortcuts-q1',
                                                prompt: 'Which statement is true about last digits?',
                                                hint: 'Think of mod 10.',
                                                explanation: 'Multiplying last digits and taking mod 10 gives the last digit of the full product.',
                                                options: [
                                                        {
                                                                id: 'A',
                                                                label: 'A',
                                                                text: 'If a ≡ b (mod 10) and c ≡ d (mod 10) then ac ≡ bd (mod 10).'
                                                        },
                                                        { id: 'B', label: 'B', text: 'If a ends in 0 then any power ends in 0 except the first.' },
                                                        { id: 'C', label: 'C', text: 'Last digits never repeat for odd bases.' },
                                                        { id: 'D', label: 'D', text: 'Digital roots ignore last digits.' }
                                                ],
                                                correctOptionId: 'A'
                                        },
                                        {
                                                kind: 'multiple-choice',
                                                id: 'last-digit-shortcuts-q2',
                                                prompt: 'You need the last digit of 12^100 × 7^45. What is the best approach?',
                                                hint: 'Split into cycles.',
                                                explanation: 'Find the last digit of each base separately using cycles, then multiply and mod 10.',
                                                options: [
                                                        { id: 'A', label: 'A', text: 'Compute the big power exactly.' },
                                                        { id: 'B', label: 'B', text: 'Use cycles: 12 behaves like 2, 7 has cycle 4.' },
                                                        { id: 'C', label: 'C', text: 'Only look at parity of the exponents.' },
                                                        { id: 'D', label: 'D', text: 'Use factorial tricks.' }
                                                ],
                                                correctOptionId: 'B'
                                        },
                                        {
                                                kind: 'type-answer',
                                                id: 'last-digit-shortcuts-q3',
                                                prompt: 'A running product currently ends in 4. Multiply by a number ending in 7. What is the new last digit?',
                                                hint: '4×7 = 28.',
                                                explanation: 'Only the last digit matters → 4×7 = 28 → last digit 8.',
                                                answer: '8',
                                                acceptableAnswers: ['8']
                                        }
                                ]
                        }
                ],
                problems: [
                        {
                                slug: 'last-digit-fast-power',
                                title: 'Lightning last digit',
                                summary: 'Return the last digit of a^b using cycle lengths.',
                                summaryBullets: [
                                        'Handles huge exponents instantly.',
                                        'Treats exponent 0 carefully (answer 1 unless base is 0).',
                                        'Uses precomputed cycles for digits 0–9.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Modular arithmetic',
                                topics: ['number theory', 'fast exponentiation'],
                                tags: ['cycles', 'math', 'optimisation'],
                                tasks: [
                                        'Implement lastDigitOfPower(base: number, exponent: number): number.',
                                        'Support negative bases by considering their last digit only.'
                                ],
                                constraints: [
                                        '−10^9 ≤ base ≤ 10^9',
                                        '0 ≤ exponent ≤ 10^12'
                                ],
                                edgeCases: [
                                        'Exponent 0 should return 1 (except 0^0 → treat as 1).',
                                        'Base ending in 0, 1, 5, or 6 have cycle length 1.',
                                        'Negative bases should not break the lookup.'
                                ],
                                hints: [
                                        'Precompute cycles for digits 0–9.',
                                        'Use (exponent − 1) mod cycleLength to pick the right entry.'
                                ],
                                followUpIdeas: [
                                        'Extend to last two digits using mod 100.',
                                        'Handle arrays of queries efficiently with memoisation.'
                                ],
                                examples: [
                                        {
                                                label: 'Large exponent',
                                                input: 'base = 7, exponent = 222',
                                                output: '9',
                                                explanation: 'Cycle for 7 is [7,9,3,1]; position = 222 mod 4 = 2 → last digit 9.'
                                        },
                                        {
                                                label: 'Exponent zero',
                                                input: 'base = 0, exponent = 0',
                                                output: '1',
                                                explanation: 'Define 0^0 as 1 for this helper.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Lookup cycles',
                                                overview:
                                                        'Store arrays for each last digit and index into them using modular arithmetic on the exponent.',
                                                steps: [
                                                        'Map base to its last digit d.',
                                                        'If exponent = 0 return 1.',
                                                        'Let cycle = cycles[d]; position = (exponent − 1) mod cycle.length.',
                                                        'Return cycle[position].'
                                                ],
                                                timeComplexity: 'O(1)',
                                                spaceComplexity: 'O(1)',
                                                keyIdeas: ['Last digits repeat in tiny cycles.', 'Index safely when exponent is 0.']
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Fast exponentiation with mod 10',
                                                        overview: 'Run binary exponentiation while taking mod 10 at each step.',
                                                        steps: [
                                                                'Initialise result = 1.',
                                                                'While exponent > 0: if odd multiply result by base mod 10; square base mod 10; halve exponent.'
                                                        ],
                                                        timeComplexity: 'O(log exponent)',
                                                        spaceComplexity: 'O(1)',
                                                        keyIdeas: ['Works well but the cycle lookup is even simpler.']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'welcome/last-digit/lightning-power.md',
                                        markdown: `### Cheat sheet\nDigits 0,1,5,6 stay constant. Digits 4 and 9 have cycle length 2. Digits 2,3,7,8 have cycle length 4. Use this table to skip heavy maths.\n\n### Implementation tip\nStore the cycles in an array literal indexed by digit for instant access.`,
                                },
                                metadataVersion: 1,
                                starterCode: `export function lastDigitOfPower(base: number, exponent: number): number {\n        // TODO: use cycle lookups\n        return 0;\n}`
                        },
                        {
                                slug: 'last-digit-running-product',
                                title: 'Streamed last digit tracker',
                                summary: 'Process a stream of multipliers and report the running last digit after each one.',
                                summaryBullets: [
                                        'Multiplying mod 10 keeps the number tiny.',
                                        'Zero instantly forces the running last digit to zero.',
                                        'Shows how to maintain state for a live feed.'
                                ],
                                difficulty: 'easy',
                                primaryTopic: 'Modular arithmetic',
                                topics: ['stream processing', 'number theory'],
                                tags: ['prefix', 'state', 'mod'],
                                tasks: [
                                        'Given an array of integers, return an array of last digits after each multiplication.',
                                        'The running product starts at 1.'
                                ],
                                constraints: [
                                        '1 ≤ values.length ≤ 10^5',
                                        '−10^9 ≤ values[i] ≤ 10^9'
                                ],
                                edgeCases: [
                                        'Encountering zero resets the running product to zero.',
                                        'Negative numbers should behave like their last digit.',
                                        'Large arrays must be handled in linear time.'
                                ],
                                hints: [
                                        'Only store the last digit of the running product.',
                                        'Use ((value % 10) + 10) % 10 to handle negatives.'
                                ],
                                followUpIdeas: [
                                        'Allow queries that divide out earlier factors (needs modular inverses).',
                                        'Track the last two digits for extra challenge.'
                                ],
                                examples: [
                                        {
                                                label: 'Basic stream',
                                                input: 'values = [2, 5, 7]',
                                                output: '[2, 0, 0]',
                                                explanation: 'Running digits: 1→2→0→0.'
                                        },
                                        {
                                                label: 'Contains negative',
                                                input: 'values = [3, −4, 5]',
                                                output: '[3, 8, 0]',
                                                explanation: 'Last digits: 1→3→2 (because −4 ends in 6) → 0.'
                                        }
                                ],
                                solution: {
                                        optimal: {
                                                title: 'Streaming mod 10',
                                                overview: 'Keep the running last digit and multiply in each new number mod 10.',
                                                steps: [
                                                        'Set last = 1.',
                                                        'For each value v, let digit = ((v % 10) + 10) % 10.',
                                                        'Set last = (last * digit) % 10 and push to output array.'
                                                ],
                                                timeComplexity: 'O(n)',
                                                spaceComplexity: 'O(n)',
                                                keyIdeas: ['Only the last digit matters.', 'Handle negatives with a friendly mod.']
                                        },
                                        alternatives: [
                                                {
                                                        title: 'Full product big integers',
                                                        overview: 'Multiply in big integers and extract the last digit each time.',
                                                        steps: ['Keep the full product as a BigInt; convert to string to read the last digit.'],
                                                        timeComplexity: 'O(n · digits)',
                                                        spaceComplexity: 'O(digits)',
                                                        keyIdeas: ['Demonstrates why modular reduction is so powerful.']
                                                }
                                        ]
                                },
                                source: {
                                        path: 'welcome/last-digit/running-product.md',
                                        markdown: `### Streaming insight\nMaintaining the last digit lets you answer queries live without recomputing from scratch.\n\n### Testing tip\nInclude inputs with zeros and negatives to ensure your normalisation is correct.`,
                                },
                                metadataVersion: 1,
                                starterCode: `export function runningLastDigits(values: number[]): number[] {\n        // TODO: maintain the running last digit\n        return [];\n}`
                        }
                ]
        }
];

export function getWelcomeTopics(): WelcomeTopic[] {
        return WELCOME_TOPICS;
}

export function findWelcomeTopic(topicId: string): WelcomeTopic | undefined {
        return WELCOME_TOPICS.find((topic) => topic.id === topicId);
}
