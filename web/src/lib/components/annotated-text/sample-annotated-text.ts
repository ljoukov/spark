import type { AnnotatedTextDocument } from './types';

const submissionText = `The breeze picked up, strengthening the current, making waves charge across the ocean crashing into the skiff; the effect was so devastating the boat lurched up left and right threatening to topple over the boat, The beams held tightly. Digging into their last hinges. The old man knew that if this continued, his boat would soon be a mass of rotten wood sleeping on the sea bed. He scanned the horizon and noticed a bank of ash-coloured cloud filling the air above him, casting its silhouete across the powerless sun, imprisoning it in the dungeon of death.

By now the shark had enough of waiting and so it decided to strike: it soared through the air smashing into the boat, splintering the wood, The old man filled tub of water and hoisted the fish into it the boat Strangely, the shark was so crammed in no water came in. The only way to safely push the shark out was using the tub as a blockade. After minutes of exhaistion he finally got the tub in place ready to seal the hole. It would have worked if the sharks fin hadn't got stuck in the boat...

At that exact moment the clouds shose to disintegrate into pelts of frozen water hailing down onto the defensless craft like bullets raining onto a house. The wind tot howled angrily encouraging the sea to rumble into action and a fight the sea world war. Collozal waves struck the deck sloshing in and out of the skiff.

Finally, the shark was out and the hole was sealled but still the boat sank. The fisherman's heart shattered when he remembered his family waving goodbye, wishing him a safe voyage. As he lifted the emergency sails higher and higher his spirits lifted with it when he saw what lay ahead.

It was a dream come true. Excitement surged through his body - he had succeded! He was the first human to sail round the world 2 times in a row. He was too excited to notice the other sharks trailing behind him.`;

export const sampleAnnotatedTextDocument = {
	heading: 'Student Submission',
	description:
		'Highlighted sections have teacher annotations. Click any highlighted passage to read the comment.',
	text: submissionText,
	annotations: [
		{
			id: 'ann1',
			start: 0,
			end: 98,
			type: 'strength',
			label: 'Strength',
			comment:
				'Strong chain of cause and effect — breeze → current → waves → skiff. Progressive, physical action.'
		},
		{
			id: 'ann2',
			start: 99,
			end: 196,
			type: 'vocab',
			label: 'Vocab',
			comment:
				'"Devastating" names the effect rather than showing it. Also "topple over the boat" repeats boat.'
		},
		{
			id: 'ann3',
			start: 197,
			end: 240,
			type: 'structure',
			label: 'Structure',
			comment:
				"Fragment ('Digging into their last hinges') shows Hemingway's staccato rhythm — good instinct. But the image is imprecise: beams don't dig into hinges."
		},
		{
			id: 'ann4',
			start: 341,
			end: 448,
			type: 'device',
			label: 'Device',
			comment:
				"Extended metaphor started here (sun imprisoned). Excellent instinct — but 'dungeon of death' is overwrought. Sustain it quietly across the whole piece."
		},
		{
			id: 'ann5',
			start: 449,
			end: 600,
			type: 'inaccuracy',
			label: 'Inaccuracy',
			comment:
				"A Mako shark launching itself into the skiff is implausible and breaks Hemingway's careful realism. The shark bites the marlin — it does not board the boat."
		},
		{
			id: 'ann6',
			start: 688,
			end: 780,
			type: 'vocab',
			label: 'Vocab',
			comment:
				'"Exhaustion" misspelled as exhaistion. More importantly — show exhaustion through physical action, not naming it.'
		},
		{
			id: 'ann7',
			start: 781,
			end: 950,
			type: 'device',
			label: 'Device',
			comment:
				'"bullets raining onto a house" — simile present but imprecise. Good instinct; refine the vehicle. Also shose = chose.'
		},
		{
			id: 'ann8',
			start: 951,
			end: 1080,
			type: 'grammar',
			label: 'Grammar',
			comment:
				'"a fight the sea world war" — ungrammatical. tot = then. Personification ("howled angrily") is good but Hemingway would describe the sound, not name the emotion.'
		},
		{
			id: 'ann9',
			start: 1081,
			end: 1140,
			type: 'vocab',
			label: 'Vocab',
			comment:
				'Colossal misspelled as Collozal. And colossal is a vague intensifier — specify height or force.'
		},
		{
			id: 'ann10',
			start: 1141,
			end: 1260,
			type: 'strength',
			label: 'Strength',
			comment:
				'Your best sentence. Restrained, emotional, concrete — memory used as the emotion. This is close to Hemingway.'
		},
		{
			id: 'ann11',
			start: 1260,
			end: 1420,
			type: 'inaccuracy',
			label: 'Inaccuracy',
			comment:
				"Completely abandons the source text. Santiago is an old Cuban fisherman — not a circumnavigator. '2 times' should be written as prose, and the exclamation mark clashes with Hemingway's unsentimental style."
		}
	],
	annotationTypes: {
		strength: {
			label: 'Strength',
			lightColor: '#16a34a',
			lightBackground: '#f0fdf4',
			lightBorderColor: '#16a34a',
			darkColor: '#4ade80',
			darkBackground: '#052e1640',
			darkBorderColor: '#22c55e'
		},
		vocab: {
			label: 'Vocabulary',
			lightColor: '#b45309',
			lightBackground: '#fffbea',
			lightBorderColor: '#d97706',
			darkColor: '#fbbf24',
			darkBackground: '#1c100050',
			darkBorderColor: '#ca8a04'
		},
		device: {
			label: 'Device',
			lightColor: '#7c3aed',
			lightBackground: '#f5f3ff',
			lightBorderColor: '#8b5cf6',
			darkColor: '#a78bfa',
			darkBackground: '#1e1040',
			darkBorderColor: '#a78bfa'
		},
		structure: {
			label: 'Structure',
			lightColor: '#0e7490',
			lightBackground: '#ecfeff',
			lightBorderColor: '#06b6d4',
			darkColor: '#22d3ee',
			darkBackground: '#0c2a30',
			darkBorderColor: '#22d3ee'
		},
		grammar: {
			label: 'Grammar',
			lightColor: '#b85530',
			lightBackground: '#fdf4ee',
			lightBorderColor: '#b85530',
			darkColor: '#f0916a',
			darkBackground: '#2d180e50',
			darkBorderColor: '#f0916a'
		},
		inaccuracy: {
			label: 'Inaccuracy',
			lightColor: '#9a3412',
			lightBackground: '#fff1f1',
			lightBorderColor: '#dc2626',
			darkColor: '#f87171',
			darkBackground: '#2d0e0e50',
			darkBorderColor: '#f87171'
		}
	}
} satisfies AnnotatedTextDocument;
