import type { QuizGeneration } from '../../src/lib/server/llm/schemas';

export type PreviewFixtureMap = Record<string, QuizGeneration>;

export const previewFixtures: PreviewFixtureMap = {
	'with-questions/C2.1ExamQs.pdf': {
		quizTitle: 'C2.1 Ionic Bonding Extracted Quiz',
		summary:
			'Extracted three AQA-style practice questions covering ionic bonding, empirical formulae and lattice energy trends from the supplied worksheet.',
		mode: 'extraction',
		subject: 'chemistry',
		board: 'AQA',
		syllabusAlignment:
			'AQA GCSE Chemistry C2.1: ionic bonding, empirical formulae, lattice energy, and structure/property links.',
		questionCount: 3,
		questions: [
			{
				id: 'c21-q1',
				prompt:
					'According to the worksheet, which ionic compound forms when magnesium reacts fully with oxygen?',
				type: 'multiple_choice',
				answer: 'Magnesium oxide (MgO)',
				explanation:
					'The worksheet summarises that Group 2 metals such as magnesium react with oxygen to make ionic oxides containing Mg2+ and O2− ions, giving the empirical formula MgO.',
				options: [
					'Magnesium oxide (MgO)',
					'Magnesium hydroxide (Mg(OH)2)',
					'Magnesium sulfate (MgSO4)',
					'Magnesium carbonate (MgCO3)'
				],
				topic: 'Ionic bonding',
				difficulty: 'foundation',
				skillFocus: 'Recall of metal and oxygen reactions.',
				sourceReference: 'Worksheet page 1, question 1'
			},
			{
				id: 'c21-q2',
				prompt:
					'The sheet states that sodium chloride contains a giant ionic lattice. What particle-level explanation links this structure to its high melting point?',
				type: 'short_answer',
				answer:
					'Oppositely charged sodium and chloride ions are held by strong electrostatic attractions in all directions, so a lot of energy is needed to break the lattice.',
				explanation:
					'Learners are reminded that the regular lattice of Na+ and Cl− ions produces strong, non-directional electrostatic forces that require significant energy to overcome, explaining the high melting point.',
				topic: 'Structure and bonding',
				difficulty: 'intermediate',
				skillFocus: 'Explain structure-property relationships.',
				sourceReference: 'Worksheet page 2, explain section'
			},
			{
				id: 'c21-q3',
				prompt:
					'One task asks for the empirical formula of aluminium oxide. State the formula implied by the worksheet.',
				type: 'short_answer',
				answer: 'Al2O3',
				explanation:
					'The worked example highlights that Al3+ and O2− ions combine in the simplest whole-number ratio of two aluminium ions to three oxide ions, giving Al2O3.',
				topic: 'Chemical calculations',
				difficulty: 'foundation',
				skillFocus: 'Determine empirical formulae from ionic charges.',
				sourceReference: 'Worksheet page 2, worked example'
			}
		]
	},
	'with-questions/966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg': {
		quizTitle: 'Ionic Equations Photo Set Quiz',
		summary:
			'Three extracted questions focus on interpreting half equations, ionic balances and state symbols from the photographed worksheet.',
		mode: 'extraction',
		subject: 'chemistry',
		board: 'AQA',
		syllabusAlignment:
			'AQA GCSE Chemistry: ionic equations for precipitation and displacement reactions.',
		questionCount: 3,
		questions: [
			{
				id: 'img-a-q1',
				prompt:
					'The photo shows a question asking for the ionic equation when silver nitrate is added to sodium chloride. What balanced ionic equation is expected?',
				type: 'short_answer',
				answer: 'Ag⁺(aq) + Cl⁻(aq) → AgCl(s)',
				explanation:
					'Learners are prompted to remove spectator ions and combine aqueous Ag⁺ and Cl⁻ ions to form the silver chloride precipitate, matching the exemplar in the worksheet.',
				topic: 'Ionic equations',
				difficulty: 'foundation',
				skillFocus: 'Construct net ionic equations for precipitation reactions.',
				sourceReference: 'Worksheet photo prompt 1'
			},
			{
				id: 'img-a-q2',
				prompt:
					'One part checks balancing of the iron and copper displacement reaction. What ionic equation should students provide?',
				type: 'short_answer',
				answer: 'Fe(s) + Cu²⁺(aq) → Fe²⁺(aq) + Cu(s)',
				explanation:
					'The captured answer line expects the oxidation of iron to Fe²⁺ while Cu²⁺ gains electrons to form copper metal, illustrating redox in displacement reactions.',
				topic: 'Redox reactions',
				difficulty: 'intermediate',
				skillFocus: 'Represent changes in oxidation state using ionic equations.',
				sourceReference: 'Worksheet photo prompt 2'
			},
			{
				id: 'img-a-q3',
				prompt:
					'According to the marking guidance on the sheet, why must state symbols be included in ionic equations?',
				type: 'multiple_choice',
				answer:
					'They show the physical state of each species and confirm which product is a precipitate.',
				explanation:
					'The teacher notes alongside the image stress that correct state symbols demonstrate understanding of which ions remain aqueous and which form the solid precipitate.',
				options: [
					'They show the physical state of each species and confirm which product is a precipitate.',
					'They replace the need to balance charge conservation.',
					'They remove spectator ions from the equation entirely.',
					'They convert the equation into a molecular representation.'
				],
				topic: 'Chemical communication',
				difficulty: 'foundation',
				skillFocus: 'Use correct notation in ionic equations.',
				sourceReference: 'Worksheet annotation note'
			}
		]
	},
	'with-questions/F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg': {
		quizTitle: 'Energy Changes Marked Work Quiz',
		summary:
			'Extraction quiz sampling questions on exothermic profiles, bond energy calculations and evaluation of practical observations from the photo worksheet.',
		mode: 'extraction',
		subject: 'chemistry',
		board: 'AQA',
		syllabusAlignment:
			'AQA GCSE Chemistry: exothermic/endothermic reactions and energy profile diagrams.',
		questionCount: 3,
		questions: [
			{
				id: 'img-b-q1',
				prompt:
					'The worksheet sketch shows an energy profile for an exothermic reaction. Which statement best summarises the energy change?',
				type: 'multiple_choice',
				answer:
					'The products sit at a lower energy than the reactants because energy is released to the surroundings.',
				explanation:
					'Teacher annotations underline that exothermic profiles drop from reactants to products as heat is transferred out, giving a negative enthalpy change.',
				options: [
					'The products sit at a lower energy than the reactants because energy is released to the surroundings.',
					'Activation energy is negative because particles collide more slowly.',
					'Reactants have lower energy than products because they absorb heat.',
					'The profile is flat because the reaction reaches equilibrium.'
				],
				topic: 'Energy profiles',
				difficulty: 'foundation',
				skillFocus: 'Interpret reaction profile diagrams.',
				sourceReference: 'Worksheet section A, diagram analysis'
			},
			{
				id: 'img-b-q2',
				prompt:
					'One item requires calculating the energy change using bond energies. What method does the worksheet highlight?',
				type: 'short_answer',
				answer:
					'Add the energy needed to break bonds in reactants, subtract the energy released when new bonds form in products, and interpret the sign of the result.',
				explanation:
					'The model answer guides students to sum bond-breaking energies, subtract bond-making energies and relate the overall sign to whether the reaction is exothermic or endothermic.',
				topic: 'Bond energy calculations',
				difficulty: 'intermediate',
				skillFocus: 'Apply bond energy data to calculate ΔH.',
				sourceReference: 'Worksheet section B, calculation steps'
			},
			{
				id: 'img-b-q3',
				prompt:
					'Students comment on a temperature-time graph from a practical. What conclusion is expected about the observed drop in temperature?',
				type: 'short_answer',
				answer:
					'It indicates an endothermic process where the reaction absorbs heat from the solution, so the temperature falls.',
				explanation:
					'Marking guidance next to the graph directs learners to link a falling temperature curve to heat absorption characteristic of an endothermic reaction.',
				topic: 'Practical analysis',
				difficulty: 'foundation',
				skillFocus: 'Relate experimental data to energy changes.',
				sourceReference: 'Worksheet section C, evaluation prompt'
			}
		]
	},
	'with-questions/18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg': {
		quizTitle: 'Chemical Bonding Short Tasks Quiz',
		summary:
			'Three short-answer checks on covalent diagrams, metallic bonding properties and comparing ionic versus covalent substances extracted from the photo.',
		mode: 'extraction',
		subject: 'chemistry',
		board: 'AQA',
		syllabusAlignment: 'AQA GCSE Chemistry: covalent, ionic and metallic bonding comparisons.',
		questionCount: 3,
		questions: [
			{
				id: 'img-c-q1',
				prompt:
					'The worksheet asks for a dot-and-cross diagram of methane. What key features should the answer contain?',
				type: 'short_answer',
				answer:
					'A central carbon atom with four shared electron pairs to four hydrogen atoms, each pair containing one electron from carbon and one from hydrogen.',
				explanation:
					'Mark scheme notes emphasise showing shared pairs between C and H and no lone pairs, evidencing a simple covalent molecule.',
				topic: 'Covalent bonding',
				difficulty: 'foundation',
				skillFocus: 'Represent simple molecules using dot-and-cross diagrams.',
				sourceReference: 'Worksheet task 1'
			},
			{
				id: 'img-c-q2',
				prompt:
					'One comparison asks why sodium chloride conducts electricity when molten but not when solid. Summarise the explanation expected.',
				type: 'short_answer',
				answer:
					'In the solid ionic lattice the ions are locked in place, but when molten the ions are free to move and carry charge.',
				explanation:
					'Teacher comments point out that conductivity requires mobile charged particles, provided only when the ionic lattice melts.',
				topic: 'Properties of ionic compounds',
				difficulty: 'foundation',
				skillFocus: 'Explain conductivity changes with state.',
				sourceReference: 'Worksheet task 2'
			},
			{
				id: 'img-c-q3',
				prompt:
					'The final prompt compares metallic and covalent bonding. Which property difference is highlighted on the answer sheet?',
				type: 'multiple_choice',
				answer:
					'Metals conduct electricity because delocalised electrons move freely, unlike simple covalent molecules.',
				explanation:
					'The annotation stresses that the sea of delocalised electrons in metals enables conduction whereas discrete covalent molecules lack mobile charge carriers.',
				options: [
					'Metals conduct electricity because delocalised electrons move freely, unlike simple covalent molecules.',
					'Metals contain shared pairs only between two specific atoms just like covalent molecules.',
					'Covalent substances conduct better because their electrons are localised on ions.',
					'Both bonding types require ions arranged in a giant lattice to conduct.'
				],
				topic: 'Metallic bonding',
				difficulty: 'intermediate',
				skillFocus: 'Compare bonding models and resulting properties.',
				sourceReference: 'Worksheet task 3'
			}
		]
	},
	'no-questions/Y8Lesson-Health-BloodDonations.pdf': {
		quizTitle: 'Blood Donation Awareness Quiz',
		summary:
			'Synthesised three GCSE biology comprehension questions covering donor eligibility, blood group matching and transfusion safety from the leaflet.',
		mode: 'synthesis',
		subject: 'biology',
		board: 'OCR',
		syllabusAlignment:
			'OCR GCSE Biology: circulatory system, blood components and health promotion.',
		questionCount: 3,
		questions: [
			{
				id: 'blood-q1',
				prompt:
					'According to the leaflet, list two eligibility checks that must be passed before someone can donate blood.',
				type: 'short_answer',
				answer:
					'Potential donors must meet the minimum age and weight requirements and pass the health screening questions about recent illnesses or travel.',
				explanation:
					'The information sheet emphasises pre-donation checks on age, body weight and health questionnaire responses to ensure donor and recipient safety.',
				topic: 'Health screening',
				difficulty: 'foundation',
				skillFocus: 'Recall key eligibility criteria for medical procedures.',
				sourceReference: 'Leaflet section: Who can give blood?'
			},
			{
				id: 'blood-q2',
				prompt:
					'The notes explain why matching blood groups matters. What risk arises if incompatible blood is transfused?',
				type: 'multiple_choice',
				answer:
					'Antibodies in the recipient attack the donated red cells causing them to clump and block vessels.',
				explanation:
					'The leaflet highlights that mismatched groups trigger an immune reaction where antibodies agglutinate donor cells, which can be life-threatening.',
				options: [
					'Antibodies in the recipient attack the donated red cells causing them to clump and block vessels.',
					'The donated blood evaporates quickly so the transfusion fails.',
					'The recipient instantly forms more red blood cells to dilute the transfusion.',
					'The donation permanently changes the recipient’s own blood group.'
				],
				topic: 'Immune response',
				difficulty: 'intermediate',
				skillFocus: 'Explain immunological compatibility.',
				sourceReference: 'Leaflet section: Matching matters'
			},
			{
				id: 'blood-q3',
				prompt:
					'Summarise one benefit to hospitals of maintaining a steady supply of donated blood as highlighted in the leaflet.',
				type: 'short_answer',
				answer:
					'Hospitals can respond quickly to emergencies and planned operations because compatible blood components are ready in storage.',
				explanation:
					'The promotional text stresses that regular donations keep stocks high so trauma care, surgeries and treatments for conditions like anaemia can proceed without delay.',
				topic: 'Public health logistics',
				difficulty: 'foundation',
				skillFocus: 'Connect community health initiatives to patient outcomes.',
				sourceReference: 'Leaflet closing section'
			}
		]
	}
};
