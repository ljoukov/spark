export type GiadFlowStatus = 'correct' | 'identified' | 'gap';

export type GiadFlowTheme = {
	accent: string;
	accentStrong: string;
	soft: string;
	border: string;
	text: string;
};

export type GiadFlowSegment = {
	text: string;
	highlight?: boolean;
};

export type GiadFlow = {
	id: string;
	icon: 'heart' | 'atom' | 'zap' | 'activity';
	title: string;
	shortTitle: string;
	subtitle: string;
	subject: string;
	context: string;
	marks: string;
	question: string;
	draftLabel: string;
	draft: string[];
	scoreLabel: string;
	gapLabel: string;
	repairMove: string;
	sourceNote: string;
	theme: GiadFlowTheme;
	diagnosis: Array<{
		status: GiadFlowStatus;
		title: string;
		body: string;
	}>;
	missing: {
		title: string;
		bodyStart: string;
		highlights: string[];
		bodyEnd: string;
	};
	builderSteps: Array<{
		title: string;
		prompt: string;
		answer: string;
		cues: string[];
		visual?: string;
	}>;
	chain: Array<{
		label: string;
		title: string;
		body: string;
		visual?: string;
	}>;
	improvedAnswer: GiadFlowSegment[][];
	tip: string;
};

const PHYSICS_THEME: GiadFlowTheme = {
	accent: '#2563eb',
	accentStrong: '#1d4ed8',
	soft: '#eff6ff',
	border: '#bfdbfe',
	text: '#102a6a'
};

const BIOLOGY_THEME: GiadFlowTheme = {
	accent: '#0f8b6f',
	accentStrong: '#047857',
	soft: '#ecfdf5',
	border: '#a7f3d0',
	text: '#064e3b'
};

const METHOD_THEME: GiadFlowTheme = {
	accent: '#7c3aed',
	accentStrong: '#6d28d9',
	soft: '#f5f3ff',
	border: '#ddd6fe',
	text: '#3b217c'
};

export const GIAD_FLOWS: GiadFlow[] = [
	{
		id: 'particle-collisions-power',
		icon: 'activity',
		title: 'Close the collision gap',
		shortTitle: 'Particle collisions and power',
		subtitle: 'Andrew has the right chain, but one physics mechanism is missing.',
		subject: 'Physics',
		context: 'AQA GCSE Combined Science: Trilogy Physics Paper 1H',
		marks: '4 marks',
		question:
			'Explain how the motion of the particles in warmer air causes an increase in the power transferred to the turbine.',
		draftLabel: "Andrew's draft",
		draft: [
			'When the particles are warmer they move faster.',
			'This means kinetic energy increases.',
			'This means energy transferred increases.',
			'so since P = E / t, power increases.'
		],
		scoreLabel: '3 / 4',
		gapLabel: 'Gap: missing collision mechanism',
		repairMove:
			'Insert the physical event between faster particles and more energy transferred.',
		sourceNote:
			'From Andrew physics grading: strong idea, but needed collisions to be more frequent and/or harder.',
		theme: PHYSICS_THEME,
		diagnosis: [
			{
				status: 'correct',
				title: 'Correct starting idea',
				body: 'You noticed that warmer particles move faster.'
			},
			{
				status: 'identified',
				title: 'Topic identified',
				body: 'You linked kinetic energy, energy transfer, and power.'
			},
			{
				status: 'gap',
				title: 'Gap: missing collision step',
				body: 'You need to explain what the faster particles do to the turbine.'
			}
		],
		missing: {
			title: "What's missing?",
			bodyStart: 'To make the explanation complete, show ',
			highlights: [
				'what faster particles do at the blades',
				'how the collisions change',
				'why that means more energy each second'
			],
			bodyEnd: '.'
		},
		builderSteps: [
			{
				title: 'What changes first?',
				prompt: 'What happens to particles when the air is warmer?',
				answer: 'They move faster and have more kinetic energy.',
				cues: ['warmer air', 'faster particles']
			},
			{
				title: 'Why does that matter?',
				prompt: 'What do faster particles do to the turbine blades?',
				answer: 'They collide more often and/or with more force.',
				cues: ['more frequent collisions', 'harder collisions']
			},
			{
				title: 'What is the result?',
				prompt: 'How does that affect power?',
				answer: 'More energy is transferred each second, so power increases.',
				cues: ['energy each second', 'P = E / t']
			}
		],
		chain: [
			{
				label: '1',
				title: 'Warmer air',
				body: 'particles move faster'
			},
			{
				label: '2',
				title: 'More kinetic energy',
				body: 'particles reach the blades with more energy'
			},
			{
				label: '3',
				title: 'More collisions',
				body: 'collisions are more frequent and/or harder'
			},
			{
				label: '4',
				title: 'Higher power',
				body: 'more energy is transferred each second'
			}
		],
		improvedAnswer: [
			[
				{ text: 'When the air is warmer, the particles ' },
				{ text: 'move faster', highlight: true },
				{ text: ' and have more kinetic energy.' }
			],
			[
				{ text: 'This means they ' },
				{ text: 'collide with the turbine blades more often and/or with more force', highlight: true },
				{ text: '.' }
			],
			[
				{ text: 'More energy is transferred to the turbine each second, so the ' },
				{ text: 'power transferred increases', highlight: true },
				{ text: '.' }
			]
		],
		tip: 'In physics explanations, do not jump from a cause to a formula. Name the physical interaction in the middle.'
	},
	{
		id: 'alpha-scattering-evidence',
		icon: 'atom',
		title: 'Close the evidence chain gap',
		shortTitle: 'Alpha scattering evidence chain',
		subtitle: 'Andrew knows the models, but the observations need to lead to conclusions.',
		subject: 'Physics',
		context: 'AQA GCSE Combined Science: Trilogy Physics Paper 1H',
		marks: '6 marks',
		question:
			'Describe how the actual results led to the plum pudding model of the atom being replaced by the nuclear model. Include details of both models.',
		draftLabel: "Andrew's draft",
		draft: [
			'The plum pudding model was a ball of positive charge with electrons embedded in it.',
			'The experiment expected all the particles would go through.',
			"It didn't predict some particles being deflected.",
			'All deflections suggest that the nucleus exists and a small ball of positive charge.'
		],
		scoreLabel: '4 / 6',
		gapLabel: 'Gap: missing observation to conclusion links',
		repairMove:
			'Separate each experiment result from what that result proved about the atom.',
		sourceNote:
			'From Andrew physics grading: good core idea, missing most-particles-through and few-large-deflections conclusions.',
		theme: PHYSICS_THEME,
		diagnosis: [
			{
				status: 'correct',
				title: 'Correct model recall',
				body: 'You described the plum pudding model accurately.'
			},
			{
				status: 'identified',
				title: 'Evidence identified',
				body: 'You spotted that deflections were unexpected.'
			},
			{
				status: 'gap',
				title: 'Gap: missing proof chain',
				body: 'You need to say which result proved empty space and which proved a small nucleus.'
			}
		],
		missing: {
			title: "What's missing?",
			bodyStart: 'To reach full marks, connect ',
			highlights: [
				'most particles passed straight through',
				'few particles deflected through large angles',
				'each observation to a conclusion'
			],
			bodyEnd: '.'
		},
		builderSteps: [
			{
				title: 'What did most particles do?',
				prompt: 'Which observation showed that most of the atom is empty space?',
				answer: 'Most alpha particles passed straight through.',
				cues: ['most passed through', 'little or no deflection']
			},
			{
				title: 'What did that show?',
				prompt: 'Why does passing through matter?',
				answer: 'It showed that most of the atom is empty space.',
				cues: ['empty space', 'not solid positive matter']
			},
			{
				title: 'What did rare deflections show?',
				prompt: 'What did the few large deflections prove?',
				answer: 'They showed a small, dense, positive nucleus.',
				cues: ['large deflections', 'small dense positive nucleus']
			}
		],
		chain: [
			{
				label: '1',
				title: 'Plum pudding',
				body: 'positive charge spread out with electrons embedded'
			},
			{
				label: '2',
				title: 'Most passed through',
				body: 'the atom is mostly empty space'
			},
			{
				label: '3',
				title: 'Few deflected greatly',
				body: 'positive charge is concentrated'
			},
			{
				label: '4',
				title: 'Nuclear model',
				body: 'small dense positive nucleus replaces plum pudding'
			}
		],
		improvedAnswer: [
			[
				{ text: 'The plum pudding model said positive charge was spread through the atom, with ' },
				{ text: 'electrons embedded', highlight: true },
				{ text: ' in it.' }
			],
			[
				{ text: 'In the alpha scattering experiment, ' },
				{ text: 'most alpha particles passed straight through', highlight: true },
				{ text: ', showing that the atom is mostly empty space.' }
			],
			[
				{ text: 'A small number were deflected through large angles, showing that the positive charge and mass are concentrated in a ' },
				{ text: 'small dense nucleus', highlight: true },
				{ text: '. This replaced the plum pudding model with the nuclear model.' }
			]
		],
		tip: 'For experiment questions, pair every observation with the conclusion it supports.'
	},
	{
		id: 'circuit-adjustment-method',
		icon: 'zap',
		title: 'Close the method gap',
		shortTitle: 'Circuit adjustment method',
		subtitle: 'Andrew has one valid method idea, but the setup needs a smoother control.',
		subject: 'Physics',
		context: 'AQA GCSE Combined Science: Trilogy Physics Paper 1H',
		marks: '2 marks',
		question:
			'Describe how the student should have adjusted the circuit to vary the potential difference across this range.',
		draftLabel: "Andrew's draft",
		draft: ['Use batteries with different potential difference.', 'Reverse connections to power supply.'],
		scoreLabel: '1 / 2',
		gapLabel: 'Gap: missing variable resistor',
		repairMove:
			'Keep the correct reversing idea, then replace battery swapping with a continuous adjustment method.',
		sourceNote:
			'From Andrew physics grading: reversing connections was useful, but the variable adjustment method was incomplete.',
		theme: METHOD_THEME,
		diagnosis: [
			{
				status: 'correct',
				title: 'Correct direction idea',
				body: 'You knew the connections must be reversed for negative values.'
			},
			{
				status: 'identified',
				title: 'Setup identified',
				body: 'You understood that the circuit has to vary potential difference.'
			},
			{
				status: 'gap',
				title: 'Gap: missing control',
				body: 'You need the component that varies p.d. smoothly in the same circuit.'
			}
		],
		missing: {
			title: "What's missing?",
			bodyStart: 'To complete the method, name ',
			highlights: [
				'the variable resistor',
				'how it changes the p.d.',
				'when to reverse the supply connections'
			],
			bodyEnd: '.'
		},
		builderSteps: [
			{
				title: 'What should stay the same?',
				prompt: 'Why is swapping batteries weaker as a method?',
				answer: 'It gives jumps between values rather than a smooth range.',
				cues: ['same circuit', 'smooth range']
			},
			{
				title: 'What controls the p.d.?',
				prompt: 'Which component lets the student vary the p.d. continuously?',
				answer: 'A variable resistor.',
				cues: ['variable resistor', 'adjust resistance']
			},
			{
				title: 'How get negative values?',
				prompt: 'What should happen after the positive readings?',
				answer: 'Reverse the supply or LED connections and repeat the readings.',
				cues: ['reverse connections', 'negative p.d.']
			}
		],
		chain: [
			{
				label: '1',
				title: 'Use same circuit',
				body: 'do not swap to different batteries'
			},
			{
				label: '2',
				title: 'Adjust resistor',
				body: 'change resistance to vary p.d.'
			},
			{
				label: '3',
				title: 'Record positive values',
				body: 'take readings across the range'
			},
			{
				label: '4',
				title: 'Reverse connections',
				body: 'repeat for negative p.d. values'
			}
		],
		improvedAnswer: [
			[
				{ text: 'The student should use a ' },
				{ text: 'variable resistor', highlight: true },
				{ text: ' to vary the potential difference across the LED smoothly.' }
			],
			[
				{ text: 'They should then ' },
				{ text: 'reverse the supply or LED connections', highlight: true },
				{ text: ' to obtain negative values and repeat the readings.' }
			]
		],
		tip: 'For practical method marks, name the control component and say how it changes the measured quantity.'
	},
	{
		id: 'coronary-artery-chain',
		icon: 'heart',
		title: 'Close the explanation gap',
		shortTitle: 'Coronary artery chain',
		subtitle: 'A biology blank-rescue flow showing the full cause and effect chain.',
		subject: 'Biology',
		context: 'GCSE Biology',
		marks: '4 marks',
		question: 'Explain why reduced blood flow to the heart can cause chest pain.',
		draftLabel: 'First draft',
		draft: ['Less blood gets to the heart.'],
		scoreLabel: '1 / 4',
		gapLabel: 'Next step: add the causal chain',
		repairMove:
			'Extend the first correct idea into oxygen, respiration, energy release, and pain.',
		sourceNote:
			'Based on Andrew biology missing-chain evidence: the original answer was blank, so this prototype starts after the first rescued sentence.',
		theme: BIOLOGY_THEME,
		diagnosis: [
			{
				status: 'correct',
				title: 'Correct starting idea',
				body: 'You noticed that blood flow is reduced.'
			},
			{
				status: 'identified',
				title: 'Topic identified',
				body: 'You know the problem affects the heart.'
			},
			{
				status: 'gap',
				title: 'Gap: missing causal chain',
				body: 'You need to explain why reduced blood flow causes pain.'
			}
		],
		missing: {
			title: 'What to add',
			bodyStart: 'To make this clearer, add the ',
			highlights: ['causal chain:'],
			bodyEnd:
				' what the blood supplies, what the heart muscle needs, and what happens when it gets too little.'
		},
		builderSteps: [
			{
				title: 'What is reduced?',
				prompt: 'What reaches the heart muscle when blood flow falls?',
				answer: 'Reduced blood flow means less oxygen reaches the heart muscle.',
				cues: ['less oxygen', 'heart muscle cells'],
				visual: '🫀'
			},
			{
				title: 'Why does that matter?',
				prompt: 'What cell process needs oxygen?',
				answer: 'Heart muscle cells need oxygen for aerobic respiration.',
				cues: ['less oxygen → less respiration → less energy'],
				visual: '🦠'
			},
			{
				title: 'What is the result?',
				prompt: 'Why does less energy cause chest pain?',
				answer:
					'If the heart muscle gets too little oxygen and energy, it cannot work properly and this causes chest pain.',
				cues: ['less energy', 'muscle cannot work properly'],
				visual: '💙'
			}
		],
		chain: [
			{
				label: '1',
				title: 'Reduced blood flow',
				body: 'less blood reaches the heart',
				visual: '🩸'
			},
			{
				label: '2',
				title: 'Less oxygen',
				body: 'heart muscle gets less oxygen',
				visual: '🫧'
			},
			{
				label: '3',
				title: 'Less respiration',
				body: 'less energy is released',
				visual: '🔋'
			},
			{
				label: '4',
				title: 'Chest pain',
				body: 'heart muscle is starved of oxygen',
				visual: '💔'
			}
		],
		improvedAnswer: [
			[
				{ text: 'Reduced blood flow means ' },
				{ text: 'less oxygen reaches the heart muscle', highlight: true },
				{ text: '.' }
			],
			[
				{ text: 'This means ' },
				{ text: 'less aerobic respiration', highlight: true },
				{ text: ' happens, so less energy is released.' }
			],
			[
				{ text: 'Because the heart muscle does not get enough oxygen and energy, it cannot work properly, which ' },
				{ text: 'causes chest pain', highlight: true },
				{ text: '.' }
			]
		],
		tip: 'In biology explanations, link the cause, the process inside cells, and the final effect.'
	}
];

export function getGiadFlow(id: string): GiadFlow | null {
	return GIAD_FLOWS.find((flow) => flow.id === id) ?? null;
}
