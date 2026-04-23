import {
	countPaperSheetQuestions,
	sumPaperSheetMarks,
	type PaperSheetData,
	type SparkGraderWorksheetReport,
	type SparkSolveSheetAnswers,
	type SparkSolveSheetDraft
} from '@spark/schemas';

import { buildGraderRunDisplay } from './presentation';
import {
	safeParseGraderWorksheetReport,
	safeParseSolveSheetAnswers,
	safeParseSolveSheetDraft
} from './problemReport';
import { getWorkspaceTextFile, listGraderRuns, type SparkGraderRun } from './repo';

export const STUDENT_SHEETS_ROOT = 'student-sheets' as const;
const MAX_STUDENT_SHEET_FILES = 100;

export type StudentSheetVirtualFile = {
	path: string;
	content: string;
	contentType: 'text/markdown' | 'application/json';
};

export type StudentSheetDirectoryEntry = {
	name: string;
	path: string;
	type: 'file' | 'directory';
};

export type StudentSheetGrepMatch = {
	path: string;
	lineNumber: number;
	snippet: string;
};

type LoadedStudentSheet = {
	run: SparkGraderRun;
	pathSegment: string;
	sheetPhase: 'building' | 'solving' | 'grading' | 'graded';
	canonicalArtifactPath: string;
	artifactRaw: string | null;
	report: SparkGraderWorksheetReport | null;
	draft: SparkSolveSheetDraft | null;
	draftAnswersRaw: string | null;
	draftAnswers: SparkSolveSheetAnswers | null;
	sheet: PaperSheetData | null;
};

function sanitizePathSegment(value: string): string {
	const cleaned = value
		.trim()
		.replace(/[^a-z0-9._-]+/giu, '-')
		.replace(/-{2,}/gu, '-')
		.replace(/^-+|-+$/gu, '');
	if (cleaned.length > 0) {
		return cleaned;
	}
	return 'sheet';
}

function normalizeVirtualPath(value: string | undefined): string {
	const normalized = (value ?? STUDENT_SHEETS_ROOT)
		.replace(/\\/gu, '/')
		.replace(/^\/+/u, '')
		.replace(/\/+$/u, '')
		.trim();
	if (normalized.length === 0) {
		return STUDENT_SHEETS_ROOT;
	}
	return normalized;
}

function deriveSheetPhase(options: {
	run: SparkGraderRun;
	report: SparkGraderWorksheetReport | null;
	draft: SparkSolveSheetDraft | null;
}): LoadedStudentSheet['sheetPhase'] {
	if (options.run.sheetPhase) {
		return options.run.sheetPhase;
	}
	if (options.report) {
		return 'graded';
	}
	if (options.draft) {
		return 'solving';
	}
	if (options.run.status === 'created' || options.run.status === 'executing') {
		return 'grading';
	}
	if (options.run.status === 'done') {
		return 'graded';
	}
	return 'grading';
}

function formatDate(value: Date): string {
	return value.toISOString();
}

function countAnswers(value: SparkSolveSheetAnswers | null): number {
	if (!value) {
		return 0;
	}
	return Object.keys(value.answers).length;
}

function renderSectionSummary(sheet: PaperSheetData | null): string[] {
	if (!sheet) {
		return ['- No published sheet artifact was available yet.'];
	}
	const lines: string[] = [];
	for (const section of sheet.sections) {
		if (!('id' in section)) {
			continue;
		}
		const questionCount = countPaperSheetQuestions(section.questions);
		const marks = sumPaperSheetMarks(section.questions);
		lines.push(
			`- ${section.id}: ${section.label} (${questionCount.toString()} question${questionCount === 1 ? '' : 's'}, ${marks.toString()} mark${marks === 1 ? '' : 's'})`
		);
	}
	if (lines.length === 0) {
		return ['- No content sections were found in the sheet artifact.'];
	}
	return lines;
}

function renderSheetSummaryFile(record: LoadedStudentSheet): string {
	const display = buildGraderRunDisplay({
		status: record.run.status,
		sheetPhase: record.sheetPhase,
		paper: record.run.paper,
		presentation: record.run.presentation,
		resultSummary: record.run.resultSummary ?? null
	});
	const sheet = record.sheet;
	const lines: string[] = [
		`# ${display.title}`,
		'',
		`- Run ID: ${record.run.id}`,
		`- Status: ${record.run.status}`,
		`- Sheet phase: ${record.sheetPhase}`,
		`- Created: ${formatDate(record.run.createdAt)}`,
		`- Updated: ${formatDate(record.run.updatedAt)}`,
		`- Open: /spark/sheets/${record.run.id}`,
		`- Canonical artifact: ${record.canonicalArtifactPath}`
	];
	if (record.artifactRaw) {
		lines.push(`- Virtual artifact file: ${STUDENT_SHEETS_ROOT}/${record.pathSegment}/sheet.json`);
	}
	if (record.run.userPrompt) {
		lines.push(`- Original request: ${record.run.userPrompt}`);
	}
	if (sheet) {
		lines.push(`- Subject: ${sheet.subject}`, `- Level: ${sheet.level}`, `- Title: ${sheet.title}`);
		if (sheet.subtitle.trim().length > 0) {
			lines.push(`- Subtitle: ${sheet.subtitle}`);
		}
	}
	if (record.run.totals) {
		const percentage =
			record.run.totals.percentage ??
			(record.run.totals.maxMarks > 0
				? (record.run.totals.awardedMarks / record.run.totals.maxMarks) * 100
				: null);
		const percentText = percentage === null ? '' : ` (${Math.round(percentage).toString()}%)`;
		lines.push(
			`- Score: ${record.run.totals.awardedMarks.toString()}/${record.run.totals.maxMarks.toString()}${percentText}`
		);
	}
	if (record.draftAnswers) {
		lines.push(`- Saved draft answers: ${countAnswers(record.draftAnswers).toString()}`);
	}
	if (display.summaryMarkdown) {
		lines.push('', '## Summary', '', display.summaryMarkdown);
	}
	lines.push('', '## Sections', '', ...renderSectionSummary(sheet));
	if (record.report) {
		lines.push(
			'',
			'## Review',
			'',
			`- Mode: ${record.report.review.mode ?? 'graded'}`,
			`- Label: ${record.report.review.label}`,
			`- Message: ${record.report.review.message}`
		);
		if (record.report.review.note.trim().length > 0) {
			lines.push(`- Note: ${record.report.review.note}`);
		}
	}
	return lines.join('\n').trim().concat('\n');
}

function renderIndex(records: LoadedStudentSheet[]): string {
	const lines: string[] = [
		'# Student Sheets',
		'',
		"These virtual files expose the learner's Spark sheets for chat and worksheet planning.",
		'Use the summaries first, then read a sheet JSON only when you need detailed structure, answers, or grading feedback.',
		''
	];
	if (records.length === 0) {
		lines.push('No Spark sheets were found for this learner yet.');
		return lines.join('\n').trim().concat('\n');
	}
	for (const record of records) {
		const display = buildGraderRunDisplay({
			status: record.run.status,
			sheetPhase: record.sheetPhase,
			paper: record.run.paper,
			presentation: record.run.presentation,
			resultSummary: record.run.resultSummary ?? null
		});
		const subject = record.sheet?.subject ? ` · ${record.sheet.subject}` : '';
		const score = record.run.totals
			? ` · ${record.run.totals.awardedMarks.toString()}/${record.run.totals.maxMarks.toString()}`
			: '';
		lines.push(
			`- ${display.title}${subject}${score}`,
			`  - runId: ${record.run.id}`,
			`  - phase: ${record.sheetPhase}`,
			`  - created: ${formatDate(record.run.createdAt)}`,
			`  - summary: ${STUDENT_SHEETS_ROOT}/${record.pathSegment}/summary.md`
		);
		if (record.artifactRaw) {
			lines.push(`  - sheet: ${STUDENT_SHEETS_ROOT}/${record.pathSegment}/sheet.json`);
		}
		if (record.draftAnswersRaw) {
			lines.push(`  - answers: ${STUDENT_SHEETS_ROOT}/${record.pathSegment}/answers.json`);
		}
	}
	return lines.join('\n').trim().concat('\n');
}

async function loadStudentSheetRecord(
	userId: string,
	run: SparkGraderRun
): Promise<LoadedStudentSheet> {
	const canonicalArtifactPath = run.sheet?.filePath ?? run.sheetPath;
	const artifactRaw = await getWorkspaceTextFile(userId, run.workspaceId, canonicalArtifactPath);
	const report = artifactRaw ? safeParseGraderWorksheetReport(artifactRaw) : null;
	const draft = artifactRaw ? safeParseSolveSheetDraft(artifactRaw) : null;
	const draftAnswersRaw =
		run.draftAnswersPath && run.draftAnswersPath.trim().length > 0
			? await getWorkspaceTextFile(userId, run.workspaceId, run.draftAnswersPath)
			: null;
	const draftAnswers = draftAnswersRaw ? safeParseSolveSheetAnswers(draftAnswersRaw) : null;
	const sheet = report?.sheet ?? draft?.sheet ?? null;
	const sheetPhase = deriveSheetPhase({ run, report, draft });
	return {
		run,
		pathSegment: sanitizePathSegment(run.id),
		sheetPhase,
		canonicalArtifactPath,
		artifactRaw,
		report,
		draft,
		draftAnswersRaw,
		draftAnswers,
		sheet
	};
}

export async function loadStudentSheetVirtualFiles(
	userId: string,
	options: { limit?: number } = {}
): Promise<StudentSheetVirtualFile[]> {
	const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_STUDENT_SHEET_FILES);
	const runs = await listGraderRuns(userId, limit);
	const records = await Promise.all(runs.map((run) => loadStudentSheetRecord(userId, run)));
	const files: StudentSheetVirtualFile[] = [
		{
			path: `${STUDENT_SHEETS_ROOT}/index.md`,
			content: renderIndex(records),
			contentType: 'text/markdown'
		}
	];
	for (const record of records) {
		files.push({
			path: `${STUDENT_SHEETS_ROOT}/${record.pathSegment}/summary.md`,
			content: renderSheetSummaryFile(record),
			contentType: 'text/markdown'
		});
		if (record.artifactRaw) {
			files.push({
				path: `${STUDENT_SHEETS_ROOT}/${record.pathSegment}/sheet.json`,
				content: record.artifactRaw.trimEnd().concat('\n'),
				contentType: 'application/json'
			});
		}
		if (record.draftAnswersRaw) {
			files.push({
				path: `${STUDENT_SHEETS_ROOT}/${record.pathSegment}/answers.json`,
				content: record.draftAnswersRaw.trimEnd().concat('\n'),
				contentType: 'application/json'
			});
		}
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function listStudentSheetVirtualDirectory(options: {
	files: readonly StudentSheetVirtualFile[];
	path?: string;
}): StudentSheetDirectoryEntry[] {
	const targetPath = normalizeVirtualPath(options.path);
	const prefix = `${targetPath}/`;
	const entriesByPath = new Map<string, StudentSheetDirectoryEntry>();
	for (const file of options.files) {
		if (file.path === targetPath) {
			entriesByPath.set(file.path, {
				name: file.path.split('/').pop() ?? file.path,
				path: file.path,
				type: 'file'
			});
			continue;
		}
		if (!file.path.startsWith(prefix)) {
			continue;
		}
		const rest = file.path.slice(prefix.length);
		const slashIndex = rest.indexOf('/');
		if (slashIndex === -1) {
			entriesByPath.set(file.path, {
				name: rest,
				path: file.path,
				type: 'file'
			});
			continue;
		}
		const directoryName = rest.slice(0, slashIndex);
		const directoryPath = `${prefix}${directoryName}`;
		entriesByPath.set(directoryPath, {
			name: directoryName,
			path: directoryPath,
			type: 'directory'
		});
	}
	return [...entriesByPath.values()].sort((left, right) => {
		if (left.type !== right.type) {
			return left.type === 'directory' ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});
}

export function readStudentSheetVirtualFile(options: {
	files: readonly StudentSheetVirtualFile[];
	path: string;
	maxChars?: number;
}): StudentSheetVirtualFile | null {
	const targetPath = normalizeVirtualPath(options.path);
	const file = options.files.find((entry) => entry.path === targetPath);
	if (!file) {
		return null;
	}
	if (options.maxChars && options.maxChars > 0 && file.content.length > options.maxChars) {
		return {
			...file,
			content: file.content.slice(0, options.maxChars).trimEnd().concat('\n[truncated]\n')
		};
	}
	return file;
}

export function grepStudentSheetVirtualFiles(options: {
	files: readonly StudentSheetVirtualFile[];
	query: string;
	path?: string;
	maxResults?: number;
}): StudentSheetGrepMatch[] {
	const query = options.query.trim().toLowerCase();
	if (query.length === 0) {
		return [];
	}
	const targetPath = normalizeVirtualPath(options.path);
	const prefix = targetPath === STUDENT_SHEETS_ROOT ? `${STUDENT_SHEETS_ROOT}/` : `${targetPath}/`;
	const maxResults = Math.min(Math.max(options.maxResults ?? 20, 1), 100);
	const matches: StudentSheetGrepMatch[] = [];
	for (const file of options.files) {
		if (file.path !== targetPath && !file.path.startsWith(prefix)) {
			continue;
		}
		const lines = file.content.split(/\r?\n/u);
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index] ?? '';
			if (!line.toLowerCase().includes(query)) {
				continue;
			}
			matches.push({
				path: file.path,
				lineNumber: index + 1,
				snippet: line.trim().slice(0, 500)
			});
			if (matches.length >= maxResults) {
				return matches;
			}
		}
	}
	return matches;
}

export function renderStudentSheetWorkspaceBrief(
	files: readonly StudentSheetVirtualFile[]
): string {
	const sheetCount = files.filter((file) => file.path.endsWith('/summary.md')).length;
	return [
		'## Existing Spark sheet filesystem',
		`- ${sheetCount.toString()} existing sheet${sheetCount === 1 ? '' : 's'} were copied into this workspace under \`${STUDENT_SHEETS_ROOT}/\`.`,
		`- Start with \`${STUDENT_SHEETS_ROOT}/index.md\` to see the available sheets.`,
		'- Read relevant `summary.md`, `sheet.json`, and `answers.json` files before choosing or drafting a follow-up sheet.',
		'- For next-sheet requests, avoid repeating an existing topic unless the learner explicitly asked to remake or practise the same unit.'
	]
		.join('\n')
		.trim()
		.concat('\n');
}
