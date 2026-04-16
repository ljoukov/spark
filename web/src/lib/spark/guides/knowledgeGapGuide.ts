export type GuideVariantId =
	| 'v1'
	| 'v2'
	| 'v3'
	| 'v4'
	| 'v5'
	| 'v6'
	| 'v7'
	| 'v8'
	| 'v9'
	| 'v10'
	| 'v11'
	| 'v12'
	| 'v13'
	| 'v14'
	| 'v15'
	| 'v16'
	| 'v17';

export type GuideVariant = {
	id: GuideVariantId;
	name: string;
	shortName: string;
	description: string;
	format: string;
};

export type GuideStep = {
	id: string;
	shortLabel: string;
	question: string;
	answer: string;
	prompt: string;
	correctOptionId: string;
	options: readonly {
		id: string;
		label: string;
	}[];
	clause: string;
};

export type GapBlank = {
	id: string;
	before: string;
	after: string;
	answer: string;
};

export type GapWord = {
	id: string;
	label: string;
};

export const ORIGINAL_QUESTION = 'Explain why veins have valves but arteries do not.';

export const SHORT_QUESTION = 'Why do veins have valves but arteries do not?';

export const FINAL_ANSWER =
	'Veins need valves because their blood must return to the heart, often against gravity, so valves stop backflow. Arteries do not need them because blood is already driven forward by high pressure from the heart.';

export const GUIDE_VARIANTS: readonly GuideVariant[] = [
	{
		id: 'v1',
		name: 'Guided Ladder',
		shortName: 'Ladder',
		description:
			'A clean worksheet route where each small answer becomes the next line of evidence.',
		format: 'short answer'
	},
	{
		id: 'v2',
		name: 'Evidence Slips',
		shortName: 'Slips',
		description:
			'Students choose quick answers and pin corrected slips around the target question.',
		format: 'multiple choice'
	},
	{
		id: 'v3',
		name: 'Tutor Transcript',
		shortName: 'Transcript',
		description:
			'A calm conversation-style sheet that records the student reply and the corrected takeaway.',
		format: 'guided reply'
	},
	{
		id: 'v4',
		name: 'Answer Builder',
		shortName: 'Builder',
		description:
			'Small prompts unlock sentence parts before the student writes the full explanation.',
		format: 'sentence parts'
	},
	{
		id: 'v5',
		name: 'Fill Sheet',
		shortName: 'Fill Sheet',
		description: 'A native worksheet paragraph where word-bank choices complete the explanation.',
		format: 'fill gaps'
	},
	{
		id: 'v6',
		name: 'Stamp The Gaps',
		shortName: 'Stamps',
		description:
			'A more tactile fill-in version where students stamp word-bank labels into a lab report.',
		format: 'fill gaps'
	},
	{
		id: 'v7',
		name: 'Against Gravity',
		shortName: 'Gravity',
		description:
			'A vertical climb from legs to heart where each checkpoint builds the answer upward.',
		format: 'journey'
	},
	{
		id: 'v8',
		name: 'Backflow Lab',
		shortName: 'Lab',
		description:
			'A comparison board where resolving stress points shows why veins need one-way valves.',
		format: 'simulation'
	},
	{
		id: 'v9',
		name: 'Imported Scroll Reveal',
		shortName: 'Import A',
		description:
			'Imported from the filler design file: a vertical reveal path that exposes each key idea.',
		format: 'imported'
	},
	{
		id: 'v10',
		name: 'Imported Revelation',
		shortName: 'Import B',
		description:
			'Imported from the second design file: a masked final answer unlocks one clause at a time.',
		format: 'imported'
	},
	{
		id: 'v11',
		name: 'Sheet Inline Answers',
		shortName: 'Sheet Inline',
		description:
			'A worksheet-style short-answer version where students type each missing word inline and submit once.',
		format: 'typed blanks'
	},
	{
		id: 'v12',
		name: 'Prompted Inline Blanks',
		shortName: 'Prompted Blanks',
		description:
			'A wider worksheet-style version where each blank uses a stepping-stone question as its placeholder.',
		format: 'typed blanks'
	},
	{
		id: 'v13',
		name: 'Minimal Gap Fill',
		shortName: 'Minimal Fill',
		description:
			'A stripped worksheet version with only the gap-fill sentences, inline answers, and submit action.',
		format: 'typed blanks'
	},
	{
		id: 'v14',
		name: 'Prompted Minimal Sheet',
		shortName: 'Prompted Sheet',
		description:
			'A sheet-styled minimal gap-fill version with prompt placeholders, enter-to-advance, and live judged feedback.',
		format: 'AI judged blanks'
	},
	{
		id: 'v15',
		name: 'Reading Study Note',
		shortName: 'Study Note',
		description:
			'A static reading sheet that groups key knowledge, outline, key sentences, and final answer.',
		format: 'read only'
	},
	{
		id: 'v16',
		name: 'Reading Answer Spine',
		shortName: 'Answer Spine',
		description:
			'A static visual chain that reduces the answer to low pressure, backflow risk, and valve function.',
		format: 'read only'
	},
	{
		id: 'v17',
		name: 'Reading Exam Card',
		shortName: 'Exam Card',
		description:
			'A compact revision card that surfaces the final GCSE wording beside supporting knowledge.',
		format: 'read only'
	}
];

export const GUIDE_STEPS: readonly GuideStep[] = [
	{
		id: 'vein-job',
		shortLabel: 'Vein job',
		question: 'What is the job of veins?',
		answer: 'Return blood to the heart',
		prompt: 'Start with the function of a vein.',
		correctOptionId: 'return-heart',
		options: [
			{ id: 'return-heart', label: 'Return blood to the heart' },
			{ id: 'push-away', label: 'Push blood away from the heart' },
			{ id: 'swap-air', label: 'Swap oxygen with air' }
		],
		clause: 'blood must return to the heart'
	},
	{
		id: 'leg-direction',
		shortLabel: 'Leg direction',
		question: 'For blood in the legs, which direction must it travel to reach the heart?',
		answer: 'Upward',
		prompt: 'Picture blood leaving the feet and going back to the chest.',
		correctOptionId: 'upward',
		options: [
			{ id: 'downward', label: 'Downward' },
			{ id: 'upward', label: 'Upward' },
			{ id: 'sideways', label: 'Sideways' }
		],
		clause: 'blood in the legs often has to travel upward'
	},
	{
		id: 'gravity',
		shortLabel: 'Gravity',
		question: 'What natural force makes upward movement difficult?',
		answer: 'Gravity',
		prompt: 'Name the force pulling things downward.',
		correctOptionId: 'gravity',
		options: [
			{ id: 'gravity', label: 'Gravity' },
			{ id: 'friction', label: 'Friction from skin' },
			{ id: 'sunlight', label: 'Sunlight' }
		],
		clause: 'gravity makes that upward movement harder'
	},
	{
		id: 'backflow',
		shortLabel: 'Backflow risk',
		question: 'If blood starts slipping downward, what problem happens?',
		answer: 'It flows backward',
		prompt: 'Say what happens to the direction of the blood.',
		correctOptionId: 'flows-backward',
		options: [
			{ id: 'flows-backward', label: 'It flows backward' },
			{ id: 'turns-bright', label: 'It turns bright red' },
			{ id: 'disappears', label: 'It disappears' }
		],
		clause: 'slipping downward would mean backflow'
	},
	{
		id: 'valves',
		shortLabel: 'Valve role',
		question: 'What structure prevents backward flow?',
		answer: 'Valves',
		prompt: 'Name the one-way structure in veins.',
		correctOptionId: 'valves',
		options: [
			{ id: 'ribs', label: 'Ribs' },
			{ id: 'platelets', label: 'Platelets' },
			{ id: 'valves', label: 'Valves' }
		],
		clause: 'valves stop blood flowing backward'
	},
	{
		id: 'arteries',
		shortLabel: 'Artery pressure',
		question:
			'Do arteries face the same blood slipping backward problem if blood is already moving under high pressure from the heart?',
		answer: 'No',
		prompt: 'Compare artery pressure with vein pressure.',
		correctOptionId: 'no',
		options: [
			{ id: 'yes', label: 'Yes' },
			{ id: 'no', label: 'No' },
			{ id: 'only-night', label: 'Only at night' }
		],
		clause: 'arteries are already driven forward by high pressure from the heart'
	}
];

export const GAP_BLANKS: readonly GapBlank[] = [
	{
		id: 'heart-1',
		before: 'Veins carry blood back to the',
		after: '.',
		answer: 'heart'
	},
	{
		id: 'low',
		before: 'The pressure in veins is',
		after: '.',
		answer: 'low'
	},
	{
		id: 'backwards-1',
		before: 'This means blood could flow',
		after: '.',
		answer: 'backwards'
	},
	{
		id: 'backwards-2',
		before: 'Valves stop the blood flowing',
		after: '.',
		answer: 'backwards'
	},
	{
		id: 'heart-2',
		before: 'So, veins have valves to keep blood moving towards the',
		after: '.',
		answer: 'heart'
	}
];

export const GAP_HINT_QUESTIONS: Readonly<Record<string, string>> = {
	'heart-1': 'What organ do veins return blood to?',
	low: 'Is vein pressure high or low?',
	'backwards-1': 'Which direction could blood slip?',
	'backwards-2': 'What direction do valves stop?',
	'heart-2': 'What organ should blood move towards?'
};

export const GAP_WORDS: readonly GapWord[] = [
	{ id: 'backwards-1', label: 'backwards' },
	{ id: 'low', label: 'low' },
	{ id: 'heart-1', label: 'heart' },
	{ id: 'heart-2', label: 'heart' },
	{ id: 'backwards-2', label: 'backwards' }
];

export const READING_KEY_KNOWLEDGE: readonly string[] = [
	'Veins carry blood back to the heart',
	'Blood in veins is at low pressure',
	'Low pressure can cause backflow',
	'Valves prevent backflow',
	'Valves keep blood moving one way towards the heart'
];

export const READING_OUTLINE: readonly string[] = [
	'Veins carry blood at low pressure',
	'Low pressure means blood could flow backwards',
	'Valves stop backflow and keep blood moving to the heart'
];

export const READING_KEY_SENTENCES: readonly string[] = [
	'Veins carry blood back to the heart at low pressure.',
	'Because the pressure is low, blood could flow backwards.',
	'Valves prevent backflow and keep blood moving towards the heart.'
];

export const GCSE_IDEA_CHAIN: readonly string[] = [
	'low pressure',
	'backflow risk',
	'valves stop backflow'
];

export const GCSE_FINAL_ANSWER =
	'Veins have valves because blood in them is at low pressure, so it could flow backwards. The valves prevent backflow and keep blood moving towards the heart.';
