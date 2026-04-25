import { env } from '$env/dynamic/private';
import {
	buildFallbackPathwayUnits,
	resolvePathwayBoardLabel,
	resolvePathwayCountryLabel,
	resolvePathwayProgrammeLabel,
	resolvePathwaySourceDocuments,
	resolvePathwaySubjectLabel,
	resolvePathwaySubtitle,
	resolvePathwayTitle
} from '$lib/pathways/catalog';
import {
	getFirestoreDocument,
	listFirestoreDocuments,
	patchFirestoreDocument,
	setFirestoreDocument
} from '$lib/server/gcp/firestoreRest';
import { createGraderRun, patchGraderRun } from '$lib/server/grader/repo';
import {
	loadStudentSheetVirtualFiles,
	renderStudentSheetWorkspaceBrief
} from '$lib/server/grader/studentSheetFiles';
import {
	buildSparkSheetDraftLaunchPlan,
	createTask,
	generateText,
	parseJsonFromLlmText,
	resolveWorkspacePathContentType,
	SPARK_GRADER_UPLOADS_MANIFEST_PATH,
	upsertWorkspaceTextFileDoc,
	type LlmTextModelId
} from '@spark/llm';
import {
	SparkLearningProfileSelectionSchema,
	SparkPathwayDocumentSchema,
	SparkPathwayUnitSchema,
	type SparkLearningProfileSelection,
	type SparkPathwayDocument,
	type SparkPathwaySourceDocument,
	type SparkPathwayUnit,
	type SparkPathwayWorksheetRun
} from '@spark/schemas';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import sheetTaskTemplate from '$lib/server/sheetAgent/task-template.md?raw';

const PATHWAY_SCHEMA_VERSION = 1;
const PATHWAY_MODEL_ID: LlmTextModelId = 'chatgpt-gpt-5.4-fast';
const MAX_REFERENCE_CHARS = 24_000;
const MAX_GENERATION_NOTE_CHARS = 900;
const PATHWAY_LIST_LIMIT = 25;

export class UnsupportedPathwaySelectionError extends Error {
	constructor() {
		super('unsupported_pathway_selection');
		this.name = 'UnsupportedPathwaySelectionError';
	}
}

export class PathwayNotFoundError extends Error {
	constructor() {
		super('pathway_not_found');
		this.name = 'PathwayNotFoundError';
	}
}

export class PathwayCompleteError extends Error {
	constructor() {
		super('pathway_complete');
		this.name = 'PathwayCompleteError';
	}
}

const generatedPathwaySchema = z
	.object({
		title: z.string().trim().min(1).max(120),
		subtitle: z.string().trim().min(1).max(180),
		overview: z.string().trim().min(1).max(1800),
		units: z.array(SparkPathwayUnitSchema).min(2).max(10),
		generationNotes: z.string().trim().min(1).max(1000).optional()
	})
	.strict();

export type PathwayClientWorksheetRun = Omit<SparkPathwayWorksheetRun, 'createdAt'> & {
	createdAt: string;
};

export type PathwayClientDocument = Omit<
	SparkPathwayDocument,
	'createdAt' | 'updatedAt' | 'generatedAt' | 'worksheetRuns'
> & {
	createdAt: string;
	updatedAt: string;
	generatedAt: string;
	worksheetRuns: PathwayClientWorksheetRun[];
};

export type PathwaySheetLaunchResult = {
	runId: string;
	href: string;
	pathway: SparkPathwayDocument;
};

function getServiceAccountJson(): string | null {
	const value = env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!value || value.trim().length === 0) {
		return null;
	}
	return value;
}

function requireServiceAccountJson(): string {
	const value = getServiceAccountJson();
	if (!value) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
	}
	return value;
}

function requireTasksEnv(): { serviceUrl: string; apiKey: string } {
	const serviceUrl = env.TASKS_SERVICE_URL;
	if (!serviceUrl || serviceUrl.trim().length === 0) {
		throw new Error('TASKS_SERVICE_URL is missing');
	}
	const apiKey = env.TASKS_API_KEY;
	if (!apiKey || apiKey.trim().length === 0) {
		throw new Error('TASKS_API_KEY is missing');
	}
	return { serviceUrl, apiKey };
}

export function hasPathwayPersistenceConfig(): boolean {
	return getServiceAccountJson() !== null;
}

function pathwayCollectionPath(userId: string): string {
	return `spark/${userId}/pathways`;
}

function pathwayDocumentPath(userId: string, pathwayId: string): string {
	return `${pathwayCollectionPath(userId)}/${pathwayId}`;
}

function learningProfileDocumentPath(userId: string): string {
	return `spark/${userId}/profile/learning`;
}

function docIdFromPath(documentPath: string): string {
	const parts = documentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? documentPath;
}

function toIso(value: Date): string {
	return value.toISOString();
}

export function serializePathwayForClient(pathway: SparkPathwayDocument): PathwayClientDocument {
	return {
		...pathway,
		createdAt: toIso(pathway.createdAt),
		updatedAt: toIso(pathway.updatedAt),
		generatedAt: toIso(pathway.generatedAt),
		worksheetRuns: pathway.worksheetRuns.map((run) => ({
			...run,
			createdAt: toIso(run.createdAt)
		}))
	};
}

export function serializePathwaysForClient(
	pathways: SparkPathwayDocument[]
): PathwayClientDocument[] {
	return pathways.map((pathway) => serializePathwayForClient(pathway));
}

function parsePathwayDocument(
	documentPath: string,
	data: Record<string, unknown>
): SparkPathwayDocument | null {
	const parsed = SparkPathwayDocumentSchema.safeParse({
		id: docIdFromPath(documentPath),
		...data
	});
	if (!parsed.success) {
		console.warn('[pathways] skipping invalid pathway document', {
			documentPath,
			issues: parsed.error.issues
		});
		return null;
	}
	return parsed.data;
}

export async function listPathwaysForUser(userId: string): Promise<SparkPathwayDocument[]> {
	const serviceAccountJson = getServiceAccountJson();
	if (!serviceAccountJson) {
		return [];
	}

	const docs = await listFirestoreDocuments({
		serviceAccountJson,
		collectionPath: pathwayCollectionPath(userId),
		limit: PATHWAY_LIST_LIMIT,
		orderBy: 'createdAt desc'
	});

	const pathways: SparkPathwayDocument[] = [];
	for (const doc of docs) {
		const pathway = parsePathwayDocument(doc.documentPath, doc.data);
		if (pathway) {
			pathways.push(pathway);
		}
	}

	return pathways.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export async function getPathwayForUser(options: {
	userId: string;
	pathwayId: string;
}): Promise<SparkPathwayDocument | null> {
	const serviceAccountJson = getServiceAccountJson();
	if (!serviceAccountJson) {
		return null;
	}

	const snapshot = await getFirestoreDocument({
		serviceAccountJson,
		documentPath: pathwayDocumentPath(options.userId, options.pathwayId)
	});
	if (!snapshot.exists || !snapshot.data) {
		return null;
	}
	return parsePathwayDocument(pathwayDocumentPath(options.userId, options.pathwayId), snapshot.data);
}

function resolveRepositoryRelativePath(relativePath: string): string[] {
	return [resolve(process.cwd(), relativePath), resolve(process.cwd(), '..', relativePath)];
}

async function readFirstExistingText(relativePath: string): Promise<string | null> {
	for (const candidate of resolveRepositoryRelativePath(relativePath)) {
		try {
			return await readFile(candidate, 'utf8');
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				continue;
			}
			console.warn('[pathways] failed to read cached curriculum text', { candidate, error });
			return null;
		}
	}
	return null;
}

function normalizeReferenceText(value: string): string {
	return value
		.replace(/\r/gu, '')
		.replace(/[ \t]+\n/gu, '\n')
		.replace(/\n{3,}/gu, '\n\n')
		.trim();
}

function truncateText(value: string, maxChars: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= maxChars) {
		return trimmed;
	}
	return trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringValue(value: unknown, fallback: string, maxChars: number): string {
	if (typeof value !== 'string') {
		return fallback;
	}
	const normalized = truncateText(value, maxChars);
	return normalized.length > 0 ? normalized : fallback;
}

function normalizeStringArray(
	value: unknown,
	maxItems: number,
	maxChars: number,
	fallback: readonly string[]
): string[] {
	const rawValues = Array.isArray(value) ? value : fallback;
	const normalized: string[] = [];
	for (const rawValue of rawValues) {
		if (typeof rawValue !== 'string') {
			continue;
		}
		const next = truncateText(rawValue, maxChars);
		if (next.length === 0) {
			continue;
		}
		normalized.push(next);
		if (normalized.length >= maxItems) {
			break;
		}
	}
	if (normalized.length > 0) {
		return normalized;
	}
	return fallback.slice(0, maxItems);
}

function slugifyPathwayUnit(value: string, fallbackIndex: number): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	return slug.length > 0 ? slug : `unit-${(fallbackIndex + 1).toString()}`;
}

function normalizeEstimatedHours(value: unknown, fallback: number): number {
	const numericValue = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(numericValue)) {
		return fallback;
	}
	return Math.min(40, Math.max(1, Math.round(numericValue)));
}

function normalizeGeneratedUnit(
	value: unknown,
	index: number,
	fallback: SparkPathwayUnit
): SparkPathwayUnit {
	const record = isRecord(value) ? value : {};
	const title = normalizeStringValue(record.title, fallback.title, 140);
	return {
		id: slugifyPathwayUnit(normalizeStringValue(record.id, title, 80), index),
		title,
		summary: normalizeStringValue(record.summary, fallback.summary, 800),
		specRefs: normalizeStringArray(record.specRefs, 12, 40, fallback.specRefs),
		learningGoals: normalizeStringArray(record.learningGoals, 8, 220, fallback.learningGoals),
		keyTerms: normalizeStringArray(record.keyTerms, 12, 80, fallback.keyTerms),
		checkpointPrompts: normalizeStringArray(
			record.checkpointPrompts,
			6,
			240,
			fallback.checkpointPrompts
		),
		practiceIdeas: normalizeStringArray(record.practiceIdeas, 6, 240, fallback.practiceIdeas),
		estimatedStudyHours: normalizeEstimatedHours(
			record.estimatedStudyHours,
			fallback.estimatedStudyHours
		)
	};
}

function normalizeGeneratedPathwayPayload(
	value: unknown,
	fallbackUnits: readonly SparkPathwayUnit[]
): unknown {
	const record = isRecord(value) ? value : {};
	const rawUnits = Array.isArray(record.units) ? record.units.slice(0, 10) : [];
	const units =
		rawUnits.length > 0
			? rawUnits.map((unit, index) =>
					normalizeGeneratedUnit(unit, index, fallbackUnits[index] ?? fallbackUnits[0]!)
				)
			: fallbackUnits.map((unit) => ({ ...unit }));
	return {
		...record,
		title: normalizeStringValue(record.title, 'Study path', 120),
		subtitle: normalizeStringValue(record.subtitle, 'Worksheet route', 180),
		overview: normalizeStringValue(record.overview, 'A structured worksheet progression.', 1800),
		units,
		...(typeof record.generationNotes === 'string'
			? { generationNotes: truncateText(record.generationNotes, MAX_GENERATION_NOTE_CHARS) }
			: {})
	};
}

function extractReferenceExcerpt(text: string): string {
	const normalized = normalizeReferenceText(text);
	const lower = normalized.toLowerCase();
	const start = lower.indexOf('4.0 subject content');
	const end = start >= 0 ? lower.indexOf('5.0 scheme of assessment', start) : -1;
	const relevant = start >= 0 && end > start ? normalized.slice(start, end) : normalized;
	return relevant.slice(0, MAX_REFERENCE_CHARS).trim();
}

async function loadReferenceText(
	sourceDocuments: readonly SparkPathwaySourceDocument[]
): Promise<string | null> {
	const excerpts: string[] = [];
	for (const sourceDocument of sourceDocuments) {
		if (!sourceDocument.textCachePath) {
			continue;
		}
		const text = await readFirstExistingText(sourceDocument.textCachePath);
		if (!text) {
			continue;
		}
		excerpts.push(
			[
				`# ${sourceDocument.title}`,
				`Source: ${sourceDocument.sourceUrl}`,
				extractReferenceExcerpt(text)
			].join('\n\n')
		);
	}
	if (excerpts.length === 0) {
		return null;
	}
	return excerpts.join('\n\n---\n\n').slice(0, MAX_REFERENCE_CHARS);
}

function buildFallbackPathway(options: {
	id: string;
	selection: SparkLearningProfileSelection;
	sourceDocuments: SparkPathwaySourceDocument[];
	now: Date;
	error?: string;
}): SparkPathwayDocument {
	const units = buildFallbackPathwayUnits(options.selection);
	return SparkPathwayDocumentSchema.parse({
		id: options.id,
		schemaVersion: PATHWAY_SCHEMA_VERSION,
		status: 'ready',
		selection: options.selection,
		title: resolvePathwayTitle(options.selection),
		subtitle: resolvePathwaySubtitle(options.selection),
		overview: [
			`A structured ${resolvePathwaySubjectLabel(options.selection.subject)} route for ${
				options.selection.schoolStage
			} ${resolvePathwayProgrammeLabel(options.selection.programme)}.`,
			`It follows the official ${resolvePathwayBoardLabel(
				options.selection.examBoard
			)} separate-science specification order and keeps checkpoints close to GCSE assessment style.`
		].join(' '),
		units,
		sourceDocuments: options.sourceDocuments,
		worksheetRuns: [],
		generationNotes: options.error
			? truncateText(
					`Used the built-in AQA topic outline because pathway structuring failed: ${options.error}`,
					MAX_GENERATION_NOTE_CHARS
				)
			: 'Built from the cached AQA topic outline.',
		createdAt: options.now,
		updatedAt: options.now,
		generatedAt: options.now
	});
}

function buildPathwayGenerationPrompt(options: {
	selection: SparkLearningProfileSelection;
	sourceDocuments: readonly SparkPathwaySourceDocument[];
	referenceText: string | null;
	fallbackUnits: readonly SparkPathwayUnit[];
}): string {
	const { selection } = options;
	return [
		'You are the Spark Pathways curriculum agent.',
		'Structure a practical learner pathway from official curriculum material.',
		'Write in UK English.',
		'Return JSON only.',
		'',
		'Learner profile:',
		`- Country: ${resolvePathwayCountryLabel(selection.country)}`,
		`- School stage: ${selection.schoolStage}`,
		`- Qualification: ${selection.qualification.toUpperCase()}`,
		`- Programme: ${resolvePathwayProgrammeLabel(selection.programme)}`,
		`- Subject: ${resolvePathwaySubjectLabel(selection.subject)}`,
		`- Exam board: ${resolvePathwayBoardLabel(selection.examBoard)}`,
		'',
		'Source documents:',
		...options.sourceDocuments.map(
			(sourceDocument) =>
				`- ${sourceDocument.title} (${sourceDocument.qualificationCode}): ${sourceDocument.sourceUrl}`
		),
		'',
		'Requirements:',
		'- Return one JSON object with keys: title, subtitle, overview, units, generationNotes.',
		'- Each unit object must use exactly these keys: id, title, summary, specRefs, learningGoals, keyTerms, checkpointPrompts, practiceIdeas, estimatedStudyHours.',
		'- Use string arrays for specRefs, learningGoals, keyTerms, checkpointPrompts, and practiceIdeas.',
		'- Keep learningGoals to 3-5 items, keyTerms to 5-8 items, checkpointPrompts to 2-4 items, and practiceIdeas to 2-4 items per unit.',
		'- Use a short kebab-case id for each unit.',
		'- Use an integer number of hours for estimatedStudyHours.',
		'- Use the official AQA topic order and section references where possible.',
		'- Make the unit sequence suitable for a learner starting or organising Year 10/Year 11 GCSE work.',
		'- Each unit should have concrete learning goals, GCSE-style checkpoint prompts, and practice ideas.',
		'- Keep units broad enough to be curriculum planning units, not tiny lesson steps.',
		'- Do not claim to cover Combined Science only content; this is separate GCSE Triple Science.',
		'- Keep titles student-facing and concise.',
		'',
		'Built-in topic outline to preserve if the excerpt is incomplete:',
		JSON.stringify(options.fallbackUnits, null, 2),
		'',
		'Official specification excerpt:',
		options.referenceText ?? 'Cached specification text was unavailable; use the built-in outline.'
	].join('\n');
}

async function generatePathway(options: {
	selection: SparkLearningProfileSelection;
	sourceDocuments: SparkPathwaySourceDocument[];
}): Promise<z.infer<typeof generatedPathwaySchema>> {
	const fallbackUnits = buildFallbackPathwayUnits(options.selection);
	const referenceText = await loadReferenceText(options.sourceDocuments);
	const text = await generateText({
		modelId: PATHWAY_MODEL_ID,
		contents: [
			{
				role: 'user',
				parts: [
					{
						type: 'text',
						text: buildPathwayGenerationPrompt({
							selection: options.selection,
							sourceDocuments: options.sourceDocuments,
							referenceText,
							fallbackUnits
						})
					}
				]
			}
		],
		thinkingLevel: 'low',
		responseMimeType: 'application/json'
	});
	const parsed = parseJsonFromLlmText(text);
	return generatedPathwaySchema.parse(normalizeGeneratedPathwayPayload(parsed, fallbackUnits));
}

async function savePathwayForUser(options: {
	userId: string;
	pathway: SparkPathwayDocument;
}): Promise<void> {
	const serviceAccountJson = requireServiceAccountJson();
	await setFirestoreDocument({
		serviceAccountJson,
		documentPath: pathwayDocumentPath(options.userId, options.pathway.id),
		data: options.pathway
	});
	await setFirestoreDocument({
		serviceAccountJson,
		documentPath: learningProfileDocumentPath(options.userId),
		data: {
			schemaVersion: PATHWAY_SCHEMA_VERSION,
			selection: options.pathway.selection,
			activePathwayId: options.pathway.id,
			createdAt: options.pathway.createdAt,
			updatedAt: options.pathway.updatedAt
		}
	});
}

async function writeWorkspaceTextFile(options: {
	serviceAccountJson: string;
	userId: string;
	workspaceId: string;
	path: string;
	content: string;
	now: Date;
}): Promise<void> {
	await upsertWorkspaceTextFileDoc({
		serviceAccountJson: options.serviceAccountJson,
		userId: options.userId,
		workspaceId: options.workspaceId,
		filePath: options.path,
		content: options.content,
		contentType: resolveWorkspacePathContentType(options.path),
		createdAt: options.now,
		updatedAt: options.now
	});
}

function resolveNextPathwayUnit(options: {
	pathway: SparkPathwayDocument;
	unitId?: string;
}): SparkPathwayUnit {
	if (options.unitId) {
		const requestedUnit = options.pathway.units.find((unit) => unit.id === options.unitId);
		if (!requestedUnit) {
			throw new PathwayNotFoundError();
		}
		return requestedUnit;
	}

	const launchedUnitIds = new Set(options.pathway.worksheetRuns.map((run) => run.unitId));
	const nextUnit = options.pathway.units.find((unit) => !launchedUnitIds.has(unit.id));
	if (!nextUnit) {
		throw new PathwayCompleteError();
	}
	return nextUnit;
}

function formatPathwaySelection(selection: SparkLearningProfileSelection): string {
	return [
		resolvePathwayCountryLabel(selection.country),
		selection.schoolStage,
		resolvePathwayProgrammeLabel(selection.programme),
		resolvePathwaySubjectLabel(selection.subject),
		resolvePathwayBoardLabel(selection.examBoard)
	].join(' · ');
}

function buildPathwayWorksheetSourceText(options: {
	pathway: SparkPathwayDocument;
	unit: SparkPathwayUnit;
}): string {
	const { pathway, unit } = options;
	const lines: string[] = [
		'# Spark Pathway worksheet request',
		'',
		'Create one student worksheet for the next step in this learner pathway.',
		'Do not create a course plan, curriculum map, lesson sequence, or answer key.',
		'The worksheet should be ready for the student to solve in Spark.',
		'',
		'## Learner route',
		`- Target: ${formatPathwaySelection(pathway.selection)}`,
		`- Pathway: ${pathway.title}`,
		`- Pathway summary: ${pathway.overview}`,
		'',
		'## Current step',
		`- Unit: ${unit.title}`,
		`- Summary: ${unit.summary}`,
		`- Specification references: ${unit.specRefs.length > 0 ? unit.specRefs.join(', ') : 'Use the official subject specification for this unit.'}`,
		'',
		'## Learning goals',
		...unit.learningGoals.map((goal) => `- ${goal}`),
		'',
		'## Checkpoints to test',
		...unit.checkpointPrompts.map((prompt) => `- ${prompt}`),
		'',
		'## Practice direction',
		...unit.practiceIdeas.map((idea) => `- ${idea}`),
		'',
		'## Official sources already selected for this route',
		...pathway.sourceDocuments.map(
			(sourceDocument) =>
				`- ${sourceDocument.title} (${sourceDocument.publisher} ${sourceDocument.qualificationCode}): ${sourceDocument.sourceUrl}`
		),
		'',
		'## Worksheet requirements',
		'- Build a focused GCSE worksheet for this unit only.',
		'- Use UK English and AQA GCSE separate-science terminology.',
		'- Include a short retrieval warm-up, core practice, GCSE-style short answers, and a challenge section.',
		'- Keep questions scaffolded enough for independent work but include a few exam-style reasoning questions.',
		'- Avoid duplicating earlier Spark sheets unless the student needs retrieval from prerequisites.'
	];
	return lines.join('\n').trim().concat('\n');
}

function appendWorksheetRunToPathway(options: {
	pathway: SparkPathwayDocument;
	worksheetRun: SparkPathwayWorksheetRun;
}): SparkPathwayDocument {
	return SparkPathwayDocumentSchema.parse({
		...options.pathway,
		worksheetRuns: [...options.pathway.worksheetRuns, options.worksheetRun],
		updatedAt: options.worksheetRun.createdAt
	});
}

export async function createNextPathwaySheetForUser(options: {
	userId: string;
	pathwayId: string;
	unitId?: string;
}): Promise<PathwaySheetLaunchResult> {
	const serviceAccountJson = requireServiceAccountJson();
	const tasksEnv = requireTasksEnv();
	const pathway = await getPathwayForUser({
		userId: options.userId,
		pathwayId: options.pathwayId
	});
	if (!pathway) {
		throw new PathwayNotFoundError();
	}

	const unit = resolveNextPathwayUnit({ pathway, unitId: options.unitId });
	const sourceText = buildPathwayWorksheetSourceText({ pathway, unit });
	const title = `${resolvePathwaySubjectLabel(pathway.selection.subject)}: ${unit.title}`;
	const plan = buildSparkSheetDraftLaunchPlan({
		sourceText,
		input: {
			title,
			notes: sourceText
		},
		attachments: [],
		sheetTaskTemplate
	});
	const href = `/spark/sheets/${plan.runId}`;
	let runCreated = false;

	try {
		const studentSheetFiles = await loadStudentSheetVirtualFiles(options.userId);
		const sheetWorkspaceBrief = renderStudentSheetWorkspaceBrief(studentSheetFiles);
		const brief = [plan.brief.trim(), sheetWorkspaceBrief.trim()]
			.filter((section) => section.length > 0)
			.join('\n\n')
			.concat('\n');

		await createGraderRun(options.userId, {
			id: plan.runId,
			agentId: plan.agentId,
			workspaceId: plan.workspaceId,
			userPrompt: sourceText,
			olympiadKey: plan.launchTitleKey,
			olympiadLabel: plan.launchTitle,
			summaryPath: plan.summaryPath,
			sheetPath: plan.sheetPath,
			draftAnswersPath: plan.answersPath,
			sourceAttachmentIds: [],
			sourceAttachmentCount: 0,
			status: 'created',
			sheetPhase: 'building',
			paper: {
				contextLabel: pathway.title,
				paperName: unit.title,
				paperUrl: pathway.sourceDocuments[0]?.pageUrl
			},
			presentation: {
				title: unit.title,
				subtitle: `${resolvePathwaySubjectLabel(pathway.selection.subject)} · ${pathway.selection.schoolStage} · ${resolvePathwayBoardLabel(pathway.selection.examBoard)}`,
				summaryMarkdown: `Next pathway worksheet for ${unit.title}.`,
				footer: unit.specRefs.length > 0 ? `AQA specification ${unit.specRefs.join(', ')}` : 'AQA GCSE specification'
			},
			createdAt: plan.createdAt,
			updatedAt: plan.createdAt
		});
		runCreated = true;

		await setFirestoreDocument({
			serviceAccountJson,
			documentPath: `users/${options.userId}/workspace/${plan.workspaceId}`,
			data: {
				id: plan.workspaceId,
				agentId: plan.agentId,
				createdAt: plan.createdAt,
				updatedAt: plan.createdAt
			}
		});

		await Promise.all([
			writeWorkspaceTextFile({
				serviceAccountJson,
				userId: options.userId,
				workspaceId: plan.workspaceId,
				path: 'brief.md',
				content: brief,
				now: plan.createdAt
			}),
			writeWorkspaceTextFile({
				serviceAccountJson,
				userId: options.userId,
				workspaceId: plan.workspaceId,
				path: 'request.json',
				content: JSON.stringify(plan.requestPayload, null, 2),
				now: plan.createdAt
			}),
			writeWorkspaceTextFile({
				serviceAccountJson,
				userId: options.userId,
				workspaceId: plan.workspaceId,
				path: 'sheet/task.md',
				content: plan.sheetTask,
				now: plan.createdAt
			}),
			writeWorkspaceTextFile({
				serviceAccountJson,
				userId: options.userId,
				workspaceId: plan.workspaceId,
				path: plan.answersPath,
				content: JSON.stringify(
					{
						schemaVersion: 1,
						mode: 'draft_answers',
						answers: {}
					},
					null,
					2
				),
				now: plan.createdAt
			}),
			writeWorkspaceTextFile({
				serviceAccountJson,
				userId: options.userId,
				workspaceId: plan.workspaceId,
				path: SPARK_GRADER_UPLOADS_MANIFEST_PATH,
				content: JSON.stringify({ attachments: [] }, null, 2),
				now: plan.createdAt
			}),
			...plan.skillFiles.map((skillFile) =>
				writeWorkspaceTextFile({
					serviceAccountJson,
					userId: options.userId,
					workspaceId: plan.workspaceId,
					path: skillFile.path,
					content: skillFile.content,
					now: plan.createdAt
				})
			),
			...studentSheetFiles.map((file) =>
				writeWorkspaceTextFile({
					serviceAccountJson,
					userId: options.userId,
					workspaceId: plan.workspaceId,
					path: file.path,
					content: file.content,
					now: plan.createdAt
				})
			)
		]);

		await setFirestoreDocument({
			serviceAccountJson,
			documentPath: `users/${options.userId}/agents/${plan.agentId}`,
			data: {
				id: plan.agentId,
				prompt: plan.prompt,
				status: 'created',
				workspaceId: plan.workspaceId,
				sheetRunId: plan.runId,
				sheetSummaryPath: plan.summaryPath,
				sheetDraftPath: plan.sheetPath,
				sheetDraftAnswersPath: plan.answersPath,
				studentSheetFiles: studentSheetFiles.map((file) => file.path),
				inputAttachments: [],
				createdAt: plan.createdAt,
				updatedAt: plan.createdAt,
				statesTimeline: [{ state: 'created', timestamp: plan.createdAt }]
			}
		});

		const worksheetRun: SparkPathwayWorksheetRun = {
			runId: plan.runId,
			unitId: unit.id,
			title: plan.launchTitle,
			href,
			createdAt: plan.createdAt
		};
		const nextPathway = appendWorksheetRunToPathway({ pathway, worksheetRun });
		await patchFirestoreDocument({
			serviceAccountJson,
			documentPath: pathwayDocumentPath(options.userId, pathway.id),
			updates: {
				worksheetRuns: nextPathway.worksheetRuns,
				updatedAt: nextPathway.updatedAt
			}
		});

		await createTask(
			{
				type: 'runAgent',
				runAgent: { userId: options.userId, agentId: plan.agentId, workspaceId: plan.workspaceId }
			},
			{
				serviceUrl: tasksEnv.serviceUrl,
				apiKey: tasksEnv.apiKey,
				serviceAccountJson
			}
		);

		return {
			runId: plan.runId,
			href,
			pathway: nextPathway
		};
	} catch (error) {
		console.error('[pathways] next worksheet launch failed', {
			error,
			userId: options.userId,
			pathwayId: pathway.id,
			unitId: unit.id
		});
		if (runCreated) {
			const now = new Date();
			await patchGraderRun(options.userId, plan.runId, {
				status: 'failed',
				updatedAt: now,
				completedAt: now,
				error: 'Pathway worksheet creation failed.'
			}).catch(() => undefined);
		}
		throw error;
	}
}

export async function createPathwayForUser(options: {
	userId: string;
	selection: SparkLearningProfileSelection;
}): Promise<SparkPathwayDocument> {
	const selection = SparkLearningProfileSelectionSchema.parse(options.selection);
	const sourceDocuments = resolvePathwaySourceDocuments(selection);
	if (sourceDocuments.length === 0 || selection.country !== 'UK') {
		throw new UnsupportedPathwaySelectionError();
	}

	const now = new Date();
	const pathwayId = randomUUID();
	let pathway: SparkPathwayDocument;
	try {
		const generated = await generatePathway({ selection, sourceDocuments });
		pathway = SparkPathwayDocumentSchema.parse({
			id: pathwayId,
			schemaVersion: PATHWAY_SCHEMA_VERSION,
			status: 'ready',
			selection,
			title: generated.title,
			subtitle: generated.subtitle,
			overview: generated.overview,
			units: generated.units,
			sourceDocuments,
			worksheetRuns: [],
			modelId: PATHWAY_MODEL_ID,
			generationNotes: generated.generationNotes,
			createdAt: now,
			updatedAt: now,
			generatedAt: now
		});
	} catch (error) {
		console.warn('[pathways] pathway structuring failed; using fallback outline', {
			error,
			userId: options.userId,
			selection
		});
		const message = error instanceof Error ? error.message : String(error);
		pathway = buildFallbackPathway({
			id: pathwayId,
			selection,
			sourceDocuments,
			now,
			error: message
		});
	}

	await savePathwayForUser({ userId: options.userId, pathway });
	return pathway;
}
