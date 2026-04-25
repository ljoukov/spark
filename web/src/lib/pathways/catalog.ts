import type {
	SparkLearningCountry,
	SparkLearningProfileSelection,
	SparkPathwayExamBoard,
	SparkPathwayProgramme,
	SparkPathwayQualification,
	SparkPathwaySourceDocument,
	SparkPathwaySubject,
	SparkPathwayUnit
} from '@spark/schemas';

export type PathwayOption<T extends string> = {
	value: T;
	label: string;
	description?: string;
};

export const PATHWAY_COUNTRIES: readonly PathwayOption<SparkLearningCountry>[] = [
	{ value: 'UK', label: 'United Kingdom', description: 'GCSE and A-level routes' }
];

export const PATHWAY_SCHOOL_STAGES_BY_COUNTRY: Record<SparkLearningCountry, readonly string[]> = {
	UK: ['Year 9', 'Year 10', 'Year 11'],
	USA: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
	Canada: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
	Australia: ['Year 9', 'Year 10', 'Year 11', 'Year 12'],
	Singapore: ['Secondary 3', 'Secondary 4', 'Junior College 1', 'Junior College 2']
};

export const PATHWAY_PROGRAMMES: readonly PathwayOption<SparkPathwayProgramme>[] = [
	{
		value: 'gcse_triple_science',
		label: 'GCSE Triple Science',
		description: 'Separate Biology, Chemistry, and Physics GCSEs'
	}
];

export const PATHWAY_QUALIFICATIONS: readonly PathwayOption<SparkPathwayQualification>[] = [
	{ value: 'gcse', label: 'GCSE' }
];

export const PATHWAY_EXAM_BOARDS: readonly PathwayOption<SparkPathwayExamBoard>[] = [
	{ value: 'aqa', label: 'AQA' }
];

export const PATHWAY_SUBJECTS: ReadonlyArray<
	PathwayOption<SparkPathwaySubject> & { accent: string }
> = [
	{ value: 'chemistry', label: 'Chemistry', accent: '#8b5cf6' },
	{ value: 'biology', label: 'Biology', accent: '#16a34a' },
	{ value: 'physics', label: 'Physics', accent: '#4f46e5' }
];

const REFERENCE_ROOT = 'data/pathways/references/uk-gcse-aqa-triple-science';

const AQA_SEPARATE_SCIENCE_SOURCE_DOCUMENTS: Record<
	SparkPathwaySubject,
	SparkPathwaySourceDocument
> = {
	biology: {
		id: 'aqa-gcse-biology-8461-specification',
		title: 'AQA GCSE Biology 8461 specification',
		publisher: 'AQA',
		qualificationCode: '8461',
		sourceUrl: 'https://filestore.aqa.org.uk/resources/biology/specifications/AQA-8461-SP-2016.PDF',
		pageUrl: 'https://www.aqa.org.uk/subjects/biology/gcse/biology-8461',
		localCachePath: `${REFERENCE_ROOT}/aqa-gcse-biology-8461-specification.pdf`,
		textCachePath: `${REFERENCE_ROOT}/aqa-gcse-biology-8461-specification.txt`,
		checkedAt: '2026-04-24'
	},
	chemistry: {
		id: 'aqa-gcse-chemistry-8462-specification',
		title: 'AQA GCSE Chemistry 8462 specification',
		publisher: 'AQA',
		qualificationCode: '8462',
		sourceUrl:
			'https://filestore.aqa.org.uk/resources/chemistry/specifications/AQA-8462-SP-2016.PDF',
		pageUrl: 'https://www.aqa.org.uk/subjects/chemistry/gcse/chemistry-8462',
		localCachePath: `${REFERENCE_ROOT}/aqa-gcse-chemistry-8462-specification.pdf`,
		textCachePath: `${REFERENCE_ROOT}/aqa-gcse-chemistry-8462-specification.txt`,
		checkedAt: '2026-04-24'
	},
	physics: {
		id: 'aqa-gcse-physics-8463-specification',
		title: 'AQA GCSE Physics 8463 specification',
		publisher: 'AQA',
		qualificationCode: '8463',
		sourceUrl: 'https://filestore.aqa.org.uk/resources/physics/specifications/AQA-8463-SP-2016.PDF',
		pageUrl: 'https://www.aqa.org.uk/subjects/physics/gcse/physics-8463',
		localCachePath: `${REFERENCE_ROOT}/aqa-gcse-physics-8463-specification.pdf`,
		textCachePath: `${REFERENCE_ROOT}/aqa-gcse-physics-8463-specification.txt`,
		checkedAt: '2026-04-24'
	}
};

const CHEMISTRY_FALLBACK_UNITS: readonly SparkPathwayUnit[] = [
	{
		id: 'atomic-structure-periodic-table',
		title: 'Atomic structure and the periodic table',
		summary:
			'Build the particle model of atoms, ions, isotopes, electronic structure, and periodic trends before moving into bonding.',
		specRefs: ['4.1'],
		learningGoals: [
			'Describe atoms, elements, compounds, isotopes, and ions accurately.',
			'Use electronic structure to explain group and period patterns.',
			'Compare historical models of the atom and the evidence behind them.'
		],
		keyTerms: ['atom', 'isotope', 'ion', 'relative atomic mass', 'group', 'period'],
		checkpointPrompts: [
			'Explain why chlorine atoms form chloride ions.',
			'Use an element position to predict its electronic structure.'
		],
		practiceIdeas: [
			'Make a one-page periodic table trend map.',
			'Complete mixed isotope and electronic-structure questions.'
		],
		estimatedStudyHours: 7
	},
	{
		id: 'bonding-structure-properties',
		title: 'Bonding, structure, and properties of matter',
		summary:
			'Link ionic, covalent, metallic, giant, polymer, nanoparticle, and carbon structures to their physical properties.',
		specRefs: ['4.2'],
		learningGoals: [
			'Explain ionic, covalent, and metallic bonding using particle-level models.',
			'Predict melting point, conductivity, and solubility from structure.',
			'Recognise chemistry-only structures such as graphene, fullerenes, and nanoparticles.'
		],
		keyTerms: ['ionic lattice', 'covalent bond', 'metallic bonding', 'polymer', 'nanoparticle'],
		checkpointPrompts: [
			'Why does sodium chloride conduct when molten but not solid?',
			'Compare diamond and graphite using structure and bonding.'
		],
		practiceIdeas: [
			'Create structure-property flashcards.',
			'Answer six explanation questions that require because chains.'
		],
		estimatedStudyHours: 8
	},
	{
		id: 'quantitative-chemistry',
		title: 'Quantitative chemistry',
		summary:
			'Turn formulae and equations into calculations involving relative formula mass, moles, reacting masses, concentration, and yields.',
		specRefs: ['4.3'],
		learningGoals: [
			'Calculate relative formula mass and use balanced equations quantitatively.',
			'Convert between mass, moles, concentration, volume, and gas volume.',
			'Handle yield, atom economy, and titration-style reasoning.'
		],
		keyTerms: ['mole', 'relative formula mass', 'concentration', 'yield', 'atom economy'],
		checkpointPrompts: [
			'Find the mass of product from a balanced equation and a given reactant mass.',
			'Explain why atom economy matters for industrial processes.'
		],
		practiceIdeas: [
			'Do a daily set of five mole conversions for one week.',
			'Build a formula triangle sheet for concentration and moles.'
		],
		estimatedStudyHours: 10
	},
	{
		id: 'chemical-changes',
		title: 'Chemical changes',
		summary:
			'Connect reactivity, acids, electrolysis, and redox so students can predict products and explain observations.',
		specRefs: ['4.4'],
		learningGoals: [
			'Use the reactivity series to predict displacement and extraction routes.',
			'Write ionic equations for neutralisation and precipitation contexts.',
			'Predict products of electrolysis in molten and aqueous systems.'
		],
		keyTerms: ['reactivity series', 'salt', 'electrolysis', 'oxidation', 'reduction'],
		checkpointPrompts: [
			'Predict the products of electrolysis of copper chloride solution.',
			'Explain why aluminium is extracted by electrolysis.'
		],
		practiceIdeas: [
			'Compare three acid-salt preparation methods.',
			'Complete product-prediction drills for electrolysis.'
		],
		estimatedStudyHours: 9
	},
	{
		id: 'energy-and-rates',
		title: 'Energy changes and reaction rates',
		summary:
			'Use energy profiles, bond energies, collision theory, reversible reactions, equilibrium, and Le Chatelier reasoning together.',
		specRefs: ['4.5', '4.6'],
		learningGoals: [
			'Distinguish exothermic and endothermic reactions from profiles and data.',
			'Calculate overall energy change from bond energies.',
			'Explain rate changes using collision frequency and activation energy.',
			'Predict equilibrium shifts for temperature, pressure, and concentration changes.'
		],
		keyTerms: ['activation energy', 'catalyst', 'equilibrium', 'Le Chatelier', 'bond energy'],
		checkpointPrompts: [
			'Explain how a catalyst changes a reaction profile.',
			'Predict the effect of increasing pressure on a gaseous equilibrium.'
		],
		practiceIdeas: [
			'Draw and annotate four reaction profiles.',
			'Plan a rate investigation with variables and controls.'
		],
		estimatedStudyHours: 9
	},
	{
		id: 'organic-analysis-atmosphere-resources',
		title: 'Organic chemistry, analysis, atmosphere, and resources',
		summary:
			'Finish with carbon chemistry, chemical analysis, atmospheric chemistry, and resource-use decisions that often drive Paper 2 extended questions.',
		specRefs: ['4.7', '4.8', '4.9', '4.10'],
		learningGoals: [
			'Name and draw alkanes, alkenes, alcohols, and carboxylic acids at GCSE level.',
			'Use tests to identify gases, ions, pure substances, and formulations.',
			'Explain atmospheric changes, greenhouse gases, potable water, life-cycle assessments, and recycling.'
		],
		keyTerms: ['alkane', 'alkene', 'chromatography', 'greenhouse gas', 'life-cycle assessment'],
		checkpointPrompts: [
			'Use chromatography evidence to decide whether a sample is pure.',
			'Compare potable water production by freshwater treatment and desalination.'
		],
		practiceIdeas: [
			'Make a Paper 2 command-word grid.',
			'Write two six-mark answers linking evidence to environmental decisions.'
		],
		estimatedStudyHours: 12
	}
];

const BIOLOGY_FALLBACK_UNITS: readonly SparkPathwayUnit[] = [
	{
		id: 'cell-biology',
		title: 'Cell biology',
		summary:
			'Cover cell structures, microscopy, cell division, stem cells, transport, and culturing microorganisms.',
		specRefs: ['4.1'],
		learningGoals: [
			'Compare eukaryotic, prokaryotic, and specialised cells.',
			'Use microscopy calculations confidently.',
			'Explain diffusion, osmosis, and active transport.'
		],
		keyTerms: ['cell', 'organelle', 'mitosis', 'osmosis', 'active transport'],
		checkpointPrompts: [
			'Calculate image size from magnification.',
			'Explain osmosis in plant cells.'
		],
		practiceIdeas: ['Draw labelled cell diagrams.', 'Complete microscopy calculation drills.'],
		estimatedStudyHours: 8
	},
	{
		id: 'organisation-infection-bioenergetics',
		title: 'Organisation, infection, and bioenergetics',
		summary:
			'Connect human organisation, plant tissues, communicable disease, immunity, photosynthesis, and respiration.',
		specRefs: ['4.2', '4.3', '4.4'],
		learningGoals: [
			'Describe organisation from cells to organ systems.',
			'Explain how pathogens spread and how the body defends itself.',
			'Use photosynthesis and respiration equations in context.'
		],
		keyTerms: ['enzyme', 'pathogen', 'antibody', 'photosynthesis', 'respiration'],
		checkpointPrompts: [
			'Explain the effect of temperature on enzyme activity.',
			'Compare aerobic and anaerobic respiration.'
		],
		practiceIdeas: [
			'Build disease-response flowcharts.',
			'Interpret rate graphs for photosynthesis.'
		],
		estimatedStudyHours: 14
	},
	{
		id: 'homeostasis-inheritance-ecology',
		title: 'Homeostasis, inheritance, and ecology',
		summary:
			'Finish the Biology course with control systems, reproduction, genetics, evolution, biodiversity, and ecosystem interactions.',
		specRefs: ['4.5', '4.6', '4.7'],
		learningGoals: [
			'Explain nervous and hormonal control loops.',
			'Use genetic crosses and inheritance terminology accurately.',
			'Evaluate human impacts on biodiversity and food security.'
		],
		keyTerms: ['homeostasis', 'hormone', 'allele', 'evolution', 'biodiversity'],
		checkpointPrompts: [
			'Use a Punnett square to predict offspring ratios.',
			'Explain how negative feedback controls blood glucose.'
		],
		practiceIdeas: [
			'Mix genetics calculations with evaluation questions.',
			'Create ecology case-study cards.'
		],
		estimatedStudyHours: 16
	}
];

const PHYSICS_FALLBACK_UNITS: readonly SparkPathwayUnit[] = [
	{
		id: 'energy-electricity-particle-model-atomic-structure',
		title: 'Energy, electricity, particle model, and atomic structure',
		summary:
			'Build the Paper 1 base: energy stores and transfers, circuits, matter models, density, thermal physics, and radioactivity.',
		specRefs: ['4.1', '4.2', '4.3', '4.4'],
		learningGoals: [
			'Apply equations for energy, power, efficiency, and electricity.',
			'Interpret circuit behaviour and component characteristics.',
			'Explain particle-model and atomic-structure evidence.'
		],
		keyTerms: ['energy store', 'power', 'potential difference', 'density', 'half-life'],
		checkpointPrompts: [
			'Explain why current is conserved in a series circuit.',
			'Use half-life data to estimate source activity.'
		],
		practiceIdeas: [
			'Make an equation recall grid.',
			'Complete circuit graph interpretation questions.'
		],
		estimatedStudyHours: 16
	},
	{
		id: 'forces-waves-magnetism-space',
		title: 'Forces, waves, magnetism, and space physics',
		summary:
			'Move through Paper 2 topics with motion, Newton laws, momentum, wave behaviour, electromagnetism, and the physics-only space unit.',
		specRefs: ['4.5', '4.6', '4.7', '4.8'],
		learningGoals: [
			'Use force, motion, and momentum equations fluently.',
			'Explain wave properties, reflection, refraction, and electromagnetic waves.',
			'Describe magnetic fields, motors, generators, transformers, and space models.'
		],
		keyTerms: ['resultant force', 'momentum', 'wavelength', 'magnetic field', 'red-shift'],
		checkpointPrompts: [
			'Interpret a velocity-time graph and calculate distance.',
			'Explain how a transformer changes potential difference.'
		],
		practiceIdeas: [
			'Do mixed equation questions under timed conditions.',
			'Draw field and wave diagrams.'
		],
		estimatedStudyHours: 18
	}
];

const FALLBACK_UNITS_BY_SUBJECT: Record<SparkPathwaySubject, readonly SparkPathwayUnit[]> = {
	biology: BIOLOGY_FALLBACK_UNITS,
	chemistry: CHEMISTRY_FALLBACK_UNITS,
	physics: PHYSICS_FALLBACK_UNITS
};

export function getPathwayStageOptions(country: SparkLearningCountry): readonly string[] {
	return PATHWAY_SCHOOL_STAGES_BY_COUNTRY[country];
}

export function resolvePathwayCountryLabel(country: SparkLearningCountry): string {
	return PATHWAY_COUNTRIES.find((entry) => entry.value === country)?.label ?? country;
}

export function resolvePathwaySubjectLabel(subject: SparkPathwaySubject): string {
	return PATHWAY_SUBJECTS.find((entry) => entry.value === subject)?.label ?? subject;
}

export function resolvePathwayBoardLabel(board: SparkPathwayExamBoard): string {
	return PATHWAY_EXAM_BOARDS.find((entry) => entry.value === board)?.label ?? board.toUpperCase();
}

export function resolvePathwayProgrammeLabel(programme: SparkPathwayProgramme): string {
	return PATHWAY_PROGRAMMES.find((entry) => entry.value === programme)?.label ?? programme;
}

export function resolvePathwaySourceDocuments(
	selection: Pick<SparkLearningProfileSelection, 'subject' | 'programme' | 'examBoard'>
): SparkPathwaySourceDocument[] {
	if (selection.programme !== 'gcse_triple_science' || selection.examBoard !== 'aqa') {
		return [];
	}
	return [AQA_SEPARATE_SCIENCE_SOURCE_DOCUMENTS[selection.subject]];
}

export function resolveAllPathwaySourceDocuments(): SparkPathwaySourceDocument[] {
	return [
		AQA_SEPARATE_SCIENCE_SOURCE_DOCUMENTS.chemistry,
		AQA_SEPARATE_SCIENCE_SOURCE_DOCUMENTS.biology,
		AQA_SEPARATE_SCIENCE_SOURCE_DOCUMENTS.physics
	];
}

export function buildFallbackPathwayUnits(
	selection: Pick<SparkLearningProfileSelection, 'subject'>
): SparkPathwayUnit[] {
	return FALLBACK_UNITS_BY_SUBJECT[selection.subject].map((unit) => ({ ...unit }));
}

export function resolvePathwayTitle(selection: SparkLearningProfileSelection): string {
	return `${resolvePathwaySubjectLabel(selection.subject)} ${resolvePathwayBoardLabel(
		selection.examBoard
	)} pathway`;
}

export function resolvePathwaySubtitle(selection: SparkLearningProfileSelection): string {
	return [
		resolvePathwayCountryLabel(selection.country),
		selection.schoolStage,
		resolvePathwayProgrammeLabel(selection.programme)
	].join(' · ');
}
