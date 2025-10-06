import { Timestamp } from 'firebase-admin/firestore';
import {
	SessionSchema,
	SessionStateSchema,
	type PlanItem,
	type Session,
	type SessionState,
	type QuizDefinition,
	type CodeProblem
} from '@spark/schemas';
import { getFirebaseAdminFirestore } from '../utils/firebaseAdmin';
import { saveSession, setCurrentSessionId, getSession } from './repo';
import { saveUserQuiz } from '../quiz/repo';
import { saveUserProblem } from '../code/problemRepo';

export type WelcomeSessionKey = 'modular-magic' | 'binary-sparks' | 'digital-roots';

export type WelcomeSessionOption = {
	key: WelcomeSessionKey;
	title: string;
	tagline: string;
	emoji: string;
};

type WelcomeSessionTemplate = {
	id: string;
	title: string;
	tagline: string;
	plan: PlanItem[];
	quizzes: QuizDefinition[];
	problems: CodeProblem[];
	emoji: string;
};
const clockStepperProblem: CodeProblem = {
	slug: 'clock-stepper',
	title: 'Clock Stepper',
	summary: 'Walk around a clock by summing signed jumps and wrapping with modulo.',
	summaryBullets: [
		'Wrap totals to stay within the clock face',
		'Handle negative and oversized jumps cleanly',
		'Shows why modulo is just “looping around”'
	],
	difficulty: 'easy',
	primaryTopic: 'Modular Arithmetic',
	topics: ['Modular Arithmetic', 'Implementation'],
	tags: ['mod', 'simulation', 'intro'],
	tasks: [
		'Return the final hour after applying every jump',
		'Accept both positive and negative steps',
		'Support a custom modulo (default 12)'
	],
	constraints: [
		'1 <= modulo <= 24',
		'1 <= len(steps) <= 10000',
		'-1000000 <= step <= 1000000',
		'0 <= start < modulo'
	],
	edgeCases: [
		'No steps should return the starting hour',
		'Large positive totals still wrap correctly',
		'Negative totals wrap to the top end of the clock'
	],
	hints: [
		'Sum the steps once and wrap at the end',
		'Python keeps remainders non-negative when you use %',
		'You do not need to simulate hour by hour'
	],
	followUpIdeas: [
		'Return every visited hour instead of only the last one',
		'Support fractional steps for analogue clocks'
	],
	examples: [
		{
			label: 'Example 1',
			input: 'start = 3\nsteps = [4, 6, 5]',
			output: '6',
			explanation: '3 + 4 + 6 + 5 = 18 and 18 % 12 = 6.'
		},
		{
			label: 'Example 2',
			input: 'start = 11\nsteps = [2, -5]',
			output: '8',
			explanation: '11 + 2 - 5 = 8.'
		},
		{
			label: 'Example 3',
			input: 'start = 0\nsteps = [-1, -1, -1]\nmodulo = 24',
			output: '21',
			explanation: 'Total is -3 and -3 % 24 = 21.'
		}
	],
	solution: {
		optimal: {
			title: 'Sum offsets then wrap once',
			overview: 'Compute a single total offset and apply modulo to keep the result on the clock.',
			steps: [
				'Start from the given hour and add the sum of all steps.',
				'Apply modulo to clamp the result to 0…modulo-1.',
				'Return the wrapped value.'
			],
			timeComplexity: 'O(n)',
			spaceComplexity: 'O(1)',
			keyIdeas: [
				'Modulo performs wrap-around in one step',
				'Negative totals wrap automatically with %'
			]
		},
		alternatives: [
			{
				title: 'Iterative wrapping',
				overview:
					'Update the current hour after every step and wrap immediately. Slightly longer but mirrors the physical walk.',
				steps: [
					'Track the current hour, starting at start.',
					'For each step, add it and wrap with modulo.',
					'Return the final hour after processing the list.'
				],
				timeComplexity: 'O(n)',
				spaceComplexity: 'O(1)',
				keyIdeas: ['Shows wrap-around at each move', 'Equivalent total work but more state updates']
			}
		]
	},
	source: {
		path: 'generated/welcome/modular/clock-stepper.md',
		markdown:
			'# Clock Stepper\n\nYou are on a clock with `modulo` positions (12 by default). Starting at `start`, apply each signed step in order. Report the hour you land on after wrapping within `0…modulo-1` using modular arithmetic.'
	},
	metadataVersion: 1,
	starterCode:
		'def final_hour(start: int, steps: list[int], modulo: int = 12) -> int:\n' +
		'    """Return the hour index after applying all steps on a modulo clock."""\n' +
		'    # TODO: implement using modular arithmetic\n' +
		'    return 0\n'
};
const remainderBucketsProblem: CodeProblem = {
	slug: 'remainder-buckets',
	title: 'Remainder Buckets',
	summary: 'Count how many pairs of numbers share the same remainder modulo m.',
	summaryBullets: [
		'Bucket values by remainder using a dictionary',
		'Use combinations to count pairs inside each bucket',
		'Connects modular arithmetic with hashing intuition'
	],
	difficulty: 'easy',
	primaryTopic: 'Number Theory',
	topics: ['Modular Arithmetic', 'Hashing', 'Counting'],
	tags: ['mod', 'hashing', 'pairs'],
	tasks: [
		'Return the number of unordered pairs that share the same remainder modulo m',
		'Treat negative numbers by converting them to non-negative remainders',
		'Scale to 100k numbers without nested loops'
	],
	constraints: [
		'1 <= len(values) <= 100000',
		'2 <= modulus <= 10000',
		'-1000000000 <= value <= 1000000000'
	],
	edgeCases: [
		'All values already share a remainder -> choose count pairs',
		'All remainders unique -> result is 0',
		'Mixing negative and positive numbers should still collide correctly'
	],
	hints: [
		'Use a dictionary mapping remainder -> frequency',
		'Adding one more element to a bucket creates frequency additional pairs',
		'Remember to normalise negative values with value % modulus'
	],
	followUpIdeas: [
		'Return the remainder buckets alongside the pair count',
		'Extend to triplets that share a remainder'
	],
	examples: [
		{
			label: 'Example 1',
			input: 'values = [3, 8, 10, 15]\nmodulus = 5',
			output: '2',
			explanation: '3 and 8 share remainder 3 (1 pair); 10 and 15 share remainder 0 (1 pair).'
		},
		{
			label: 'Example 2',
			input: 'values = [-4, 5, 7, 13]\nmodulus = 4',
			output: '1',
			explanation: '-4 % 4 = 0, 5 % 4 = 1, 7 % 4 = 3, 13 % 4 = 1. Only remainder 1 appears twice.'
		},
		{
			label: 'Example 3',
			input: 'values = [1, 2, 3]\nmodulus = 4',
			output: '0',
			explanation: 'Remainders {1, 2, 3} are all different.'
		}
	],
	solution: {
		optimal: {
			title: 'Count frequencies then use combinations',
			overview:
				'Bucket each value by remainder and accumulate c * (c - 1) / 2 for each bucket size c.',
			steps: [
				'Initialise a dictionary remainder -> count.',
				'Iterate over values, incrementing the count for value % modulus.',
				'For each count c, add c * (c - 1) // 2 to the answer.'
			],
			timeComplexity: 'O(n)',
			spaceComplexity: 'O(k)',
			keyIdeas: [
				'Modulo groups values that behave the same under hashing',
				'Combinations count pairs efficiently'
			]
		},
		alternatives: [
			{
				title: 'Streaming accumulation',
				overview:
					'Update the answer as you go: each new element in a bucket adds existing_count pairs.',
				steps: [
					'Track counts in a dictionary.',
					'When processing a value, add the current count for its remainder to the answer.',
					'Increment the count, then continue.'
				],
				timeComplexity: 'O(n)',
				spaceComplexity: 'O(k)',
				keyIdeas: ['Avoid second pass', 'Same dictionary footprint']
			}
		]
	},
	source: {
		path: 'generated/welcome/modular/remainder-buckets.md',
		markdown:
			"# Remainder Buckets\n\nGiven a list of integers and a modulus `m`, count how many unordered pairs share the same remainder when divided by `m`. Normalise negative numbers using Python's `%` and return the total number of friendly pairs."
	},
	metadataVersion: 1,
	starterCode:
		'def count_same_remainder_pairs(values: list[int], modulus: int) -> int:\n' +
		'    # TODO: count pairs that land in the same modulo bucket\n' +
		'    return 0\n'
};
const xorLampGridProblem: CodeProblem = {
	slug: 'xor-lamp-grid',
	title: 'Lamp Toggler',
	summary: 'Track lamps that remain ON after a sequence of toggle events.',
	summaryBullets: [
		'Treat each toggle as XOR with the previous state',
		'Store only parity to avoid reprocessing events',
		'Outputs sorted lamp indexes that stay lit'
	],
	difficulty: 'easy',
	primaryTopic: 'Bitwise Operations',
	topics: ['Bitwise Operations', 'Simulation', 'Sets'],
	tags: ['xor', 'parity', 'simulation'],
	tasks: [
		'Return a sorted list of lamp indexes that are ON at the end',
		'All lamps start OFF and toggles flip their state',
		'Indexes are zero-based and always within range'
	],
	constraints: ['1 <= count <= 100000', '0 <= len(toggles) <= 100000', '0 <= toggle < count'],
	edgeCases: [
		'No toggles leaves every lamp OFF',
		'Toggling the same lamp twice cancels back to OFF',
		'Large logs should still be processed in linear time'
	],
	hints: [
		'Use a set: add on first toggle, remove on second',
		'This mirrors XOR behaviour where duplicates cancel to 0',
		'Sort before returning for deterministic output'
	],
	followUpIdeas: [
		'Return the number of toggles per lamp along with the ON set',
		'Track when each lamp was last toggled to animate the grid'
	],
	examples: [
		{
			label: 'Example 1',
			input: 'count = 5\ntoggles = [1, 2, 1, 4]',
			output: '[2, 4]',
			explanation: 'Lamp 1 toggled twice -> OFF. Lamps 2 and 4 toggled once -> ON.'
		},
		{
			label: 'Example 2',
			input: 'count = 3\ntoggles = [0, 0, 0]',
			output: '[0]',
			explanation: 'Three toggles means lamp 0 ends ON (odd parity).'
		},
		{
			label: 'Example 3',
			input: 'count = 4\ntoggles = []',
			output: '[]',
			explanation: 'No events: every lamp stays OFF.'
		}
	],
	solution: {
		optimal: {
			title: 'Use a parity set',
			overview:
				'Track lamps with odd toggle count in a set; add when toggled ON, remove when returning to OFF.',
			steps: [
				'Initialise an empty set for lamps that are currently ON.',
				'For each toggle, remove the lamp if it is already in the set, otherwise add it.',
				'Return the sorted contents of the set.'
			],
			timeComplexity: 'O(n + k log k)',
			spaceComplexity: 'O(k)',
			keyIdeas: ['Sets capture XOR parity directly', 'Sorting at the end keeps output tidy']
		},
		alternatives: [
			{
				title: 'Count array in place',
				overview:
					'Maintain integer counts per lamp and check count % 2 at the end. Uses more memory when count is large but keeps output sorted.',
				steps: [
					'Create an array counts of length count initialised to 0.',
					'Increment counts[index] for each toggle.',
					'Collect indexes where counts[index] % 2 == 1.'
				],
				timeComplexity: 'O(n + count)',
				spaceComplexity: 'O(count)',
				keyIdeas: ['Trade memory for easier sorting', 'Good when count is small']
			}
		]
	},
	source: {
		path: 'generated/welcome/binary/xor-lamp-grid.md',
		markdown:
			'# Lamp Toggler\n\nYou control `count` lamps labelled `0…count-1`. Every lamp starts OFF. Given a list of toggle events, flip the state of that lamp. After processing the log, return a sorted list of lamp indexes that remain ON. Think of toggling as XOR: odd counts leave 1, even counts drop back to 0.'
	},
	metadataVersion: 1,
	starterCode:
		'def lamps_left_on(count: int, toggles: list[int]) -> list[int]:\n' +
		'    """Return sorted lamp indexes that are ON after all toggles."""\n' +
		'    # TODO: track parity for each lamp\n' +
		'    return []\n'
};
const nimBalanceProblem: CodeProblem = {
	slug: 'nim-balance',
	title: 'Nim Balance',
	summary: 'Decide who wins a Nim pile configuration using XOR parity.',
	summaryBullets: [
		'Compute the nim-sum (XOR of all piles)',
		'Zero nim-sum => next player loses with perfect play',
		'Illustrates XOR as a strategy detector'
	],
	difficulty: 'easy',
	primaryTopic: 'Game Theory',
	topics: ['Bitwise Operations', 'Game Theory'],
	tags: ['xor', 'nim', 'parity'],
	tasks: [
		'Return "First" if the starting player has a winning strategy',
		'Return "Second" if the next player loses assuming both play optimally',
		'Treat empty piles or zero heights as valid input'
	],
	constraints: ['0 <= len(piles) <= 100000', '0 <= piles[i] <= 1000000000'],
	edgeCases: [
		'All piles zero -> nim-sum zero -> Second wins',
		'Single non-zero pile -> First wins by taking all stones',
		'Large pile counts must not overflow (XOR is safe)'
	],
	hints: [
		'Nim-sum is the XOR of every pile height',
		'If nim-sum is zero, you are already in a losing position',
		'Otherwise, there is always a move that makes the nim-sum zero'
	],
	followUpIdeas: [
		'Return the actual pile and stones to remove for the winning move',
		'Extend to misère Nim by adjusting the base case when piles are size 1'
	],
	examples: [
		{
			label: 'Example 1',
			input: 'piles = [1, 4, 5]',
			output: 'Second',
			explanation: '1 ^ 4 ^ 5 = 0 so the next player loses with perfect play.'
		},
		{
			label: 'Example 2',
			input: 'piles = [3, 4, 5]',
			output: 'First',
			explanation: '3 ^ 4 ^ 5 = 2 (non-zero) so the starter can force a win.'
		},
		{
			label: 'Example 3',
			input: 'piles = []',
			output: 'Second',
			explanation: 'No stones means the first player has no move and loses.'
		}
	],
	solution: {
		optimal: {
			title: 'Compute nim-sum and compare with zero',
			overview:
				'Fold the array with XOR. Zero nim-sum means the current player is already at a disadvantage.',
			steps: [
				'Initialise nim_sum = 0.',
				'XOR every pile height into nim_sum.',
				'Return "First" if nim_sum != 0 else "Second".'
			],
			timeComplexity: 'O(n)',
			spaceComplexity: 'O(1)',
			keyIdeas: [
				'XOR encodes parity of binary digits',
				'Zero nim-sum is the losing position in Nim'
			]
		},
		alternatives: [
			{
				title: 'Bit-by-bit reasoning',
				overview:
					'You can reason column-wise: for each bit position, if an odd number of piles have that bit set, the nim-sum bit becomes 1. Same conclusion, slower to code.',
				steps: [
					'Inspect every bit position up to the highest pile bit.',
					'Count how many piles have that bit set.',
					'If any count is odd, the nim-sum is non-zero, so First wins.'
				],
				timeComplexity: 'O(n log U)',
				spaceComplexity: 'O(1)',
				keyIdeas: ['Connects with parity idea explicitly', 'Useful for teaching why XOR works']
			}
		]
	},
	source: {
		path: 'generated/welcome/binary/nim-balance.md',
		markdown:
			'# Nim Balance\n\nGiven an array of Nim pile heights, decide who wins under optimal play. Compute the nim-sum (bitwise XOR) of all piles. If it is zero, the position is losing for the next player (answer "Second"); otherwise the first player has a winning response (answer "First").'
	},
	metadataVersion: 1,
	starterCode:
		'def nim_winner(piles: list[int]) -> str:\n' +
		'    """Return "First" if the starter wins, else "Second"."""\n' +
		'    # TODO: compute the nim-sum and decide the winner\n' +
		'    return ""\n'
};
const digitalRootProblem: CodeProblem = {
	slug: 'digital-root-finder',
	title: 'Digital Root Finder',
	summary: 'Reduce an integer to its digital root by summing digits repeatedly.',
	summaryBullets: [
		'Sum digits until a single digit remains',
		'Handles 0 as a special case',
		'Connects to modulo 9 arithmetic'
	],
	difficulty: 'easy',
	primaryTopic: 'Number Theory',
	topics: ['Number Theory', 'Implementation'],
	tags: ['digital-root', 'modular-arithmetic', 'math-trick'],
	tasks: [
		'Return the digital root of a non-negative integer',
		'Support very large integers without string overflow issues',
		'Treat 0 as having a digital root of 0'
	],
	constraints: ['0 <= n <= 1000000000000000000'],
	edgeCases: [
		'n = 0 should return 0',
		'Single digit inputs return themselves',
		'Numbers already divisible by 9 return 9 unless n == 0'
	],
	hints: [
		'Loop while n >= 10 and sum the digits',
		'Alternatively use modulo 9 trick with a special case for 0',
		'Converting to string is OK at this scale, but you can also use math'
	],
	followUpIdeas: [
		'Return the intermediate sums as well as the final root',
		'Apply the same idea in base b instead of base 10'
	],
	examples: [
		{
			label: 'Example 1',
			input: 'n = 493',
			output: '7',
			explanation: '4 + 9 + 3 = 16, then 1 + 6 = 7.'
		},
		{
			label: 'Example 2',
			input: 'n = 0',
			output: '0',
			explanation: 'Digital root of zero is defined as zero.'
		},
		{
			label: 'Example 3',
			input: 'n = 99999',
			output: '9',
			explanation: 'Sum is 45, and 4 + 5 = 9.'
		}
	],
	solution: {
		optimal: {
			title: 'Use modulo 9 with a zero check',
			overview: 'For n > 0 the digital root is 1 + ((n - 1) % 9). Zero stays zero.',
			steps: [
				'If n == 0 return 0 immediately.',
				'Otherwise return 1 + ((n - 1) % 9).',
				'This formula skips loops and works for huge inputs.'
			],
			timeComplexity: 'O(1)',
			spaceComplexity: 'O(1)',
			keyIdeas: ['Digital root follows modulo 9 pattern', 'Zero needs its own branch']
		},
		alternatives: [
			{
				title: 'Repeated summation loop',
				overview:
					'Sum digits in a loop while n has more than one digit. Slower but extremely explicit and easy to understand.',
				steps: [
					'While n >= 10, replace n with the sum of its digits.',
					'To sum digits, peel them off with % 10 or iterate over the string.',
					'Return the single-digit result.'
				],
				timeComplexity: 'O(log n)',
				spaceComplexity: 'O(1)',
				keyIdeas: ['Great for demonstrating the process', 'Works in any base']
			}
		]
	},
	source: {
		path: 'generated/welcome/digital/digital-root.md',
		markdown:
			'# Digital Root Finder\n\nCompute the digital root of a non-negative integer `n`. The digital root is obtained by repeatedly summing decimal digits until one digit remains. For example, 493 → 4+9+3=16 → 1+6=7.'
	},
	metadataVersion: 1,
	starterCode:
		'def digital_root(n: int) -> int:\n' +
		'    """Return the digital root of n."""\n' +
		'    # TODO: implement the repeated digit sum or use the modulo trick\n' +
		'    return 0\n'
};
const nineAdjusterProblem: CodeProblem = {
	slug: 'nine-adjuster',
	title: 'Casting Out Nines',
	summary: 'Find the smallest digit to append so the sum of digits becomes divisible by nine.',
	summaryBullets: [
		'Sum digits, then choose the complement to the next multiple of nine',
		'Treat the input as a string to avoid big integer overflow worries',
		'Outputs a single character digit'
	],
	difficulty: 'easy',
	primaryTopic: 'Number Theory',
	topics: ['Number Theory', 'String Processing'],
	tags: ['digital-root', 'greedy', 'mod-9'],
	tasks: [
		'Return the smallest digit (0-9) that makes the digit sum divisible by 9 when appended',
		'Handle already divisible sums by returning 0',
		'Preserve leading zeros in the original string'
	],
	constraints: ['1 <= len(value) <= 100000', 'value consists only of decimal digits'],
	edgeCases: [
		'If the current sum is already divisible by 9, append 0',
		'Large inputs require streaming digit sums to avoid overflow',
		'Single digit inputs should still work'
	],
	hints: [
		'Compute sum(value) % 9',
		'The digit to append is (-current_sum) mod 9, but use 0 instead of 9',
		'You can iterate characters and convert to int with ord or int()'
	],
	followUpIdeas: [
		'Return the full new string, not just the digit',
		'Explain whether multiple choices are possible (only one smallest digit exists)'
	],
	examples: [
		{
			label: 'Example 1',
			input: 'value = "827"',
			output: '1',
			explanation: '8 + 2 + 7 = 17. Adding 1 reaches 18, divisible by 9.'
		},
		{
			label: 'Example 2',
			input: 'value = "99"',
			output: '0',
			explanation: 'Sum is 18 already divisible by 9, so append 0.'
		},
		{
			label: 'Example 3',
			input: 'value = "4102"',
			output: '2',
			explanation: '4 + 1 + 0 + 2 = 7, so adding 2 reaches 9.'
		}
	],
	solution: {
		optimal: {
			title: 'Use modulo 9 complement',
			overview: 'Take the digit sum modulo 9. If zero, answer 0; otherwise return 9 - (sum % 9).',
			steps: [
				'Compute current = sum(int(d) for d in value) % 9.',
				'If current == 0 return "0".',
				'Else return str(9 - current).'
			],
			timeComplexity: 'O(n)',
			spaceComplexity: 'O(1)',
			keyIdeas: [
				'Modulo 9 complement chooses the smallest fixer',
				'String iteration avoids big integer issues'
			]
		},
		alternatives: [
			{
				title: 'Digital root shortcut',
				overview:
					'Compute the digital root first. The append digit is (9 - root) % 9 with a special case when root == 0.',
				steps: [
					'Find the digital root r of the number.',
					'If r == 0 return "0" else return str((9 - r) % 9).',
					'Same work but connects with previous task.'
				],
				timeComplexity: 'O(n)',
				spaceComplexity: 'O(1)',
				keyIdeas: [
					'Ties directly to digital root computation',
					'Reuse previous helper if implemented'
				]
			}
		]
	},
	source: {
		path: 'generated/welcome/digital/nine-adjuster.md',
		markdown:
			'# Casting Out Nines\n\nGiven a string of digits `value`, find the smallest digit you can append so that the sum of all digits becomes divisible by 9. Return the digit as a string ("0"–"9").'
	},
	metadataVersion: 1,
	starterCode:
		'def digit_to_append(value: str) -> str:\n' +
		'    """Return the smallest digit that makes the digit sum divisible by 9."""\n' +
		'    # TODO: implement using the modulo 9 complement\n' +
		'    return "0"\n'
};
const modularMagicPlan: PlanItem[] = [
	{
		id: 'modular-clock-intro',
		kind: 'quiz',
		title: 'Idea spark · Clock thinking',
		icon: '🕒',
		meta: '2 cards · 2 checks',
		summary: 'Meet remainders as wrap-around numbers with quick checks.',
		progressKey: 'intro'
	},
	{
		id: 'modular-residue-lab',
		kind: 'quiz',
		title: 'Residue lab · Quick practice',
		icon: '🧮',
		meta: '3 quick wins',
		summary: 'Try modular shortcuts with friendly numbers.',
		progressKey: 'practice'
	},
	{
		id: 'clock-stepper',
		kind: 'problem',
		title: 'Practice · Clock Stepper',
		icon: '⏱️',
		meta: 'Mod · Easy',
		summary: 'Traverse a clock using wrap-around addition.',
		difficulty: 'easy',
		topic: 'Modular Arithmetic'
	},
	{
		id: 'remainder-buckets',
		kind: 'problem',
		title: 'Challenge · Remainder Buckets',
		icon: '🗂️',
		meta: 'Counting · Easy',
		summary: 'Group numbers by remainder to count friendly pairs.',
		difficulty: 'easy',
		topic: 'Number Theory'
	},
	{
		id: 'modular-wrap-review',
		kind: 'quiz',
		title: 'Wrap-up · Mod intuition',
		icon: '✅',
		meta: '3 reflections',
		summary: 'Lock in how mods compose and power hashing.',
		progressKey: 'review'
	}
];
const binarySparksPlan: PlanItem[] = [
	{
		id: 'xor-intro',
		kind: 'quiz',
		title: 'Idea spark · XOR vibes',
		icon: '✨',
		meta: '2 cards · 2 checks',
		summary: 'See XOR as a “different?” switch and connect it to parity.',
		progressKey: 'intro'
	},
	{
		id: 'xor-practice',
		kind: 'quiz',
		title: 'Parity lab · Quick runs',
		icon: '💡',
		meta: '3 mini tasks',
		summary: 'Practice XOR arithmetic with friendly numbers.',
		progressKey: 'practice'
	},
	{
		id: 'xor-lamp-grid',
		kind: 'problem',
		title: 'Practice · Lamp Toggler',
		icon: '💡',
		meta: 'Parity · Easy',
		summary: 'Track lamps that stay lit by counting odd toggles.',
		difficulty: 'easy',
		topic: 'Bitwise Operations'
	},
	{
		id: 'nim-balance',
		kind: 'problem',
		title: 'Challenge · Nim Balance',
		icon: '🎮',
		meta: 'Game Theory · Easy',
		summary: 'Decide a Nim game by computing the nim-sum.',
		difficulty: 'easy',
		topic: 'Game Theory'
	},
	{
		id: 'xor-review',
		kind: 'quiz',
		title: 'Wrap-up · Nim intuition',
		icon: '✅',
		meta: '3 reflections',
		summary: 'Lock in XOR cancellation and nim-sum meaning.',
		progressKey: 'review'
	}
];
const digitalRootsPlan: PlanItem[] = [
	{
		id: 'digital-intro',
		kind: 'quiz',
		title: 'Idea spark · Digital roots',
		icon: '🌱',
		meta: '2 cards · 2 checks',
		summary: 'Discover how repeated digit sums loop to a single number.',
		progressKey: 'intro'
	},
	{
		id: 'digital-practice',
		kind: 'quiz',
		title: 'Practice · Casting out nines',
		icon: '🧮',
		meta: '3 mini tasks',
		summary: 'Use digital roots to test divisibility and build intuition.',
		progressKey: 'practice'
	},
	{
		id: 'digital-root-finder',
		kind: 'problem',
		title: 'Practice · Digital Root Finder',
		icon: '🔢',
		meta: 'Number Sense · Easy',
		summary: 'Turn big numbers into single digits with repeated sums.',
		difficulty: 'easy',
		topic: 'Number Theory'
	},
	{
		id: 'nine-adjuster',
		kind: 'problem',
		title: 'Challenge · Casting Out Nines',
		icon: '🧩',
		meta: 'Greedy · Easy',
		summary: 'Pick the smallest digit that makes a number “feel” divisible by 9.',
		difficulty: 'easy',
		topic: 'Number Theory'
	},
	{
		id: 'digital-review',
		kind: 'quiz',
		title: 'Wrap-up · Number sense',
		icon: '✅',
		meta: '3 reflections',
		summary: 'Review when digital roots are helpful shortcuts.',
		progressKey: 'review'
	}
];
const modularMagicQuizzes: QuizDefinition[] = [
	{
		id: 'modular-clock-intro',
		title: 'Clock arithmetic sparks',
		topic: 'Modular Arithmetic',
		estimatedMinutes: 4,
		progressKey: 'intro',
		description: 'Learn remainders as wrap-around numbers through mini stories.',
		questions: [
			{
				kind: 'info-card',
				id: 'mod-intro-card-1',
				prompt: 'Remainders = wrap-around numbers',
				eyebrow: 'Concept',
				body: 'Imagine walking around a 12-hour clock. After 12 steps you are back at 0. Modulo arithmetic keeps only how far around the circle you travelled.',
				continueLabel: 'Next idea'
			},
			{
				kind: 'info-card',
				id: 'mod-intro-card-2',
				prompt: 'Where mod pops up',
				eyebrow: 'Examples',
				body: 'Hash tables bucket keys by mod, cryptography hides secrets with modulus, and scheduling cycles through days using remainders.',
				continueLabel: 'Ready to try'
			},
			{
				kind: 'multiple-choice',
				id: 'mod-intro-q1',
				prompt: 'What is 17 mod 5?',
				hint: 'Divide 17 by 5 and keep the remainder only.',
				explanation: '17 = 3 × 5 + 2, so the remainder is 2.',
				options: [
					{ id: 'A', label: 'A', text: '2' },
					{ id: 'B', label: 'B', text: '3' },
					{ id: 'C', label: 'C', text: '5' },
					{ id: 'D', label: 'D', text: '0' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Dividing 17 by 5 leaves 2 behind, exactly the remainder we wanted.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'mod-intro-q2',
				prompt: '29 ≡ 1 (mod 7). What does this statement mean?',
				hint: 'Write 29 as 7 × something plus a remainder.',
				explanation:
					'It means 29 leaves remainder 1 when divided by 7 (29 - 1 is a multiple of 7).',
				options: [
					{ id: 'A', label: 'A', text: '29 leaves remainder 1 when divided by 7' },
					{ id: 'B', label: 'B', text: '7 divides 29 evenly' },
					{ id: 'C', label: 'C', text: '29 and 7 are both prime' },
					{ id: 'D', label: 'D', text: '29 is less than 7' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'You read the congruence correctly: 29 and 7 differ by a multiple of 7.'
				}
			}
		]
	},
	{
		id: 'modular-residue-lab',
		title: 'Residue lab',
		topic: 'Modular Arithmetic',
		estimatedMinutes: 5,
		progressKey: 'practice',
		description: 'Practice fast remainders and friendly algebra rules.',
		questions: [
			{
				kind: 'info-card',
				id: 'mod-lab-card-1',
				prompt: 'Two helpful rules',
				eyebrow: 'Rules',
				body: '(a + b) mod m = ((a mod m) + (b mod m)) mod m. Negative answers wrap by adding m until you land in 0…m-1.',
				continueLabel: 'Try it'
			},
			{
				kind: 'type-answer',
				id: 'mod-lab-ta-1',
				prompt: 'Compute (38 + 26) mod 7.',
				hint: 'Reduce 38 and 26 before adding.',
				explanation: '38 ≡ 3 and 26 ≡ 5 (mod 7). 3 + 5 = 8 ≡ 1.',
				answer: '1',
				acceptableAnswers: ['1'],
				placeholder: 'Enter a number',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Reducing each addend first makes the wrap land neatly on 1.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'mod-lab-q1',
				prompt: 'Which expression is equal to (a × b) mod m?',
				hint: 'Reduce the factors first.',
				explanation: 'Reducing each factor and then multiplying keeps the same remainder.',
				options: [
					{ id: 'A', label: 'A', text: '((a mod m) × (b mod m)) mod m' },
					{ id: 'B', label: 'B', text: '(a × b) + m' },
					{ id: 'C', label: 'C', text: '(a × b) mod (m × m)' },
					{ id: 'D', label: 'D', text: '((a + m) × (b + m))' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Multiplying the reduced factors keeps the same remainder mod m.'
				}
			},
			{
				kind: 'type-answer',
				id: 'mod-lab-ta-2',
				prompt: 'Give the least non-negative remainder of -5 mod 12.',
				hint: 'Add 12 until you land in the 0…11 range.',
				explanation: '-5 + 12 = 7, so the remainder is 7.',
				answer: '7',
				acceptableAnswers: ['7'],
				placeholder: '0-11',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Adding 12 once brings -5 into the 0…11 window at 7.'
				}
			}
		]
	},
	{
		id: 'modular-wrap-review',
		title: 'Mod wrap-up',
		topic: 'Modular Arithmetic',
		estimatedMinutes: 3,
		progressKey: 'review',
		description: 'Reflect on why modular arithmetic is everywhere.',
		questions: [
			{
				kind: 'multiple-choice',
				id: 'mod-review-q1',
				prompt: 'Why do hash tables often use (key mod m)?',
				hint: 'Think about bucket indexes.',
				explanation: 'It keeps bucket indexes within 0…m-1, perfectly matching an array of size m.',
				options: [
					{ id: 'A', label: 'A', text: 'It keeps bucket indexes in the valid range 0…m-1' },
					{ id: 'B', label: 'B', text: 'It makes every key unique' },
					{ id: 'C', label: 'C', text: 'It sorts the keys automatically' },
					{ id: 'D', label: 'D', text: 'It halves the amount of memory used' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Keeping buckets inside 0…m-1 is exactly why we take key mod m.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'mod-review-q2',
				prompt: 'You know a ≡ b (mod m). Which statement is always true?',
				hint: 'Compare their difference.',
				explanation: 'They differ by a multiple of m, so a - b is divisible by m.',
				options: [
					{ id: 'A', label: 'A', text: 'a - b is a multiple of m' },
					{ id: 'B', label: 'B', text: 'a and b must both be prime' },
					{ id: 'C', label: 'C', text: 'a + b = m' },
					{ id: 'D', label: 'D', text: 'a × b must be 0' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Spotting that a and b differ by a multiple of m is the key congruence fact.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'mod-review-q3',
				prompt: 'Travel scheduling uses (hours mod 24) because…',
				hint: '24 hours form one full loop.',
				explanation: 'It wraps long hour offsets back into the current-day window.',
				options: [
					{ id: 'A', label: 'A', text: 'It wraps long hour offsets back into a single-day window' },
					{ id: 'B', label: 'B', text: 'It forces trips to last exactly 24 hours' },
					{ id: 'C', label: 'C', text: 'It randomises boarding times' },
					{ id: 'D', label: 'D', text: 'It avoids dealing with minutes' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Wrapping long schedules back into a 24-hour window is exactly the point.'
				}
			}
		]
	}
];
const binarySparksQuizzes: QuizDefinition[] = [
	{
		id: 'xor-intro',
		title: 'XOR sparks',
		topic: 'Bitwise Operations',
		estimatedMinutes: 4,
		progressKey: 'intro',
		description: 'Meet XOR as “different?” and understand why duplicates cancel.',
		questions: [
			{
				kind: 'info-card',
				id: 'xor-intro-card-1',
				prompt: 'XOR is “different?”',
				eyebrow: 'Concept',
				body: 'Bitwise XOR compares two bits and outputs 1 only when they differ. It behaves like a light switch: toggle once to turn on, toggle again to turn off.',
				continueLabel: 'Next insight'
			},
			{
				kind: 'info-card',
				id: 'xor-intro-card-2',
				prompt: 'Parity through XOR',
				eyebrow: 'Insight',
				body: 'Folding a list with XOR reports whether the count of 1s is odd (result 1) or even (result 0). That is why parity bits and Nim strategies use XOR.',
				continueLabel: 'Ready to quiz'
			},
			{
				kind: 'multiple-choice',
				id: 'xor-intro-q1',
				prompt: 'What is 1 xor 1?',
				hint: 'Same bits produce 0.',
				explanation: 'XOR outputs 0 when both bits are the same, so 1 xor 1 = 0.',
				options: [
					{ id: 'A', label: 'A', text: '0' },
					{ id: 'B', label: 'B', text: '1' },
					{ id: 'C', label: 'C', text: '2' },
					{ id: 'D', label: 'D', text: 'Undefined' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Matching bits cancel to 0, so 1 xor 1 landing at 0 is perfect.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'xor-intro-q2',
				prompt: 'What happens when you XOR any integer x with itself?',
				hint: 'Toggle twice.',
				explanation: 'XORing a value with itself cancels to 0, just like toggling a switch twice.',
				options: [
					{ id: 'A', label: 'A', text: 'The result is always 0' },
					{ id: 'B', label: 'B', text: 'The result doubles x' },
					{ id: 'C', label: 'C', text: 'The result keeps x unchanged' },
					{ id: 'D', label: 'D', text: 'The result flips every bit to 1' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Toggling twice cancels out—x xor x collapsing to 0 shows you get it.'
				}
			}
		]
	},
	{
		id: 'xor-practice',
		title: 'Parity lab',
		topic: 'Bitwise Operations',
		estimatedMinutes: 5,
		progressKey: 'practice',
		description: 'Try quick XOR drills to cement cancellation behaviour.',
		questions: [
			{
				kind: 'info-card',
				id: 'xor-practice-card-1',
				prompt: 'Three fast facts',
				eyebrow: 'Facts',
				body: '1) XOR is commutative and associative. 2) x xor 0 = x. 3) x xor x = 0. Together these rules make it easy to fold long lists.',
				continueLabel: 'Try a drill'
			},
			{
				kind: 'type-answer',
				id: 'xor-practice-ta-1',
				prompt: 'Compute 13 xor 7.',
				hint: 'Write both numbers in binary or use a calculator.',
				explanation: '13 (1101₂) xor 7 (0111₂) = 1010₂ = 10.',
				answer: '10',
				acceptableAnswers: ['10'],
				placeholder: 'Enter a number',
				correctFeedback: {
					heading: 'Nice work',
					message: 'XORing 13 and 7 to get 10 shows you combined the bits perfectly.'
				}
			},
			{
				kind: 'type-answer',
				id: 'xor-practice-ta-2',
				prompt: 'What is the XOR of [4, 4, 9, 3, 3]?',
				hint: 'Pairs cancel out to 0.',
				explanation: '4 xor 4 = 0 and 3 xor 3 = 0, so the result reduces to 0 xor 9 = 9.',
				answer: '9',
				acceptableAnswers: ['9'],
				placeholder: 'Enter a number',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Canceling the pairs and leaving 9 nails the XOR trick.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'xor-practice-q1',
				prompt: 'One lamp starts OFF. Which non-empty toggle log leaves it OFF?',
				hint: 'Even number of toggles returns to OFF.',
				explanation: 'Two toggles cancel, so [3, 3] leaves the lamp OFF.',
				options: [
					{ id: 'A', label: 'A', text: '[7]' },
					{ id: 'B', label: 'B', text: '[3, 3]' },
					{ id: 'C', label: 'C', text: '[5, 5, 5]' },
					{ id: 'D', label: 'D', text: '[2, 2, 2, 2, 2]' }
				],
				correctOptionId: 'B',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Choosing the even toggle count [3, 3] keeps the lamp off exactly as planned.'
				}
			}
		]
	},
	{
		id: 'xor-review',
		title: 'XOR wrap-up',
		topic: 'Bitwise Operations',
		estimatedMinutes: 3,
		progressKey: 'review',
		description: 'Reflect on how XOR supports parity checks and Nim strategy.',
		questions: [
			{
				kind: 'multiple-choice',
				id: 'xor-review-q1',
				prompt:
					'Why can XOR find the single unique element in an array where every other element appears twice?',
				hint: 'Think cancellation.',
				explanation: 'Pairs cancel to 0 and only the unique element remains in the running XOR.',
				options: [
					{
						id: 'A',
						label: 'A',
						text: 'Because XOR cancels matching values and leaves the unique one'
					},
					{ id: 'B', label: 'B', text: 'Because XOR sorts the array first' },
					{ id: 'C', label: 'C', text: 'Because XOR turns all numbers into primes' },
					{ id: 'D', label: 'D', text: 'Because XOR uses division internally' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Using XOR cancellations to isolate the lone element is exactly right.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'xor-review-q2',
				prompt: 'A Nim position has nim-sum 0. What does that tell you?',
				hint: 'Zero nim-sum is special.',
				explanation:
					'A zero nim-sum means the next player loses with optimal play if the opponent plays perfectly.',
				options: [
					{ id: 'A', label: 'A', text: 'The next player is already losing with perfect play' },
					{ id: 'B', label: 'B', text: 'The next player will always win immediately' },
					{ id: 'C', label: 'C', text: 'The piles must all be equal' },
					{ id: 'D', label: 'D', text: 'There are no valid moves' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Recognising a zero nim-sum as a losing position shows Nim mastery.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'xor-review-q3',
				prompt: 'What does XOR compute when folding a stream of bits?',
				hint: 'Parity check.',
				explanation: 'XOR reports whether the number of 1 bits seen so far is odd (1) or even (0).',
				options: [
					{ id: 'A', label: 'A', text: 'The parity (odd/even) of the number of 1 bits' },
					{ id: 'B', label: 'B', text: 'The largest bit position seen' },
					{ id: 'C', label: 'C', text: 'The sum of all bits' },
					{ id: 'D', label: 'D', text: 'The product of all bits' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Spotting XOR as a parity tracker is the exact insight we wanted.'
				}
			}
		]
	}
];
const digitalRootsQuizzes: QuizDefinition[] = [
	{
		id: 'digital-intro',
		title: 'Digital root sparks',
		topic: 'Number Theory',
		estimatedMinutes: 4,
		progressKey: 'intro',
		description: 'See how repeated digit sums land on a stable single digit.',
		questions: [
			{
				kind: 'info-card',
				id: 'digital-intro-card-1',
				prompt: 'Digital roots in a nutshell',
				eyebrow: 'Concept',
				body: 'Take any positive number, add its digits, and repeat until one digit remains. That final digit is the digital root. Zero is its own digital root.',
				continueLabel: 'Next insight'
			},
			{
				kind: 'info-card',
				id: 'digital-intro-card-2',
				prompt: 'Casting out nines',
				eyebrow: 'Shortcut',
				body: 'Digital roots follow the same pattern as “modulo 9”. Two numbers with the same digital root differ by a multiple of 9.',
				continueLabel: 'Ready for questions'
			},
			{
				kind: 'multiple-choice',
				id: 'digital-intro-q1',
				prompt: 'What is the digital root of 493?',
				hint: 'Sum digits until one remains.',
				explanation: '4 + 9 + 3 = 16 and 1 + 6 = 7.',
				options: [
					{ id: 'A', label: 'A', text: '7' },
					{ id: 'B', label: 'B', text: '8' },
					{ id: 'C', label: 'C', text: '13' },
					{ id: 'D', label: 'D', text: '16' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Adding 4 + 9 + 3 and collapsing 16 to 7 shows you have the process down.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'digital-intro-q2',
				prompt:
					'If two numbers have the same digital root, what can you say about their difference?',
				hint: 'Think modulo 9.',
				explanation:
					'They differ by a multiple of 9, because digital roots encode numbers modulo 9.',
				options: [
					{ id: 'A', label: 'A', text: 'Their difference is divisible by 9' },
					{ id: 'B', label: 'B', text: 'They must be prime numbers' },
					{ id: 'C', label: 'C', text: 'They are consecutive integers' },
					{ id: 'D', label: 'D', text: 'Their difference is always less than 10' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message:
						'Linking equal digital roots to a difference divisible by 9 is exactly the right takeaway.'
				}
			}
		]
	},
	{
		id: 'digital-practice',
		title: 'Casting out quickies',
		topic: 'Number Theory',
		estimatedMinutes: 5,
		progressKey: 'practice',
		description: 'Practice computing digital roots and using them for divisibility.',
		questions: [
			{
				kind: 'info-card',
				id: 'digital-practice-card-1',
				prompt: 'Quick rules',
				eyebrow: 'Tips',
				body: 'Adding 9 does not change the digital root. Roots run 1…9 and reset to 0 only when the number itself is 0.',
				continueLabel: 'Let me try'
			},
			{
				kind: 'type-answer',
				id: 'digital-practice-ta-1',
				prompt: 'Find the digital root of 9999.',
				hint: 'You can use the modulo 9 shortcut.',
				explanation: '9 + 9 + 9 + 9 = 36 and 3 + 6 = 9 (or 9999 mod 9 = 0 → digital root 9).',
				answer: '9',
				acceptableAnswers: ['9'],
				placeholder: 'Enter a digit',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Summing the digits (or using mod 9) to land on 9 shows you know the shortcut.'
				}
			},
			{
				kind: 'type-answer',
				id: 'digital-practice-ta-2',
				prompt:
					'You have the string "827". What single digit should you append so the digit sum becomes divisible by 9?',
				hint: 'Bring the sum to the next multiple of 9.',
				explanation: '8 + 2 + 7 = 17. Adding 1 reaches 18, which is divisible by 9.',
				answer: '1',
				acceptableAnswers: ['1'],
				placeholder: 'Enter a digit 0-9',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Topping the sum up to 18 with a 1 nails the divisibility trick.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'digital-practice-q1',
				prompt: 'Which number has a digital root of 4?',
				hint: 'Sum digits to check.',
				explanation: '1 + 3 = 4, so 13 has digital root 4.',
				options: [
					{ id: 'A', label: 'A', text: '13' },
					{ id: 'B', label: 'B', text: '22' },
					{ id: 'C', label: 'C', text: '49' },
					{ id: 'D', label: 'D', text: '40' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: '13 collapses to 1 + 3 = 4, exactly the root we asked for.'
				}
			}
		]
	},
	{
		id: 'digital-review',
		title: 'Digital root wrap-up',
		topic: 'Number Theory',
		estimatedMinutes: 3,
		progressKey: 'review',
		description: 'Reflect on where digital roots help in mental math and coding.',
		questions: [
			{
				kind: 'multiple-choice',
				id: 'digital-review-q1',
				prompt: 'Why are digital roots useful for checking hand calculations?',
				hint: 'Think quick error detection.',
				explanation:
					'If the digital root of the result does not match the digital root of the inputs (with appropriate operations), you probably made a mistake.',
				options: [
					{ id: 'A', label: 'A', text: 'They catch errors by comparing sums modulo 9' },
					{ id: 'B', label: 'B', text: 'They guarantee the answer is prime' },
					{ id: 'C', label: 'C', text: 'They rearrange digits into ascending order' },
					{ id: 'D', label: 'D', text: 'They remove the need for multiplication' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Using digital roots as a quick mod 9 check is exactly their power.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'digital-review-q2',
				prompt: 'What is the digital root of 0 defined to be?',
				hint: 'Check the special case.',
				explanation: 'By definition the digital root of 0 is 0.',
				options: [
					{ id: 'A', label: 'A', text: '0' },
					{ id: 'B', label: 'B', text: '1' },
					{ id: 'C', label: 'C', text: '9' },
					{ id: 'D', label: 'D', text: 'Undefined' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Remembering that 0 maps to digital root 0 keeps the definitions straight.'
				}
			},
			{
				kind: 'multiple-choice',
				id: 'digital-review-q3',
				prompt: 'If the digital root of n is 9 (and n > 0), what does that tell you?',
				hint: 'Relate to modulo 9.',
				explanation: 'It means n is divisible by 9 (n ≡ 0 mod 9).',
				options: [
					{ id: 'A', label: 'A', text: 'n is divisible by 9' },
					{ id: 'B', label: 'B', text: 'n must be prime' },
					{ id: 'C', label: 'C', text: 'n has exactly nine digits' },
					{ id: 'D', label: 'D', text: 'n is divisible by 8 but not 9' }
				],
				correctOptionId: 'A',
				correctFeedback: {
					heading: 'Nice work',
					message: 'Seeing a digital root of 9 as “divisible by 9” is the exact interpretation.'
				}
			}
		]
	}
];
const modularMagicProblems: CodeProblem[] = [clockStepperProblem, remainderBucketsProblem];
const binarySparksProblems: CodeProblem[] = [xorLampGridProblem, nimBalanceProblem];
const digitalRootsProblems: CodeProblem[] = [digitalRootProblem, nineAdjusterProblem];

const modularMagicTemplate: WelcomeSessionTemplate = {
	id: 'welcome-modular-magic',
	title: 'Modular Magic: Clock Arithmetic',
	tagline: 'Discover how wrap-around numbers power clocks, hashes, and scheduling.',
	plan: modularMagicPlan,
	quizzes: modularMagicQuizzes,
	problems: modularMagicProblems,
	emoji: '🪄'
};

const binarySparksTemplate: WelcomeSessionTemplate = {
	id: 'welcome-binary-sparks',
	title: 'Binary Sparks: XOR & Nim Tricks',
	tagline: 'Use XOR to track parity and outsmart simple games.',
	plan: binarySparksPlan,
	quizzes: binarySparksQuizzes,
	problems: binarySparksProblems,
	emoji: '⚡️'
};

const digitalRootsTemplate: WelcomeSessionTemplate = {
	id: 'welcome-digital-roots',
	title: 'Digital Roots: Casting Out Nines',
	tagline: 'Turn long numbers into quick mental checks with digital roots.',
	plan: digitalRootsPlan,
	quizzes: digitalRootsQuizzes,
	problems: digitalRootsProblems,
	emoji: '🌱'
};

const WELCOME_SESSION_TEMPLATES: Record<WelcomeSessionKey, WelcomeSessionTemplate> = {
	'modular-magic': modularMagicTemplate,
	'binary-sparks': binarySparksTemplate,
	'digital-roots': digitalRootsTemplate
};
export function listWelcomeSessionOptions(): WelcomeSessionOption[] {
	return Object.entries(WELCOME_SESSION_TEMPLATES).map(([key, template]) => ({
		key: key as WelcomeSessionKey,
		title: template.title,
		tagline: template.tagline,
		emoji: template.emoji
	}));
}

async function seedSessionState(userId: string, session: Session): Promise<void> {
	const firestore = getFirebaseAdminFirestore();
	const stateRef = firestore.collection('spark').doc(userId).collection('state').doc(session.id);

	const baseState: SessionState = SessionStateSchema.parse({
		sessionId: session.id,
		items: session.plan.reduce<Record<string, SessionState['items'][string]>>((acc, item) => {
			acc[item.id] = { status: 'not_started' };
			return acc;
		}, {}),
		lastUpdatedAt: Timestamp.now()
	});

	await stateRef.set(baseState);
}

export async function provisionWelcomeSession(
	userId: string,
	key: WelcomeSessionKey
): Promise<Session> {
	const template = WELCOME_SESSION_TEMPLATES[key];
	if (!template) {
		throw new Error(`Unknown welcome session key: ${key}`);
	}

	const existing = await getSession(userId, template.id);
	if (existing) {
		await setCurrentSessionId(userId, existing.id);
		return existing;
	}

	const sessionInput = {
		id: template.id,
		title: template.title,
		createdAt: Timestamp.now(),
		plan: template.plan
	};

	const session = SessionSchema.parse(sessionInput);

	await saveSession(userId, session);

	await Promise.all(template.quizzes.map((quiz) => saveUserQuiz(userId, session.id, quiz)));
	await Promise.all(
		template.problems.map((problem) => saveUserProblem(userId, session.id, problem))
	);

	await seedSessionState(userId, session);
	await setCurrentSessionId(userId, session.id);

	return session;
}
