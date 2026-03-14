import type { PaperSheetData } from './types';

export const samplePaperSheets = [
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
