export const DIAGNOSTIC_TOPICS = [
	{ value: 'olympiad_math', label: 'Olympiad math', subjectLabel: 'Mathematics' },
	{ value: 'physics', label: 'Physics', subjectLabel: 'Physics' },
	{ value: 'biology', label: 'Biology', subjectLabel: 'Biology' },
	{ value: 'chemistry', label: 'Chemistry', subjectLabel: 'Chemistry' }
] as const;

export const DIAGNOSTIC_COUNTRIES = [
	{ value: 'UK', label: 'UK', levelLabel: 'Year or A-level stage' },
	{ value: 'USA', label: 'USA', levelLabel: 'Grade or course stage' },
	{ value: 'Canada', label: 'Canada', levelLabel: 'Grade or course stage' },
	{ value: 'Australia', label: 'Australia', levelLabel: 'Year or senior stage' },
	{ value: 'Singapore', label: 'Singapore', levelLabel: 'School stage' }
] as const;

export const DIAGNOSTIC_LEVEL_OPTIONS_BY_COUNTRY = {
	UK: [
		'Year 3',
		'Year 4',
		'Year 5',
		'Year 6',
		'Year 7',
		'Year 8',
		'Year 9',
		'Year 10',
		'Year 11',
		'A-level Year 12',
		'A-level Year 13'
	],
	USA: [
		'Grade 3',
		'Grade 4',
		'Grade 5',
		'Grade 6',
		'Grade 7',
		'Grade 8',
		'Grade 9',
		'Grade 10',
		'Grade 11',
		'Grade 12',
		'AP / advanced high school'
	],
	Canada: [
		'Grade 3',
		'Grade 4',
		'Grade 5',
		'Grade 6',
		'Grade 7',
		'Grade 8',
		'Grade 9',
		'Grade 10',
		'Grade 11',
		'Grade 12',
		'Pre-university / CEGEP'
	],
	Australia: [
		'Year 3',
		'Year 4',
		'Year 5',
		'Year 6',
		'Year 7',
		'Year 8',
		'Year 9',
		'Year 10',
		'Year 11',
		'Year 12'
	],
	Singapore: [
		'Primary 3',
		'Primary 4',
		'Primary 5',
		'Primary 6',
		'Secondary 1',
		'Secondary 2',
		'Secondary 3',
		'Secondary 4',
		'Junior College 1',
		'Junior College 2'
	]
} as const;

export type DiagnosticTopic = (typeof DIAGNOSTIC_TOPICS)[number]['value'];
export type DiagnosticCountry = (typeof DIAGNOSTIC_COUNTRIES)[number]['value'];
export type DiagnosticStartMode = 'fresh' | 'progress';

export function resolveDiagnosticTopicLabel(topic: DiagnosticTopic): string {
	return DIAGNOSTIC_TOPICS.find((entry) => entry.value === topic)?.label ?? 'Diagnostic';
}

export function resolveDiagnosticPaperSubject(topic: DiagnosticTopic): string {
	return DIAGNOSTIC_TOPICS.find((entry) => entry.value === topic)?.subjectLabel ?? 'General';
}

export function resolveDiagnosticCountryLabel(country: DiagnosticCountry): string {
	return DIAGNOSTIC_COUNTRIES.find((entry) => entry.value === country)?.label ?? country;
}

export function resolveDiagnosticLevelLabel(country: DiagnosticCountry): string {
	return DIAGNOSTIC_COUNTRIES.find((entry) => entry.value === country)?.levelLabel ?? 'School stage';
}

export function getDiagnosticLevelOptions(country: DiagnosticCountry): readonly string[] {
	return DIAGNOSTIC_LEVEL_OPTIONS_BY_COUNTRY[country];
}

export function isDiagnosticLevelForCountry(country: DiagnosticCountry, level: string): boolean {
	return getDiagnosticLevelOptions(country).includes(level);
}
