import { readable } from 'svelte/store';

export type SparkSubject = 'Biology' | 'Chemistry' | 'Physics';

export interface SparkProgressRow {
	subject: SparkSubject;
	percent: number;
	delta: number;
	streakDays: number;
	focusCount: number;
}

export interface SparkUpload {
	id: string;
	title: string;
	subject: SparkSubject | 'Mixed';
	specCodes: string;
	items: number;
	lastUsed: string;
	createdAt: string;
	color: string;
}

export interface SparkSessionSummary {
	status: 'resume' | 'next';
	subject: SparkSubject;
	sourceTitle: string;
	total: number;
	remaining?: number;
	scope: 'This upload' | 'Cross-doc';
	timer: boolean;
}

export interface SparkFocusSet {
	title: string;
	count: number;
	subject: SparkSubject;
	description: string;
}

export interface SparkQuizItem {
	id: string;
	stem: string;
	media?: string;
	choices: string[];
	answer: number;
}

const uploads: SparkUpload[] = [
	{
		id: 'upl-01',
		title: 'Electrolysis Master Notes',
		subject: 'Chemistry',
		specCodes: 'AQA C4 • OCR Gateway C6',
		items: 42,
		lastUsed: '2h ago',
		createdAt: 'Mar 18',
		color: 'from-sky-400/80 to-slate-800/90'
	},
	{
		id: 'upl-02',
		title: 'Cell Biology Flash Pack',
		subject: 'Biology',
		specCodes: 'AQA B1 • Edexcel B2',
		items: 58,
		lastUsed: 'Yesterday',
		createdAt: 'Mar 16',
		color: 'from-emerald-400/85 to-teal-900/90'
	},
	{
		id: 'upl-03',
		title: 'Forces & Motion Workbook',
		subject: 'Physics',
		specCodes: 'AQA P5 • OCR P6',
		items: 36,
		lastUsed: '3 days ago',
		createdAt: 'Mar 14',
		color: 'from-indigo-400/80 to-slate-900/90'
	},
	{
		id: 'upl-04',
		title: 'Organic Chemistry Posters',
		subject: 'Chemistry',
		specCodes: 'Edexcel C7 • OCR B C8',
		items: 27,
		lastUsed: '5 days ago',
		createdAt: 'Mar 10',
		color: 'from-rose-400/85 to-fuchsia-900/90'
	},
	{
		id: 'upl-05',
		title: 'Required Practicals Digest',
		subject: 'Mixed',
		specCodes: 'All boards',
		items: 64,
		lastUsed: '1 week ago',
		createdAt: 'Mar 8',
		color: 'from-amber-400/85 to-orange-900/90'
	}
];

const progressRows: SparkProgressRow[] = [
	{ subject: 'Biology', percent: 74, delta: 6, streakDays: 8, focusCount: 12 },
	{ subject: 'Chemistry', percent: 68, delta: 4, streakDays: 5, focusCount: 9 },
	{ subject: 'Physics', percent: 61, delta: 3, streakDays: 4, focusCount: 11 }
];

const session: SparkSessionSummary = {
	status: 'resume',
	subject: 'Chemistry',
	sourceTitle: 'Electrolysis Master Notes',
	total: 25,
	remaining: 13,
	scope: 'Cross-doc',
	timer: true
};

const focusSets: SparkFocusSet[] = [
	{
		title: 'Finish Electrolysis',
		count: 7,
		subject: 'Chemistry',
		description: 'Wrap up redox half reactions and electrode labels.'
	},
	{
		title: 'Do Focus 5',
		count: 5,
		subject: 'Biology',
		description: 'Practice osmosis calculations flagged from last run.'
	},
	{
		title: 'Revise Motion Graphs',
		count: 6,
		subject: 'Physics',
		description: 'Quick fire velocity-time graph interpretations.'
	}
];

const quizItems: SparkQuizItem[] = [
	{
		id: 'item-01',
		stem: 'During electrolysis of molten lead(II) bromide, which ion is discharged at the cathode?',
		choices: ['Lead ions', 'Bromide ions', 'Hydrogen ions', 'Hydroxide ions'],
		answer: 0
	},
	{
		id: 'item-02',
		stem: 'State why graphite is used for electrodes in electrolysis.',
		choices: [
			'Graphite is a good insulator',
			'Graphite conducts electricity and is inert',
			'Graphite reacts with electrolyte to form oxygen',
			'Graphite is magnetic'
		],
		answer: 1
	}
];

export const sparkUploadsStore = readable(uploads);
export const sparkProgressStore = readable({
	overall: 71,
	trendLabel: '+4 this week',
	weeklyMinutes: 166,
	progressRows
});

export const sparkSessionStore = readable(session);
export const sparkFocusStore = readable(focusSets);
export const sparkQuizStore = readable({
	total: 25,
	duration: 'Timed',
	datasetTitle: session.sourceTitle,
	items: quizItems
});

export const sparkUser = readable({
	name: 'Maya Patel',
	avatar: 'https://i.pravatar.cc/120?img=47'
});

export const sparkDetectionPreview = readable({
	source: 'Photo',
	pages: 3,
	estimatedItems: 32,
	preview: ['Electrolysis overview', 'Half equations drill', 'Exam style checks']
});
