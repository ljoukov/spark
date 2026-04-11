import type { SparkSheetDashboardSubjectTag } from '@spark/schemas';

export type SheetSubjectTheme = {
	color: string;
	accent: string;
	light: string;
	border: string;
};

const CANONICAL_SUBJECT_LABELS: Record<string, string> = {
	biology: 'Biology',
	chemistry: 'Chemistry',
	physics: 'Physics',
	mathematics: 'Mathematics',
	english: 'English',
	science: 'Science',
	history: 'History',
	geography: 'Geography',
	general: 'General'
};

const SUBJECT_ALIASES: Record<string, string> = {
	bio: 'biology',
	biological_science: 'biology',
	biological_sciences: 'biology',
	chem: 'chemistry',
	phys: 'physics',
	math: 'mathematics',
	maths: 'mathematics',
	english_language: 'english',
	english_literature: 'english',
	combined_science: 'science',
	double_science: 'science',
	triple_science: 'science'
};

const SUBJECT_KEYWORD_RULES: Array<{ key: string; patterns: string[] }> = [
	{ key: 'biology', patterns: ['biology', 'biological'] },
	{ key: 'chemistry', patterns: ['chemistry', 'chemical'] },
	{ key: 'physics', patterns: ['physics', 'physical'] },
	{ key: 'mathematics', patterns: ['mathematics', 'maths', 'math'] },
	{ key: 'english', patterns: ['english'] },
	{ key: 'history', patterns: ['history'] },
	{ key: 'geography', patterns: ['geography'] },
	{ key: 'science', patterns: ['science'] }
];

const SUBJECT_THEME_BY_KEY: Record<string, SheetSubjectTheme> = {
	biology: {
		color: '#13795B',
		accent: '#1FA57A',
		light: '#E7F7F0',
		border: '#9FDCC7'
	},
	chemistry: {
		color: '#5B47A6',
		accent: '#7B67C8',
		light: '#F1ECFB',
		border: '#CABEF0'
	},
	physics: {
		color: '#1C5D99',
		accent: '#2E7CC6',
		light: '#E8F1FB',
		border: '#A7C8E8'
	},
	mathematics: {
		color: '#9C2F45',
		accent: '#C94B66',
		light: '#FBE8EC',
		border: '#EDB4C0'
	},
	english: {
		color: '#0F766E',
		accent: '#1AA39A',
		light: '#E5F8F5',
		border: '#9EDFD8'
	},
	science: {
		color: '#2F6B3B',
		accent: '#4B9560',
		light: '#EAF5EC',
		border: '#B7D9BE'
	},
	history: {
		color: '#7A4A1D',
		accent: '#A96A2A',
		light: '#F8ECDC',
		border: '#DEC19E'
	},
	geography: {
		color: '#136F63',
		accent: '#1F9A8C',
		light: '#E5F6F3',
		border: '#A5DDD4'
	}
};

const FALLBACK_THEMES: SheetSubjectTheme[] = [
	{
		color: '#36587A',
		accent: '#4D7AA5',
		light: '#E8F2FB',
		border: '#BFD0E0'
	},
	{
		color: '#7C3A2D',
		accent: '#B35A44',
		light: '#FBEDE9',
		border: '#E8BFB3'
	},
	{
		color: '#6A4B16',
		accent: '#9A7125',
		light: '#F8F1E3',
		border: '#DECDA7'
	},
	{
		color: '#32596B',
		accent: '#49819A',
		light: '#E8F4F8',
		border: '#B8D5E2'
	}
];

function slugifySubjectKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function titleCase(value: string): string {
	return value
		.split(/[\s_-]+/)
		.filter((part) => part.length > 0)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(' ');
}

function hashString(value: string): number {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
	}
	return hash;
}

function resolveCanonicalSubjectLabel(key: string): string | null {
	return CANONICAL_SUBJECT_LABELS[key] ?? null;
}

export function normalizeSheetSubjectKey(value: string): string {
	const slug = slugifySubjectKey(value);
	if (slug.length === 0) {
		return 'general';
	}
	const exactAlias = SUBJECT_ALIASES[slug];
	if (exactAlias) {
		return exactAlias;
	}
	for (const rule of SUBJECT_KEYWORD_RULES) {
		for (const pattern of rule.patterns) {
			if (slug.includes(pattern)) {
				return rule.key;
			}
		}
	}
	return slug;
}

export function buildSheetSubjectTag(label: string): SparkSheetDashboardSubjectTag {
	const trimmed = label.trim();
	const key = normalizeSheetSubjectKey(trimmed);
	return {
		key,
		label: resolveCanonicalSubjectLabel(key) ?? (trimmed.length > 0 ? trimmed : titleCase(key))
	};
}

export function resolveSheetSubjectTheme(subject: {
	key?: string | null;
	label?: string | null;
}): SheetSubjectTheme {
	const normalizedKey = normalizeSheetSubjectKey(subject.key ?? subject.label ?? 'general');
	const knownTheme = SUBJECT_THEME_BY_KEY[normalizedKey];
	if (knownTheme) {
		return knownTheme;
	}
	const fallbackIndex = hashString(normalizedKey) % FALLBACK_THEMES.length;
	return FALLBACK_THEMES[fallbackIndex] ?? FALLBACK_THEMES[0];
}

export function resolveSheetSubjectLabel(subject: {
	key?: string | null;
	label?: string | null;
}): string {
	const canonicalLabel = resolveCanonicalSubjectLabel(
		normalizeSheetSubjectKey(subject.key ?? subject.label ?? 'general')
	);
	if (canonicalLabel) {
		return canonicalLabel;
	}
	const label = subject.label?.trim();
	if (label && label.length > 0) {
		return label;
	}
	return titleCase(normalizeSheetSubjectKey(subject.key ?? 'general'));
}
