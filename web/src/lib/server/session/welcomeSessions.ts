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
const clockStepperExamples = [
	{
		title: 'Example 1',
		input: ['12 3', '3', '4 6 5'].join('\n'),
		output: '6',
		explanation: 'Start at hour 3, add 15 total steps → 18. 18 mod 12 = 6.'
	},
	{
		title: 'Example 2',
		input: ['12 11', '2', '2 -5'].join('\n'),
		output: '8',
		explanation: '11 + 2 - 5 = 8, already within the clock.'
	},
	{
		title: 'Example 3',
		input: ['24 0', '3', '-1 -1 -1'].join('\n'),
		output: '21',
		explanation: 'Total movement is -3. Wrapping with modulo 24 lands on 21.'
	}
];

const clockStepperTests = [
	{ input: clockStepperExamples[0].input, output: clockStepperExamples[0].output, explanation: clockStepperExamples[0].explanation },
	{ input: clockStepperExamples[1].input, output: clockStepperExamples[1].output, explanation: clockStepperExamples[1].explanation },
	{ input: clockStepperExamples[2].input, output: clockStepperExamples[2].output, explanation: clockStepperExamples[2].explanation },
	{ input: ['12 7', '0'].join('\n'), output: '7' },
	{ input: ['8 1', '4', '3 3 3 3'].join('\n'), output: '5' },
	{ input: ['15 5', '3', '-4 -7 12'].join('\n'), output: '6' },
	{ input: ['24 0', '3', '-12 48 -1'].join('\n'), output: '11' },
	{ input: ['10 9', '1', '1'].join('\n'), output: '0' },
	{ input: ['10 9', '5', '1 1 1 1 1'].join('\n'), output: '4' },
	{ input: ['6 2', '3', '6 -3 -9'].join('\n'), output: '2' },
	{ input: ['13 3', '3', '13 26 39'].join('\n'), output: '3' },
	{ input: ['5 4', '5', '-1 -1 -1 -1 -1'].join('\n'), output: '4' }
];

const clockStepperProblem: CodeProblem = {
	slug: 'clock-stepper',
	title: 'Clock Stepper',
	difficulty: 'intro',
	topics: ['Modular Arithmetic', 'Simulation'],
	description: [
		'You are walking around a circular clock with `m` positions labelled `0` to `m-1`. Starting from an initial hour, you receive signed jumps that move you forward or backward around the clock.',
		'',
		'Read the clock size, the starting position, and the sequence of jumps from standard input. Apply every jump and print the final hour index after wrapping into `0…m-1`. Do not output any extra text.'
	].join('\n'),
	inputFormat: [
		'- Line 1: two integers m and start (1 ≤ m, 0 ≤ start < m).',
		'- Line 2: integer n — the number of jumps.',
		'- Line 3 (present only when n > 0): n space-separated integers giving each jump amount.'
	].join('\n'),
	constraints: [
		'1 ≤ m ≤ 1_000_000_000',
		'0 ≤ start < m',
		'0 ≤ n ≤ 200_000',
		'-1_000_000_000 ≤ jump ≤ 1_000_000_000'
	],
	examples: clockStepperExamples,
	tests: clockStepperTests,
	hints: [
		'Start from the normalized starting position (modulo m) before applying jumps.',
		'Sum each step into the current position and wrap with `% modulo` after every update.',
		'Python’s modulo already handles negative numbers correctly, so no extra conditionals are required.'
	],
	solution: {
		language: 'python',
		code: [
			'import sys',
			'',
			'data = sys.stdin.read().strip().split()',
			'if not data:',
			'    sys.exit(0)',
			'it = iter(data)',
			'modulo = int(next(it))',
			'start = int(next(it))',
			'step_count = int(next(it))',
			'steps = [int(next(it)) for _ in range(step_count)]',
			'',
			'position = start % modulo',
			'for step in steps:',
			'    position = (position + step) % modulo',
			'',
			'print(position)'
		].join('\n')
	},
	metadataVersion: 2
};


const remainderBucketsExamples = [
	{
		title: 'Example 1',
		input: ['4 5', '3 8 10 15'].join('\n'),
		output: '2',
		explanation: 'Remainder 3 appears twice (3 and 8) and remainder 0 appears twice (10 and 15).'
	},
	{
		title: 'Example 2',
		input: ['4 4', '-4 5 7 13'].join('\n'),
		output: '1',
		explanation: 'Normalising remainders gives {0,1,3,1}; only remainder 1 repeats.'
	},
	{
		title: 'Example 3',
		input: ['3 4', '1 2 3'].join('\n'),
		output: '0',
		explanation: 'Every remainder is unique so there are no friendly pairs.'
	}
];

const remainderBucketsTests = [
	{ input: remainderBucketsExamples[0].input, output: remainderBucketsExamples[0].output, explanation: remainderBucketsExamples[0].explanation },
	{ input: remainderBucketsExamples[1].input, output: remainderBucketsExamples[1].output, explanation: remainderBucketsExamples[1].explanation },
	{ input: remainderBucketsExamples[2].input, output: remainderBucketsExamples[2].output, explanation: remainderBucketsExamples[2].explanation },
	{ input: ['1 5', '42'].join('\n'), output: '0' },
	{ input: ['5 10', '10 20 30 40 50'].join('\n'), output: '10' },
	{ input: ['5 5', '7 12 17 21 26'].join('\n'), output: '4' },
	{ input: ['6 7', '1 8 15 22 29 36'].join('\n'), output: '15' },
	{ input: ['6 4', '0 1 2 3 4 5'].join('\n'), output: '2' },
	{ input: ['8 6', '5 11 17 23 29 0 -6 -12'].join('\n'), output: '13' },
	{ input: ['7 9', '3 6 9 12 15 18 21'].join('\n'), output: '5' },
	{ input: ['9 8', '8 16 24 32 1 9 17 25 33'].join('\n'), output: '16' },
	{ input: ['10 11', '100 -1 22 33 44 55 66 77 88 99'].join('\n'), output: '28' },
	{ input: ['6 3', '0 3 6 9 12 15'].join('\n'), output: '15' }
];

const remainderBucketsProblem: CodeProblem = {
	slug: 'remainder-buckets',
	title: 'Remainder Buckets',
	difficulty: 'intro',
	topics: ['Modular Arithmetic', 'Counting'],
	description: [
		"Numbers that leave the same remainder when divided by m land in the same modular bucket. Count how many unordered pairs of inputs share a bucket.",
		'',
		"Normalise negative numbers using Python's `%` and print only the total number of friendly pairs."
	].join('\n'),
	inputFormat: [
		'- Line 1: two integers n and m (number of values and the modulus).',
		'- Line 2: n space-separated integers.'
	].join('\n'),
	constraints: [
		'1 ≤ n ≤ 100_000',
		'2 ≤ m ≤ 10_000',
		'-1_000_000_000 ≤ value ≤ 1_000_000_000'
	],
	examples: remainderBucketsExamples,
	tests: remainderBucketsTests,
	hints: [
		'Bucket each value by computing value % m (Python already keeps the result in 0…m-1).',
		'Every new element in a bucket adds the current bucket size to the answer.',
		'With frequencies in hand you can also sum c * (c - 1) / 2 per bucket.'
	],
	solution: {
		language: 'python',
		code: [
			'import sys',
			'from collections import defaultdict',
			'',
			'data = sys.stdin.read().strip().split()',
			'if not data:',
			'    sys.exit(0)',
			'it = iter(data)',
			'count = int(next(it))',
			'modulus = int(next(it))',
			'values = [int(next(it)) for _ in range(count)]',
			'',
			'bucket_counts = defaultdict(int)',
			'pairs = 0',
			'for value in values:',
			'    remainder = value % modulus',
			'    pairs += bucket_counts[remainder]',
			'    bucket_counts[remainder] += 1',
			'',
			'print(pairs)'
		].join('\n')
	},
	metadataVersion: 2
};


const xorLampExamples = [
	{
		title: "Example 1",
		input: ['5 4', '1 2 1 4'].join('\n'),
		output: '2 4',
		explanation: 'Lamp 1 is toggled twice (OFF). Lamps 2 and 4 toggle once and stay ON.'
	},
	{
		title: "Example 2",
		input: ['3 3', '0 0 0'].join('\n'),
		output: '0',
		explanation: 'Lamp 0 toggles three times → odd parity → ON.'
	},
	{
		title: "Example 3",
		input: ['4 0'].join('\n'),
		output: 'NONE',
		explanation: 'No events means every lamp remains OFF.'
	}
];

const xorLampTests = [
	{ input: xorLampExamples[0].input, output: xorLampExamples[0].output, explanation: xorLampExamples[0].explanation },
	{ input: xorLampExamples[1].input, output: xorLampExamples[1].output, explanation: xorLampExamples[1].explanation },
	{ input: xorLampExamples[2].input, output: xorLampExamples[2].output, explanation: xorLampExamples[2].explanation },
	{ input: ['6 6', '0 1 2 3 4 5'].join('\n'), output: '0 1 2 3 4 5' },
	{ input: ['6 7', '0 1 2 1 0 5 5'].join('\n'), output: '2' },
	{ input: ['10 4', '3 3 3 3'].join('\n'), output: 'NONE' },
	{ input: ['8 5', '7 0 7 0 7'].join('\n'), output: '7' },
	{ input: ['5 10', '0 0 1 1 2 2 3 3 4 4'].join('\n'), output: 'NONE' },
	{ input: ['5 9', '0 1 2 3 4 0 1 2 3'].join('\n'), output: '4' },
	{ input: ['7 3', '2 3 2'].join('\n'), output: '3' },
	{ input: ['7 8', '6 6 6 1 1 0 0 2'].join('\n'), output: '2 6' },
	{ input: ['4 3', '1 2 1'].join('\n'), output: '2' }
];

const xorLampGridProblem: CodeProblem = {
	slug: 'xor-lamp-grid',
	title: 'Lamp Toggler',
	difficulty: 'intro',
	topics: ['Bitwise Operations', 'Simulation'],
	description: [
		'You control `count` lamps labelled 0…count-1. Every lamp starts OFF. Given a list of toggle events, flip the matching lamp.',
		'',
		'After processing the log, print the lamp indexes that remain ON in ascending order separated by spaces. If no lamps are lit, print `NONE`.'
	].join('\n'),
	inputFormat: [
		'- Line 1: two integers count and t (number of lamps, number of toggle events).',
		'- Line 2 (only if t > 0): t space-separated integers for the lamp indexes to toggle.'
	].join('\n'),
	constraints: [
		'1 ≤ count ≤ 200_000',
		'0 ≤ t ≤ 400_000',
		'0 ≤ lamp index < count'
	],
	examples: xorLampExamples,
	tests: xorLampTests,
	hints: [
		'Use a set to keep track of lamps toggled an odd number of times.',
		'On each toggle, remove the lamp if it is already in the set; otherwise add it.',
		'Sort the set at the end before printing. Output `NONE` when the set is empty.'
	],
	solution: {
		language: 'python',
		code: [
			'import sys',
			'',
			'data = sys.stdin.read().strip().split()',
			'if not data:',
			'    sys.exit(0)',
			'it = iter(data)',
			'count = int(next(it))',
			'toggle_count = int(next(it))',
			'toggles = [int(next(it)) for _ in range(toggle_count)]',
			'',
			'on = set()',
			'for lamp in toggles:',
			'    if lamp in on:',
			'        on.remove(lamp)',
			'    else:',
			'        on.add(lamp)',
			'',
			'if not on:',
			'    print("NONE")',
			'else:',
			'    print(" ".join(str(index) for index in sorted(on)))'
		].join('\n')
	},
	metadataVersion: 2
};


const nimExamples = [
	{
		title: "Example 1",
		input: ['3', '1 4 5'].join('\n'),
		output: 'Second',
		explanation: '1 XOR 4 XOR 5 = 0, so the starting player is already losing.'
	},
	{
		title: "Example 2",
		input: ['3', '3 4 5'].join('\n'),
		output: 'First',
		explanation: '3 XOR 4 XOR 5 = 2 ≠ 0, so the starter can force a win.'
	},
	{
		title: "Example 3",
		input: ['0'].join('\n'),
		output: 'Second',
		explanation: 'No piles means the first player has no move and loses.'
	}
];

const nimTests = [
	{ input: nimExamples[0].input, output: nimExamples[0].output, explanation: nimExamples[0].explanation },
	{ input: nimExamples[1].input, output: nimExamples[1].output, explanation: nimExamples[1].explanation },
	{ input: nimExamples[2].input, output: nimExamples[2].output, explanation: nimExamples[2].explanation },
	{ input: ['1', '7'].join('\n'), output: 'First' },
	{ input: ['4', '0 0 0 0'].join('\n'), output: 'Second' },
	{ input: ['5', '1 1 1 1 1'].join('\n'), output: 'First' },
	{ input: ['3', '10 10 10'].join('\n'), output: 'First' },
	{ input: ['6', '2 4 6 8 10 12'].join('\n'), output: 'First' },
	{ input: ['6', '1 2 3 4 5 6'].join('\n'), output: 'First' },
	{ input: ['7', '7 7 7 7 7 7 7'].join('\n'), output: 'First' },
	{ input: ['2', '0 0'].join('\n'), output: 'Second' },
	{ input: ['5', '1024 512 256 128 64'].join('\n'), output: 'First' }
];

const nimBalanceProblem: CodeProblem = {
	slug: 'nim-balance',
	title: 'Nim Balance',
	difficulty: 'intro',
	topics: ['Game Theory', 'Bitwise Operations'],
	description: [
		'Nim position evaluation: read the pile heights, compute their xor (nim-sum), and decide who wins under optimal play.',
		'',
		'Print "First" if the starter wins, otherwise print "Second".'
	].join('\n'),
	inputFormat: [
		'- Line 1: integer n — the number of piles.',
		'- Line 2 (only if n > 0): n space-separated integers for the pile heights.'
	].join('\n'),
	constraints: [
		'0 ≤ n ≤ 100_000',
		'0 ≤ pile height ≤ 1_000_000_000'
	],
	examples: nimExamples,
	tests: nimTests,
	hints: [
		'Fold the pile heights with XOR (the nim-sum).',
		'If the nim-sum is zero, the current player loses with perfect play.',
		'Otherwise the first player can always move to a zero nim-sum position.'
	],
	solution: {
		language: 'python',
		code: [
			'import sys',
			'',
			'data = sys.stdin.read().strip().split()',
			'if not data:',
			'    print("Second")',
			'    sys.exit(0)',
			'it = iter(data)',
			'count = int(next(it))',
			'piles = [int(next(it)) for _ in range(count)]',
			'',
			'nim_sum = 0',
			'for height in piles:',
			'    nim_sum ^= height',
			'',
			'print("First" if nim_sum else "Second")'
		].join('\n')
	},
	metadataVersion: 2
};


const digitalRootExamples = [
	{
		title: "Example 1",
		input: '493',
		output: '7',
		explanation: '4 + 9 + 3 = 16 and 1 + 6 = 7.'
	},
	{
		title: "Example 2",
		input: '0',
		output: '0',
		explanation: 'By definition the digital root of zero is zero.'
	},
	{
		title: "Example 3",
		input: '99999',
		output: '9',
		explanation: 'The digits sum to 45 and 4 + 5 = 9.'
	}
];

const digitalRootTests = [
	{ input: digitalRootExamples[0].input, output: digitalRootExamples[0].output, explanation: digitalRootExamples[0].explanation },
	{ input: digitalRootExamples[1].input, output: digitalRootExamples[1].output, explanation: digitalRootExamples[1].explanation },
	{ input: digitalRootExamples[2].input, output: digitalRootExamples[2].output, explanation: digitalRootExamples[2].explanation },
	{ input: '5', output: '5' },
	{ input: '987654321', output: '9' },
	{ input: '999999999999', output: '9' },
	{ input: '12345678901234567890', output: '9' },
	{ input: '10', output: '1' },
	{ input: '18', output: '9' },
	{ input: '1111111111111111111111111', output: '7' },
	{ input: '27', output: '9' },
	{ input: '58', output: '4' }
];

const digitalRootProblem: CodeProblem = {
	slug: 'digital-root-finder',
	title: 'Digital Root Finder',
	difficulty: 'intro',
	topics: ['Number Theory'],
	description: [
		'Repeatedly sum the decimal digits of a non-negative integer until a single digit remains. That digit is the digital root.',
		'',
		'Read the integer from standard input and print its digital root. If the input is 0, print 0.'
	].join('\n'),
	inputFormat: ['- Single line containing a non-negative integer n.'].join('\n'),
	constraints: [
		'0 ≤ n < 10^1000'
	],
	examples: digitalRootExamples,
	tests: digitalRootTests,
	hints: [
		'The digital root is 0 for n = 0 and 1 + ((n - 1) % 9) otherwise.',
		'Converting to an integer is fine in Python; it supports arbitrarily large numbers.',
		'You can also simulate repeated summing of digits if you prefer.'
	],
	solution: {
		language: 'python',
		code: [
			'import sys',
			'',
			'text = sys.stdin.read().strip()',
			'if not text:',
			'    sys.exit(0)',
			'n = int(text.split()[0])',
			'if n == 0:',
			'    print(0)',
			'else:',
			'    print(1 + (n - 1) % 9)'
		].join('\n')
	},
	metadataVersion: 2
};


const nineAdjusterExamples = [
	{
		title: "Example 1",
		input: '827',
		output: '1',
		explanation: '8 + 2 + 7 = 17; adding 1 reaches 18, divisible by 9.'
	},
	{
		title: "Example 2",
		input: '99',
		output: '0',
		explanation: 'Digit sum already divisible by 9, so append 0.'
	},
	{
		title: "Example 3",
		input: '4102',
		output: '2',
		explanation: '4 + 1 + 0 + 2 = 7, so adding 2 reaches 9.'
	}
];

const nineAdjusterTests = [
	{ input: nineAdjusterExamples[0].input, output: nineAdjusterExamples[0].output, explanation: nineAdjusterExamples[0].explanation },
	{ input: nineAdjusterExamples[1].input, output: nineAdjusterExamples[1].output, explanation: nineAdjusterExamples[1].explanation },
	{ input: nineAdjusterExamples[2].input, output: nineAdjusterExamples[2].output, explanation: nineAdjusterExamples[2].explanation },
	{ input: '0', output: '0' },
	{ input: '1', output: '8' },
	{ input: '123456', output: '6' },
	{ input: '9998', output: '1' },
	{ input: '1000000000', output: '8' },
	{ input: '55555', output: '2' },
	{ input: '444444444', output: '0' },
	{ input: '18', output: '0' },
	{ input: '8', output: '1' }
];

const nineAdjusterProblem: CodeProblem = {
	slug: 'nine-adjuster',
	title: 'Casting Out Nines',
	difficulty: 'intro',
	topics: ['Number Theory', 'String Processing'],
	description: [
		'Given a string of decimal digits, append the smallest digit (0–9) that makes the overall digit sum divisible by 9.',
		'',
		'Print only that digit.'
	].join('\n'),
	inputFormat: ['- Single line containing a digit string.'].join('\n'),
	constraints: ['1 ≤ |value| ≤ 100_000'],
	examples: nineAdjusterExamples,
	tests: nineAdjusterTests,
	hints: [
		'Compute the digit sum modulo 9.',
		'If the remainder is zero, the answer is 0; otherwise return 9 - remainder.',
		'Iterate characters directly instead of converting the entire number to avoid overflow concerns.'
	],
	solution: {
		language: 'python',
		code: [
			'import sys',
			'',
			'text = sys.stdin.read().strip()',
			'if not text:',
			'    sys.exit(0)',
			'value = text.split()[0]',
			'total = sum(int(ch) for ch in value) % 9',
			'if total == 0:',
			'    print(0)',
			'else:',
			'    print(9 - total)'
		].join('\n')
	},
	metadataVersion: 2
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
