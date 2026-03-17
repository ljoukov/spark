import type { PaperSheetAnswers, PaperSheetData, PaperSheetMockReview } from './types';

const hamiltonSampleAnswers: PaperSheetAnswers = {
	'H1:response': `Since the remainder is $43$, $n > 44$ and

$$
2023 - 43 = 1980
$$

is a multiple of $n$.

$$
1980 = 2^2 \\times 3^2 \\times 5 \\times 11.
$$

This means its factors greater than $43$ are [partly unclear]

$$
55, 60, 66, 90, 99, 110, 132, 165, 180, 198, 220, 330, 495, 990.
$$

So there are $14$ possible $n$'s.`,
	'H2:response': `$\\%$ is equivalent to multiplying by $\\frac{1}{100}$.

$$
a\\%\\text{ of }b\\%\\text{ of }a
=
\\frac{a}{100}\\times\\frac{b}{100}\\times a
=
\\frac{a^2b}{10^4}
$$

and

$$
b\\%\\text{ of }a\\%\\text{ of }b
=
\\frac{b}{100}\\times\\frac{a}{100}\\times b
=
\\frac{ab^2}{10^4}.
$$

Since they differ by

$$
0.003 = \\frac{3}{10^3} = \\frac{30}{10^4},
$$

and since $a > b$,

$$
\\frac{a^2b}{10^4} > \\frac{ab^2}{10^4}
$$

so

$$
a^2b - ab^2 = 30
$$

and hence

$$
ab(a - b) = 30.
$$

Since $a$ and $b$ are integers, $ab > a - b$, and so

$$
(ab, a - b) = (30, 1), (15, 2), (10, 3), (6, 5).
$$

Case 1:

$$
ab = 30,\\ a - b = 1 \\Rightarrow a = 6,\\ b = 5.
$$

Case 2:

$$
ab = 15,\\ a - b = 2 \\Rightarrow a = 5,\\ b = 3.
$$

Case 3:

$$
ab = 10,\\ a - b = 3 \\Rightarrow a = 5,\\ b = 2.
$$

Case 4:

$$
ab = 6,\\ a - b = 5 \\Rightarrow a = 6,\\ b = 1.
$$

So

$$
(a, b) = (6, 5), (5, 3), (5, 2), (6, 1).
$$`,
	'H3:response': `Thus for this to be true:

$$
1 \\le \\frac{1}{\\sqrt{n}} < 2
$$

or

$$
0.1 \\le \\frac{1}{\\sqrt{n}} < 0.2
$$

or

$$
0.01 \\le \\frac{1}{\\sqrt{n}} < 0.02
$$

or [continuation to the next place value].

Then [faint / partial interval work]

$$
0.01 \\le \\frac{1}{\\sqrt{n}} < 0.02
$$

and [unclear continuation].

[No final count is visible on the photographed page.]`,
	'H4:response': `Now since $ABCD$ is a parallelogram,

$$
AD \\parallel CB,\\qquad CD \\parallel AB.
$$

This means that

$$
\\angle QDP = \\angle ABP
$$

and

$$
\\angle QPD = \\angle BAP,
$$

so

$$
\\triangle DPQ \\sim \\triangle BAP
$$

and

$$
\\frac{PD}{PB} = \\frac{PQ}{AP}.
$$

Since $BR \\parallel AQ$ [equivalently, using the same transversal / parallel structure],

$$
\\triangle DBR \\sim \\triangle ADP
$$

and

$$
\\frac{PD}{PB} = \\frac{AP}{PR}.
$$

Therefore

$$
\\left(\\frac{PD}{PB}\\right)\\left(\\frac{PD}{PB}\\right)
=
\\left(\\frac{PQ}{AP}\\right)\\left(\\frac{AP}{PR}\\right)
$$

so

$$
\\left(\\frac{PD}{PB}\\right)^2 = \\frac{PQ}{PR}.
$$`,
	'H5:response': `Now subtracting $2$ integers from each other and replacing by the difference doesn't change parity.

For final sum to be $0$, sum must be even.

Now the largest $2$ numbers are consecutive and will be replaced by $1$.

If $n$ is a multiple of $4$, all larger numbers will have been replaced by [pairs of] $1$'s and then $0$'s [unclear wording], so final sum is $0$.

If $n$ is $1$ more than a multiple of $4$, [unclear continuation].

If $n$ is $3$ more than a multiple of $4$, [unclear continuation; the photographed argument appears to continue but is not fully legible].`,
	'H6:response': `Rearrange this equation, we get

$$
p^n = (m + 60)(m - 60).
$$

Now since $p$ is prime, $p^n$ is prime [power], and

$$
p^a - p^b = 120.
$$

This must be divisible by $p$.

Now

$$
120 = p^a - p^b
$$

must be divisible by $p$.

So

$$
p = 2, 3, 5.
$$

Now if $p = 2$, for

$$
p^a - p^b = 120
$$

$$
p^b(p^{a - b} - 1) = 120
$$

so $p^b < 120$ and $p^a > 120$.

For $p = 2$,

$$
p^b = 2, 4, 8, 16, 32, 64, 128
$$

[continuation].

We have

$$
p^a = 128,\\ p^b = 8.
$$

$$
m + 60 = 128 \\text{ and } m - 60 = 8
$$

so

$$
m = 68.
$$

This gives

$$
(m, n, p) = (68, 10, 2).
$$

If $p = 3$, again $p^a > 120$ as then if $p^a - p^b \\ge 2 \\times 120$, no solution.

$$
p = 3, 9, 27, 81,
$$

as $243 - 81 = 162 > 120$.

Thus there is no solution.

If $p = 5$, obviously only $5$, $25$ and $125$.

$$
m + 60 = 125,\\quad m - 60 = 5
$$

$$
m = 65
$$

This gives

$$
(m, n, p) = (65, 4, 5).
$$

So

$$
(m, n, p) = (68, 10, 2) \\text{ or } (65, 4, 5).
$$`
};

const hamiltonSampleReview: PaperSheetMockReview = {
	score: {
		got: 42,
		total: 60
	},
	objectiveQuestionCount: 0,
	teacherReviewMarks: 60,
	teacherReviewQuestionCount: 6,
	label: 'Sample grading summary',
	message: 'Hamilton 2023 combined grading file transcribed into the sheet preview.',
	note: 'Use Show Mock Review to reveal problem-level notes seeded from the original review comments.',
	questions: {
		'H1:response': {
			status: 'incorrect',
			label: '5 / 10',
			statusLabel: 'graded',
			note: `The key observation is correct: **$2023 - 43 = 1980$** must be divisible by **$n$**. The issue is the count. The condition should be **$n > 43$**, so **$44$** is valid, and several larger factors are still missing from the list.`,
			followUp:
				'Recount the factors of $1980$ that are greater than $43$. Check $44$, $45$, $396$, $660$, and $1980$ before you settle on the total.'
		},
		'H2:response': {
			status: 'correct',
			label: '9 / 10',
			statusLabel: 'graded',
			note: 'This is essentially complete. You convert both percentage expressions correctly, reach **$ab(a - b) = 30$**, and recover the right four solution pairs. The only missing piece is making the discarded negative roots explicit in each case.',
			followUp:
				'If you polish this for full marks, state briefly why the second quadratic root is rejected in each case.'
		},
		'H3:response': {
			status: 'incorrect',
			label: '4 / 10',
			statusLabel: 'graded',
			note: 'The starting idea is right: the first non-zero digit is **$1$** exactly when **$\\frac{1}{\\sqrt{n}}$** falls into intervals like **$[1, 2)$**, **$[0.1, 0.2)$**, and so on. The photographed work stops before those intervals are converted into full ranges for **$n$** and counted.',
			followUp:
				'Push the inequalities through to ranges of $n$, then count the integers in each range before you add the totals.'
		},
		'H4:response': {
			status: 'correct',
			label: '10 / 10',
			statusLabel: 'graded',
			note: 'Complete proof. You identify one similar-triangle pair to get **$\\frac{PD}{PB} = \\frac{PQ}{AP}$**, a second pair to get **$\\frac{PD}{PB} = \\frac{AP}{PR}$**, and then multiply the results to reach the required identity.',
			followUp:
				'This is already full-credit level. If you wanted to tighten it further, you could name the matching angles a little more explicitly.'
		},
		'H5:response': {
			status: 'incorrect',
			label: '6 / 10',
			statusLabel: 'graded',
			note: 'Two strong ideas are present: parity is preserved, and the largest consecutive numbers repeatedly collapse to **$1$**. The missing part is the hard odd-case analysis, so the final set of valid **$n$** values is not fully established from the visible work.',
			followUp:
				'Keep the parity argument, then separate the cases by $n \\bmod 4$ and finish the odd-case threshold carefully.'
		},
		'H6:response': {
			status: 'incorrect',
			label: '8 / 10',
			statusLabel: 'graded',
			note: 'The factorisation **$p^n = (m + 60)(m - 60)$** is correct, and the casework for **$p = 2, 3, 5$** is mostly good. The gap is the special case **$m - 60 = 1$**, which produces the extra solution **$(61, 2, 11)$**.',
			followUp:
				'Before dividing into the $p = 2, 3, 5$ cases, isolate the edge case where $m - 60$ equals $1$ and see what it forces.'
		}
	}
};

export const samplePaperSheets = [
	{
		id: 'hamilton-2023',
		subject: 'Mathematics',
		level: 'Olympiad',
		title: 'Hamilton 2023',
		subtitle: 'Andrew Hamilton · sample student submission',
		color: '#214A3A',
		accent: '#2E7D61',
		light: '#F2F8F5',
		border: '#BCD8CB',
		initialAnswers: hamiltonSampleAnswers,
		mockReview: hamiltonSampleReview,
		sections: [
			{
				type: 'hook',
				text: "Sample worksheet seeded from the Hamilton 2023 combined grading file. Each section shows the original problem statement with Andrew Hamilton's transcribed notebook submission prefilled, including `[unclear]` markers where the source image was faint."
			},
			{
				id: 'H1',
				label: 'Remainders and divisors',
				theory:
					'Susie thinks of a positive integer $n$. She notices that, when she divides $2023$ by $n$, she is left with a remainder of $43$. Find how many possible values of $n$ there are.',
				questions: [
					{
						id: 'response',
						type: 'lines',
						marks: 10,
						prompt: '**Student solution transcript**',
						lines: 11,
						renderMode: 'markdown'
					}
				]
			},
			{
				id: 'H2',
				label: 'Percent expressions',
				theory:
					'The two positive integers $a, b$ with $a > b$ are such that $a\\%$ of $b\\%$ of $a$ and $b\\%$ of $a\\%$ of $b$ differ by $0.003$. Find all possible pairs $(a, b)$.',
				questions: [
					{
						id: 'response',
						type: 'lines',
						marks: 10,
						prompt: '**Student solution transcript**',
						lines: 26,
						renderMode: 'markdown'
					}
				]
			},
			{
				id: 'H3',
				label: 'First non-zero digit',
				theory:
					'The $n$th term of a sequence is the first non-zero digit of the decimal expansion of $\\frac{1}{\\sqrt{n}}$. How many of the first one million terms of the sequence are equal to $1$?',
				questions: [
					{
						id: 'response',
						type: 'lines',
						marks: 10,
						prompt: '**Student solution transcript**',
						lines: 12,
						renderMode: 'markdown'
					}
				]
			},
			{
				id: 'H4',
				label: 'Parallelogram proof',
				theory:
					'In the parallelogram $ABCD$, a line through $A$ meets $BD$ at $P$, $CD$ at $Q$ and $BC$ extended at $R$. Prove that $\\frac{PQ}{PR} = \\left(\\frac{PD}{PB}\\right)^2$.',
				questions: [
					{
						id: 'response',
						type: 'lines',
						marks: 10,
						prompt: '**Student solution transcript**',
						lines: 20,
						renderMode: 'markdown'
					}
				]
			},
			{
				id: 'H5',
				label: 'Repeated differences',
				theory:
					'Mickey writes down on a board $n$ consecutive whole numbers, the smallest of which is $2023$. He repeatedly replaces the largest two numbers with their difference until only one number remains. For which values of $n$ is the last remaining number $0$?',
				questions: [
					{
						id: 'response',
						type: 'lines',
						marks: 10,
						prompt: '**Student solution transcript**',
						lines: 14,
						renderMode: 'markdown'
					}
				]
			},
			{
				id: 'H6',
				label: 'Prime powers and squares',
				theory:
					'Find all triples $(m, n, p)$ which satisfy $p^n + 3600 = m^2$, where $p$ is prime and $m, n$ are positive integers.',
				questions: [
					{
						id: 'response',
						type: 'lines',
						marks: 10,
						prompt: '**Student solution transcript**',
						lines: 32,
						renderMode: 'markdown'
					}
				]
			}
		]
	},
	{
		id: 'roman',
		subject: 'History',
		level: 'KS2',
		title: 'The Roman Empire',
		subtitle: 'Year 4 · History',
		color: '#8B2500',
		accent: '#D4622A',
		light: '#FDF6F0',
		border: '#E8C9A0',
		sections: [
			{
				type: 'hook',
				text: 'Over 2,000 years ago, one of the greatest empires the world has ever seen stretched across three continents. The Romans built mighty armies, beautiful cities, and roads that still exist today. But how did they end up in Britain — and what did they leave behind?'
			},
			{
				id: 'A',
				label: 'Know Your Romans',
				theory:
					'The Roman Empire was ruled from the city of Rome in Italy. At its peak, it covered parts of Europe, North Africa, and western Asia. The Romans first tried to invade Britain in **55 BC** under Julius Caesar, but the full conquest came in **43 AD** under Emperor Claudius. Roman soldiers were called **legionaries** and were among the best-trained soldiers in the ancient world.',
				questions: [
					{
						id: 'A1',
						type: 'fill',
						marks: 1,
						prompt: 'The Romans first attempted to invade Britain in',
						blanks: [{}],
						after: 'under Julius Caesar.'
					},
					{
						id: 'A2',
						type: 'fill',
						marks: 1,
						prompt: 'The successful Roman conquest of Britain happened in',
						blanks: [{}],
						after: 'under Emperor Claudius.'
					},
					{
						id: 'A3',
						type: 'mcq',
						marks: 1,
						prompt: 'What were Roman soldiers called?',
						options: ['Gladiators', 'Centurions', 'Legionaries', 'Senators']
					},
					{
						id: 'A4',
						type: 'mcq',
						marks: 1,
						prompt: 'From which city was the Roman Empire ruled?',
						options: ['Athens', 'Rome', 'Carthage', 'London']
					}
				]
			},
			{
				id: 'B',
				label: "Hadrian's Wall",
				theory:
					'In **122 AD**, Emperor Hadrian visited Britain and ordered a massive wall to be built across the north of England. It stretched **73 miles** (117 km) from coast to coast. The wall marked the northern frontier of the Roman Empire and kept out tribes from modern-day Scotland, called the **Picts**. Soldiers lived in forts along the wall and watched for attacks.',
				infoBox: {
					icon: '🧱',
					title: 'Fast Fact',
					text: 'Hadrian’s Wall took about 6 years to build and required thousands of soldiers and workers. Parts of it still stand today!'
				},
				questions: [
					{
						id: 'B1',
						type: 'fill',
						marks: 1,
						prompt: "Hadrian's Wall was built in",
						blanks: [{}],
						after: '.'
					},
					{
						id: 'B2',
						type: 'fill',
						marks: 1,
						prompt: 'The wall stretched',
						blanks: [{}],
						after: 'from coast to coast.'
					},
					{
						id: 'B3',
						type: 'mcq',
						marks: 1,
						prompt: 'Which group of people did the wall keep out?',
						options: ['Vikings', 'Picts', 'Saxons', 'Normans']
					},
					{
						id: 'B4',
						type: 'lines',
						marks: 2,
						prompt:
							'Explain why you think the Romans built Hadrian’s Wall rather than continuing to conquer further north. Give at least one reason.',
						lines: 3
					}
				]
			},
			{
				id: 'C',
				label: 'Roman Life in Britain',
				theory:
					'The Romans changed Britain dramatically. They built straight **roads** to move armies quickly — many modern roads follow the same routes. They built **bathhouses** where people washed and socialised. Wealthy Romans lived in large country houses called **villas**, with mosaic floors and underfloor heating called a **hypocaust**. They introduced new foods like apples, pears, and even cats!',
				questions: [
					{
						id: 'C1',
						type: 'match',
						marks: 2,
						prompt: 'Match each Roman word to its correct meaning.',
						pairs: [
							{ term: 'Villa', match: 'A large Roman country house' },
							{ term: 'Hypocaust', match: 'Underfloor heating system' },
							{ term: 'Mosaic', match: 'A picture made from small tiles' },
							{ term: 'Legion', match: 'A unit of Roman soldiers' }
						]
					},
					{
						id: 'C2',
						type: 'mcq',
						marks: 1,
						prompt: 'Why did the Romans build straight roads?',
						options: [
							'They looked more beautiful',
							'To move armies quickly and efficiently',
							"Because they didn't know how to curve them",
							'To impress local tribes'
						]
					},
					{
						id: 'C3',
						type: 'lines',
						marks: 3,
						prompt:
							'Describe THREE ways the Romans changed life in Britain. Use evidence from the theory above.',
						lines: 5
					}
				]
			},
			{
				id: 'D',
				label: 'The End of Roman Britain',
				theory:
					'By **410 AD**, the Roman Empire was struggling. Tribes called the Visigoths attacked Rome itself, and the Emperor told the people of Britain they would have to defend themselves. After nearly **400 years**, Roman rule in Britain came to an end. The Romans left, but their language, buildings, and ideas stayed behind — shaping Britain forever.',
				questions: [
					{
						id: 'D1',
						type: 'fill',
						marks: 1,
						prompt: 'Roman rule in Britain ended in',
						blanks: [{}],
						after: '.'
					},
					{
						id: 'D2',
						type: 'fill',
						marks: 1,
						prompt: 'The Romans ruled Britain for nearly',
						blanks: [{}],
						after: 'years.'
					},
					{
						id: 'D3',
						type: 'mcq',
						marks: 1,
						prompt: "Which group attacked Rome and contributed to the empire's collapse?",
						options: ['Vikings', 'Normans', 'Visigoths', 'Picts']
					},
					{
						id: 'D4',
						type: 'lines',
						marks: 3,
						prompt:
							'Do you think the Roman invasion of Britain was good or bad for the people living here? Use what you have learned to explain your answer.',
						lines: 5
					}
				]
			}
		]
	},
	{
		id: 'iron',
		subject: 'Science',
		level: 'KS3',
		title: 'Iron — A Common Metal',
		subtitle: 'Year 7 · Chemistry',
		color: '#1A3A5C',
		accent: '#2E6DA4',
		light: '#F0F4F9',
		border: '#B0C8E4',
		sections: [
			{
				type: 'hook',
				text: 'Iron is one of the most important metals on Earth. It is used to build skyscrapers, make everyday tools, and is even found inside your own blood. But iron has a problem — it rusts. In this sheet we explore the properties, uses, and chemistry of iron.'
			},
			{
				id: 'A',
				label: 'Properties & Uses',
				theory:
					'Iron is a **strong, hard** metal with a high melting point. It is **magnetic**, meaning it is attracted to magnets. Iron has a density of **7.88 g/cm³**, which means it is much denser than water. These properties make iron ideal for making nails, girders, and machinery. Pure iron is actually quite soft — it is usually combined with carbon to make **steel**, which is much stronger.',
				questions: [
					{
						id: 'A1',
						type: 'fill',
						marks: 1,
						prompt: 'Iron has a density of',
						blanks: [{}],
						after: 'g/cm³.'
					},
					{
						id: 'A2',
						type: 'mcq',
						marks: 1,
						prompt: 'Which property makes iron useful for making nails?',
						options: [
							'It is transparent',
							'It is strong and hard',
							'It is very light',
							'It dissolves in water'
						]
					},
					{
						id: 'A3',
						type: 'calc',
						marks: 1,
						prompt:
							'Iron has a density of 7.88 g/cm³. Calculate the mass of an iron nail with a volume of 2 cm³.',
						hint: 'Mass = Density × Volume',
						inputLabel: 'Mass =',
						unit: 'g'
					},
					{
						id: 'A4',
						type: 'mcq',
						marks: 1,
						prompt: 'What is iron combined with to make steel?',
						options: ['Copper', 'Aluminium', 'Carbon', 'Zinc']
					}
				]
			},
			{
				id: 'B',
				label: 'Rusting',
				theory:
					'Rusting is a chemical reaction where iron reacts with **oxygen** and **water** to form iron oxide (rust). The word equation is:\n\niron + oxygen + water → hydrated iron(III) oxide\n\nRusting can be prevented by: coating iron in **zinc** (galvanising), painting it, or using **stainless steel** (iron + chromium). Zinc is used because it is more reactive than iron, so it reacts first and is sacrificed instead of the iron.',
				infoBox: {
					icon: '⚗️',
					title: 'Key Equation',
					text: 'iron + oxygen + water → hydrated iron(III) oxide (rust)'
				},
				questions: [
					{
						id: 'B1',
						type: 'fill',
						marks: 1,
						prompt: 'For iron to rust, it must be in contact with both',
						blanks: [{}, {}],
						after: '.',
						conjunction: 'and'
					},
					{
						id: 'B2',
						type: 'mcq',
						marks: 1,
						prompt: 'What is the chemical name for rust?',
						options: ['Iron carbonate', 'Hydrated iron(III) oxide', 'Iron chloride', 'Iron sulfate']
					},
					{
						id: 'B3',
						type: 'lines',
						marks: 2,
						prompt:
							"Explain why coating iron with zinc prevents rusting. Include the word 'reactive' in your answer.",
						lines: 3
					},
					{
						id: 'B4',
						type: 'lines',
						marks: 2,
						prompt: 'Describe and explain one other method of preventing iron from rusting.',
						lines: 3
					}
				]
			}
		]
	},
	{
		id: 'english',
		subject: 'English',
		level: 'KS2',
		title: 'Grammar & Vocabulary',
		subtitle: 'Year 5 · English Skills',
		color: '#3D1A6E',
		accent: '#6B3FA0',
		light: '#F7F3FD',
		border: '#C9B0E8',
		sections: [
			{
				type: 'hook',
				text: 'Strong writers understand how language works. In this sheet you will practise grammar, expand your vocabulary, and write carefully crafted sentences. Every question helps build your skills as a reader and writer.'
			},
			{
				id: 'A',
				label: 'Warm-up: Word Forms',
				theory:
					"Many English words change form depending on how they are used in a sentence. A **noun** names a thing or idea. A **verb** shows action or being. An **adjective** describes a noun. Understanding root words helps you spell and understand new words — for example, **'determine'** is the root of 'determined' and 'determination'.",
				questions: [
					{
						id: 'A1',
						type: 'fill',
						marks: 1,
						prompt: 'Write the root word of: carriage →',
						blanks: [{}],
						after: ''
					},
					{
						id: 'A2',
						type: 'fill',
						marks: 1,
						prompt: 'Write the root word of: barrier →',
						blanks: [{}],
						after: ''
					},
					{
						id: 'A3',
						type: 'mcq',
						marks: 1,
						prompt: "Which word is the correct noun form of 'determined'?",
						options: ['Determine', 'Determinedly', 'Determination', 'Determining']
					},
					{
						id: 'A4',
						type: 'spelling',
						marks: 2,
						prompt: 'Correct the spelling of these words.',
						words: [{ wrong: 'threatning' }, { wrong: 'deafning' }]
					}
				]
			},
			{
				id: 'B',
				label: 'Word Work: Definitions',
				theory:
					"When you encounter an unfamiliar word, try to use the **context** (the words around it) to work out its meaning. Prefixes and suffixes also give clues: **'micro-'** means small, **'extra-'** means beyond or more than usual, **'inter-'** means between.",
				questions: [
					{
						id: 'B1',
						type: 'lines',
						marks: 1,
						prompt:
							"Write the meaning of 'intervened' as used in: *I intervened to stop them fighting.*",
						lines: 2
					},
					{
						id: 'B2',
						type: 'lines',
						marks: 1,
						prompt: "Write the meaning of 'extraordinary' as used in: *It was extraordinary.*",
						lines: 2
					},
					{
						id: 'B3',
						type: 'mcq',
						marks: 1,
						prompt: "What does the prefix 'micro-' mean?",
						options: ['Large', 'Small', 'Between', 'Around']
					},
					{
						id: 'B4',
						type: 'fill',
						marks: 1,
						prompt: 'Complete with the correct suffix (-ic, -al, -ive, -ous): hero →',
						blanks: [{}],
						after: ''
					}
				]
			},
			{
				id: 'C',
				label: 'Sentence Work',
				theory:
					'A **conjunction** joins two clauses. **Subordinating conjunctions** (although, once, unless, because, when) introduce a subordinate clause — a part of a sentence that cannot stand alone. When you move the subordinate clause to the START of a sentence, you must add a **comma** after it.',
				infoBox: {
					icon: '✏️',
					title: 'Example',
					text: "'Although the water was not deep, the tide was strong.' — Notice the comma after the subordinate clause."
				},
				questions: [
					{
						id: 'C1',
						type: 'lines',
						marks: 1,
						prompt:
							'Rewrite starting with the conjunction: The tide was strong although the water was not deep.',
						lines: 2
					},
					{
						id: 'C2',
						type: 'lines',
						marks: 1,
						prompt:
							'Rewrite starting with the conjunction: The jaws of the plant clamp shut once an insect lands.',
						lines: 2
					},
					{
						id: 'C3',
						type: 'lines',
						marks: 1,
						prompt:
							'Rewrite starting with the conjunction: All will be lost unless help arrives soon.',
						lines: 2
					},
					{
						id: 'C4',
						type: 'lines',
						marks: 2,
						prompt:
							"Add words and phrases to 'programme' to write the longest noun phrase you can.",
						lines: 2
					}
				]
			}
		]
	}
] satisfies PaperSheetData[];
