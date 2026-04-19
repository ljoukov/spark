import { json, type RequestHandler } from '@sveltejs/kit';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
	PaperSheetFeedbackAttachmentSchema,
	SparkTutorSessionSchema,
	type PaperSheetContentSection,
	type PaperSheetFeedbackAttachment,
	type PaperSheetQuestion,
	type PaperSheetQuestionEntry,
	type SparkGraderWorksheetReport,
	type SparkTutorReviewGapBand,
	type SparkTutorReviewState,
	type SparkTutorReviewThread
} from '@spark/schemas';
import {
	SPARK_CHAT_MODEL_ID,
	SPARK_CHAT_THINKING_LEVEL,
	generateJson,
	type LlmContent,
	type LlmContentPart
} from '@spark/llm';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';
import {
	findWorksheetQuestionEntry,
	safeParseGraderWorksheetReport
} from '$lib/server/grader/problemReport';
import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import { rewritePaperSheetDataAssetTargets } from '$lib/server/grader/sheetAssets';
import { detectSparkAttachmentContentType } from '$lib/server/spark/attachmentContentType';
import { SPARK_ATTACHMENT_UNSUPPORTED_MESSAGE } from '$lib/spark/attachments';
import { CLOSE_GAP_NO_IMMEDIATE_MODEL_ANSWER_RULES } from '$lib/server/tutorSessions/closeGapRules';
import {
	appendTutorReviewMessage,
	buildInitialTutorReviewState,
	buildTutorReviewFocusLabel,
	buildTutorReviewPreview,
	findTutorReviewThread,
	summarizeTutorReviewState,
	updateTutorReviewThread
} from '$lib/server/tutorSessions/reviewState';
import {
	createTutorSession,
	findTutorSessionForSheet,
	patchTutorSession
} from '$lib/server/tutorSessions/repo';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_FILES_PER_REPLY = 10;

const paramsSchema = z.object({
	sheetId: z.string().trim().min(1)
});

const requestSchema = z.object({
	action: z.literal('reply'),
	questionId: z.string().trim().min(1),
	text: z.string().trim()
});

const closeGapResponseSchema = z.object({
	replyMarkdown: z.string().trim().min(1),
	status: z.enum(['open', 'resolved']),
	gapBand: z.enum(['large_gap', 'medium_gap', 'small_gap', 'closed'])
});

type ParsedTurnRequest = z.infer<typeof requestSchema> & {
	files: File[];
};

type PreparedReplyAttachment = {
	metadata: PaperSheetFeedbackAttachment;
	inlinePart: LlmContentPart;
};

function normalizeCloseGapBand(
	status: 'open' | 'resolved',
	gapBand: SparkTutorReviewGapBand
): SparkTutorReviewGapBand {
	if (status === 'resolved') {
		return 'closed';
	}
	if (gapBand === 'closed') {
		return 'small_gap';
	}
	return gapBand;
}

function isFileLike(value: FormDataEntryValue | null): value is File {
	if (!value) {
		return false;
	}
	if (typeof File !== 'undefined' && value instanceof File) {
		return true;
	}
	return typeof value === 'object' && value !== null && 'arrayBuffer' in value;
}

async function parseTurnRequest(request: Request): Promise<ParsedTurnRequest> {
	const contentType = request.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		return {
			...requestSchema.parse(await request.json()),
			files: []
		};
	}

	const formData = await request.formData();
	const parsed = requestSchema.parse({
		action: formData.get('action'),
		questionId: formData.get('questionId'),
		text: formData.get('text') ?? ''
	});
	const files: File[] = [];
	for (const entry of formData.getAll('file')) {
		if (isFileLike(entry)) {
			files.push(entry);
		}
	}
	return {
		...parsed,
		files
	};
}

function formatAttachmentList(attachments: PaperSheetFeedbackAttachment[]): string {
	return attachments
		.map(
			(attachment) =>
				`- ${attachment.filename} (${attachment.contentType}, ${attachment.sizeBytes.toString()} bytes)`
		)
		.join('\n');
}

function formatSegmentsWithBlanks(
	segments: readonly string[],
	blankCount: number,
	placeholder = '_____'
): string {
	const parts: string[] = [];
	for (let index = 0; index < blankCount; index += 1) {
		parts.push(segments[index] ?? '');
		parts.push(placeholder);
	}
	parts.push(segments[segments.length - 1] ?? '');
	return parts.join('');
}

function formatQuestionShape(question: PaperSheetQuestion): string {
	switch (question.type) {
		case 'answer_bank': {
			const options = question.options
				.map((option) => `${option.label ? `(${option.label}) ` : ''}${option.text}`)
				.join(' | ');
			return [
				'Question type: answer-bank blanks',
				`Question text: ${formatSegmentsWithBlanks(question.segments, question.blanks.length)}`,
				`Options shown to student: ${options}`,
				`Option reuse allowed: ${question.allowReuse === true ? 'yes' : 'no'}`
			].join('\n');
		}
		case 'fill':
			return [
				'Question type: fill-in-the-blank',
				`Question text: ${[
					question.prompt,
					...question.blanks.map((blank) => blank.placeholder ?? '_____'),
					question.after
				]
					.filter((part) => part.trim().length > 0)
					.join(question.conjunction ? ` ${question.conjunction} ` : ' ')}`,
				...(question.conjunction ? [`Text between blanks: ${question.conjunction}`] : []),
				`Blank count: ${question.blanks.length.toString()}`
			].join('\n');
		case 'cloze': {
			const wordBank =
				question.wordBank && question.wordBank.length > 0
					? `Word bank shown to student: ${question.wordBank.join(' | ')}`
					: null;
			return [
				'Question type: multi-blank cloze',
				`Question text: ${formatSegmentsWithBlanks(question.segments, question.blanks.length)}`,
				`Blank count: ${question.blanks.length.toString()}`,
				wordBank
			]
				.filter((part): part is string => part !== null)
				.join('\n');
		}
		case 'mcq':
			return [
				'Question type: multiple choice',
				`Prompt: ${question.prompt}`,
				`Display mode: ${question.displayMode}`,
				`Options: ${question.options.map((option) => `${option.label ? `(${option.label}) ` : ''}${option.text}`).join(' | ')}`
			].join('\n');
		case 'lines':
			return [
				'Question type: open written response',
				`Prompt: ${question.prompt}`,
				`Writing lines shown on the worksheet: ${question.lines.toString()}`
			].join('\n');
		case 'calc':
			return [
				'Question type: calculation / short numeric response',
				`Prompt: ${question.prompt}`,
				...(question.hint ? [`Hint on worksheet: ${question.hint}`] : []),
				`Input label: ${question.inputLabel}`,
				`Required unit: ${question.unit}`
			].join('\n');
		case 'match':
			return [
				'Question type: matching',
				`Prompt: ${question.prompt}`,
				`Terms shown to student: ${question.pairs.map((pair) => pair.term).join(' | ')}`,
				`Match options shown to student: ${question.pairs.map((pair) => pair.match).join(' | ')}`
			].join('\n');
		case 'spelling':
			return [
				'Question type: spelling correction',
				`Prompt: ${question.prompt}`,
				`Words shown on worksheet: ${question.words.map((word) => word.wrong).join(' | ')}`
			].join('\n');
		case 'flow': {
			const boxesById = new Map(question.boxes.map((box) => [box.id, box]));
			const rows = question.rows
				.map((row) =>
					row.items
						.map((item) => {
							if (item.type === 'operation') {
								return item.label;
							}
							const box = boxesById.get(item.boxId);
							if (!box) {
								return '[blank]';
							}
							if (box.readonly === true && box.initialValue) {
								return box.initialValue;
							}
							return `[blank${box.placeholder ? `: ${box.placeholder}` : ''}]`;
						})
						.join(' -> ')
				)
				.join('\n');
			return [
				'Question type: flow chart',
				`Prompt: ${question.prompt}`,
				'Rows shown to student:',
				rows,
				...(question.connectors && question.connectors.length > 0
					? [
							`Vertical connectors: ${question.connectors
								.map(
									(connector) =>
										`${connector.fromBoxId} ${connector.direction} ${connector.toBoxId} (${connector.label})`
								)
								.join(' | ')}`
						]
					: [])
			].join('\n');
		}
	}
}

function combineQuestionPrompts(parts: Array<string | null | undefined>): string {
	return parts
		.map((part) => part?.trim() ?? '')
		.filter((part) => part.length > 0)
		.join('\n\n');
}

function findQuestionPromptInEntries(options: {
	entries: readonly PaperSheetQuestionEntry[] | undefined;
	questionId: string;
	parentPrompt: string | null;
}): string | null {
	for (const entry of options.entries ?? []) {
		if (entry.type === 'group') {
			const result = findQuestionPromptInEntries({
				entries: entry.questions,
				questionId: options.questionId,
				parentPrompt: combineQuestionPrompts([options.parentPrompt, entry.prompt]) || null
			});
			if (result) {
				return result;
			}
			continue;
		}
		if (entry.id !== options.questionId) {
			continue;
		}
		return combineQuestionPrompts([options.parentPrompt, formatQuestionShape(entry)]);
	}
	return null;
}

function isContentSection(
	section: SparkGraderWorksheetReport['sheet']['sections'][number]
): section is PaperSheetContentSection {
	return 'id' in section;
}

function formatSelectedQuestionPrompt(
	report: SparkGraderWorksheetReport,
	questionId: string
): string {
	for (const section of report.sheet.sections) {
		if (!isContentSection(section)) {
			continue;
		}
		const prompt = findQuestionPromptInEntries({
			entries: section.questions,
			questionId,
			parentPrompt: null
		});
		if (prompt) {
			return prompt;
		}
	}
	return '(missing question text)';
}

function formatRecordedAnswer(report: SparkGraderWorksheetReport, questionId: string): string {
	const value = report.answers[questionId];
	if (typeof value === 'string') {
		return value.trim().length > 0 ? value : '(blank)';
	}
	if (!value) {
		return '(blank)';
	}
	return Object.entries(value)
		.map(([key, answer]) => `${key}: ${answer.trim().length > 0 ? answer : '(blank)'}`)
		.join('\n');
}

function truncateText(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, maxChars).trimEnd()}\n...`;
}

function buildReferenceLabels(entry: ReturnType<typeof findWorksheetQuestionEntry>): string[] {
	if (!entry) {
		return [];
	}
	const labels = [
		entry.question.id,
		entry.number.toString(),
		`Question ${entry.number.toString()}`
	];
	if ('displayNumber' in entry.question && entry.question.displayNumber) {
		labels.push(entry.question.displayNumber);
		labels.push(`Question ${entry.question.displayNumber}`);
	}
	return [...new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0))];
}

function extractReferenceSnippet(options: {
	text: string | undefined;
	labels: readonly string[];
	maxChars: number;
}): string | null {
	const text = options.text?.trim();
	if (!text) {
		return null;
	}
	const labels = options.labels.map((label) => label.toLowerCase());
	const lines = text.split(/\r?\n/u);
	const matchIndex = lines.findIndex((line) => {
		const lower = line.toLowerCase();
		return labels.some((label) => lower.includes(label));
	});
	if (matchIndex === -1) {
		return null;
	}
	const start = Math.max(0, matchIndex - 6);
	const end = Math.min(lines.length, matchIndex + 24);
	return truncateText(lines.slice(start, end).join('\n').trim(), options.maxChars);
}

function buildPrivateReferenceContext(options: {
	report: SparkGraderWorksheetReport;
	entry: ReturnType<typeof findWorksheetQuestionEntry>;
}): string {
	const labels = buildReferenceLabels(options.entry);
	const questionReview = options.entry
		? options.report.review.questions[options.entry.question.id]
		: null;
	const parts: string[] = [];
	if (questionReview?.followUp?.trim()) {
		parts.push(`Question-specific grader note:\n${questionReview.followUp.trim()}`);
	}
	const officialSolution = extractReferenceSnippet({
		text: options.report.references?.officialSolutionMarkdown,
		labels,
		maxChars: 2200
	});
	if (officialSolution) {
		parts.push(`Private official-solution excerpt:\n${officialSolution}`);
	}
	const grading = extractReferenceSnippet({
		text: options.report.references?.gradingMarkdown,
		labels,
		maxChars: 2200
	});
	if (grading) {
		parts.push(`Private grading excerpt:\n${grading}`);
	}
	return parts.length > 0
		? parts.join('\n\n')
		: 'No focused private answer reference was supplied. Solve only from the visible problem, the submitted answer, and the review note.';
}

async function prepareReplyAttachments(files: File[]): Promise<PreparedReplyAttachment[]> {
	if (files.length === 0) {
		return [];
	}
	if (files.length > MAX_FILES_PER_REPLY) {
		throw new z.ZodError([
			{
				code: 'custom',
				path: ['file'],
				message: 'You can attach up to 10 files per reply.'
			}
		]);
	}

	let totalSizeBytes = 0;
	const attachments: PreparedReplyAttachment[] = [];

	for (const [index, file] of files.entries()) {
		if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE_BYTES) {
			throw new z.ZodError([
				{
					code: 'custom',
					path: ['file', index],
					message: 'Each file must be 25 MB or smaller.'
				}
			]);
		}

		const buffer = new Uint8Array(await file.arrayBuffer());
		if (buffer.byteLength === 0) {
			throw new z.ZodError([
				{
					code: 'custom',
					path: ['file', index],
					message: 'Attached files cannot be empty.'
				}
			]);
		}
		if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
			throw new z.ZodError([
				{
					code: 'custom',
					path: ['file', index],
					message: 'Each file must be 25 MB or smaller.'
				}
			]);
		}

		totalSizeBytes += buffer.byteLength;
		if (totalSizeBytes > MAX_TOTAL_SIZE_BYTES) {
			throw new z.ZodError([
				{
					code: 'custom',
					path: ['file'],
					message: 'Attachments are limited to 50 MB total per reply.'
				}
			]);
		}

		const contentType = detectSparkAttachmentContentType({
			buffer,
			filename: file.name,
			claimedContentType: file.type
		});
		if (!contentType) {
			throw new z.ZodError([
				{
					code: 'custom',
					path: ['file', index],
					message: SPARK_ATTACHMENT_UNSUPPORTED_MESSAGE
				}
			]);
		}

		const fileId = createHash('md5').update(buffer).digest('hex');
		attachments.push({
			metadata: PaperSheetFeedbackAttachmentSchema.parse({
				id: fileId,
				filename: file.name || 'upload',
				contentType,
				sizeBytes: buffer.byteLength
			}),
			inlinePart: {
				type: 'inlineData',
				data: Buffer.from(buffer).toString('base64'),
				mimeType: contentType
			}
		});
	}

	return attachments;
}

function buildCloseGapSystemPrompt(options: {
	report: SparkGraderWorksheetReport;
	questionId: string;
}): string {
	const entry = findWorksheetQuestionEntry(options.report.sheet, options.questionId);
	if (!entry) {
		return '';
	}

	const questionReview = options.report.review.questions[options.questionId];
	const selectedQuestionPrompt = formatSelectedQuestionPrompt(options.report, options.questionId);
	const score = questionReview?.score
		? `${questionReview.score.got.toString()}/${questionReview.score.total.toString()} marks`
		: questionReview?.label ?? '(not scored)';

	return [
		'You are Spark\'s focused close-the-gap tutor for one worksheet problem.',
		'This is a normal chat turn, not a multi-question worksheet review workflow.',
		'Help the student repair the gap by writing the missing reasoning themselves.',
		'Use one concise cue or guiding question at a time. Do not call it a stepping stone.',
		...CLOSE_GAP_NO_IMMEDIATE_MODEL_ANSWER_RULES,
		'Start by acknowledging the most sensible part of the latest attempt before naming the exact remaining gap.',
		'Keep the reply student-facing, specific, and short.',
		'Set status to "resolved" only when the latest student response closes the gap for this selected question. Otherwise set status to "open".',
		'Also set gapBand as a discrete progress score for the remaining gap after this reply:',
		'- "large_gap": the student still has a major missing idea, method, or setup.',
		'- "medium_gap": the student has the main direction but still needs an important repair.',
		'- "small_gap": the student is close and only a detail, wording, or final check remains.',
		'- "closed": the latest student response has closed the gap. Use this with status "resolved".',
		'If status is "open", do not set gapBand to "closed".',
		'',
		`Worksheet: ${options.report.sheet.title}`,
		`Section: ${entry.section.label}`,
		`Question number: ${entry.number.toString()}`,
		`Marks available: ${entry.question.marks.toString()}`,
		`Current score: ${score}`,
		'',
		'Problem shown to the student:',
		selectedQuestionPrompt,
		'',
		'Student\'s submitted worksheet answer:',
		formatRecordedAnswer(options.report, options.questionId),
		'',
		'Inline review note shown before this chat:',
		questionReview?.note ?? '(missing)',
		'',
		'Private answer/checking context. Use this only to keep your guidance correct; do not paste it into the first reply or reveal it by default:',
		buildPrivateReferenceContext({
			report: options.report,
			entry
		})
	].join('\n');
}

function buildCloseGapContents(options: {
	systemPrompt: string;
	thread: SparkTutorReviewThread;
	latestAttachmentParts: LlmContentPart[];
}): LlmContent[] {
	const contents: LlmContent[] = [
		{
			role: 'system',
			parts: [{ type: 'text', text: options.systemPrompt }]
		}
	];
	const latestStudentIndex = options.thread.messages.findLastIndex(
		(message) => message.author === 'student'
	);

	for (const [index, message] of options.thread.messages.entries()) {
		const attachmentNote =
			message.attachments && message.attachments.length > 0
				? `\n\nAttachments:\n${formatAttachmentList(message.attachments)}`
				: '';
		const text =
			message.markdown.trim().length > 0
				? `${message.markdown.trim()}${attachmentNote}`
				: `(no text)${attachmentNote}`;
		const parts: LlmContentPart[] = [{ type: 'text', text }];
		if (index === latestStudentIndex) {
			parts.push(...options.latestAttachmentParts);
		}
		contents.push({
			role: message.author === 'assistant' ? 'model' : 'user',
			parts
		});
	}

	return contents;
}

function buildSessionSource(options: {
	report: SparkGraderWorksheetReport;
	runId: string;
}): z.infer<typeof SparkTutorSessionSchema>['source'] {
	return {
		kind: 'sheet',
		runId: options.runId,
		sheetTitle: options.report.sheet.title,
		...(typeof options.report.review.score.got === 'number'
			? { awardedMarks: options.report.review.score.got }
			: {}),
		...(typeof options.report.review.score.total === 'number'
			? { maxMarks: options.report.review.score.total }
			: {})
	};
}

async function persistReviewState(options: {
	userId: string;
	sessionId: string;
	sessionExists: boolean;
	runId: string;
	report: SparkGraderWorksheetReport;
	reviewState: SparkTutorReviewState;
	status: z.infer<typeof SparkTutorSessionSchema>['status'];
	now: Date;
	activeTurnQuestionId?: string;
	error?: string;
}): Promise<void> {
	const summary = summarizeTutorReviewState(options.reviewState);
	const focusLabel = buildTutorReviewFocusLabel(options.reviewState);
	const updates: Record<string, unknown> = {
		status: options.status,
		updatedAt: options.now,
		preview: buildTutorReviewPreview(options.reviewState),
		reviewState: options.reviewState
	};
	if (focusLabel) {
		updates.focusLabel = focusLabel;
	}
	if (options.activeTurnQuestionId) {
		updates.activeTurnQuestionId = options.activeTurnQuestionId;
	}
	if (options.error) {
		updates.error = options.error;
	}
	if (options.status === 'completed' || summary.allResolved) {
		updates.completedAt = options.now;
	}

	if (!options.sessionExists) {
		await createTutorSession(
			options.userId,
			SparkTutorSessionSchema.parse({
				id: options.sessionId,
				workspaceId: `close-gap-${options.sessionId}`,
				status: options.status,
				source: buildSessionSource({
					report: options.report,
					runId: options.runId
				}),
				title: `${options.report.sheet.title} feedback`,
				...updates,
				createdAt: options.now
			})
		);
		return;
	}

	const deletes = ['activeTurnAgentId'];
	if (!options.activeTurnQuestionId) {
		deletes.push('activeTurnQuestionId');
	}
	if (!focusLabel) {
		deletes.push('focusLabel');
	}
	if (!options.error) {
		deletes.push('error');
	}
	if (options.status !== 'completed' && !summary.allResolved) {
		deletes.push('completedAt');
	}
	await patchTutorSession(options.userId, options.sessionId, updates, deletes);
}

export const POST: RequestHandler = async ({ request, params }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}
	const userId = authResult.user.uid;

	let parsedParams: z.infer<typeof paramsSchema>;
	let parsedBody: ParsedTurnRequest;
	try {
		parsedParams = paramsSchema.parse(params);
		parsedBody = await parseTurnRequest(request);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		return json({ error: 'invalid_request' }, { status: 400 });
	}

	if (parsedBody.text.length === 0 && parsedBody.files.length === 0) {
		return json(
			{
				error: 'invalid_request',
				issues: [
					{
						path: ['text'],
						message: 'Reply with text or attach at least one file.'
					}
				]
			},
			{ status: 400 }
		);
	}

	const run = await getGraderRun(userId, parsedParams.sheetId);
	if (!run) {
		return json({ error: 'sheet_not_found' }, { status: 404 });
	}

	const reportPath = run.sheet?.filePath ?? run.sheetPath;
	const reportRaw = await getWorkspaceTextFile(userId, run.workspaceId, reportPath);
	if (!reportRaw) {
		return json({ error: 'sheet_not_ready' }, { status: 409 });
	}
	const report = safeParseGraderWorksheetReport(reportRaw);
	if (!report) {
		return json({ error: 'sheet_invalid' }, { status: 500 });
	}

	let preparedAttachments: PreparedReplyAttachment[];
	try {
		preparedAttachments = await prepareReplyAttachments(parsedBody.files);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_request', issues: error.issues }, { status: 400 });
		}
		console.error('Failed to prepare sheet reply attachments', {
			error,
			userId,
			sheetId: parsedParams.sheetId,
			questionId: parsedBody.questionId
		});
		return json({ error: 'attachment_prepare_failed' }, { status: 500 });
	}

	const session = await findTutorSessionForSheet({
		userId,
		runId: run.id
	});
	if (session?.status === 'responding') {
		return json({ error: 'sheet_busy' }, { status: 409 });
	}

	const now = new Date();
	const sessionId = session?.id ?? randomUUID();
	const baseReviewState =
		session?.reviewState ??
		(() => {
			const initialState = buildInitialTutorReviewState({
				report,
				now
			});
			return {
				...initialState,
				sheet: rewritePaperSheetDataAssetTargets({
					sheetId: run.id,
					sheet: initialState.sheet
				})
			};
		})();
	const currentThread = findTutorReviewThread(baseReviewState, parsedBody.questionId);
	if (!currentThread) {
		return json({ error: 'question_not_found' }, { status: 404 });
	}

	const createdAt = now.toISOString();
	const studentAttachments = preparedAttachments.map((attachment) => attachment.metadata);
	const respondingThread = appendTutorReviewMessage({
		thread: currentThread,
		author: 'student',
		markdown: parsedBody.text,
		attachments: studentAttachments,
		createdAt,
		status: 'responding'
	});
	const respondingReviewState = updateTutorReviewThread({
		reviewState: baseReviewState,
		thread: respondingThread,
		now
	});

	await persistReviewState({
		userId,
		sessionId,
		sessionExists: session !== null,
		runId: run.id,
		report,
		reviewState: respondingReviewState,
		status: 'responding',
		now,
		activeTurnQuestionId: parsedBody.questionId
	});

	const systemPrompt = buildCloseGapSystemPrompt({
		report,
		questionId: parsedBody.questionId
	});

	try {
		const response = await generateJson({
			modelId: SPARK_CHAT_MODEL_ID,
			thinkingLevel: SPARK_CHAT_THINKING_LEVEL,
			openAiSchemaName: 'spark_close_gap_response',
			schema: closeGapResponseSchema,
			contents: buildCloseGapContents({
				systemPrompt,
				thread: respondingThread,
				latestAttachmentParts: preparedAttachments.map((attachment) => attachment.inlinePart)
			})
		});

		const completedAt = new Date();
		const gapBand = normalizeCloseGapBand(response.status, response.gapBand);
		const assistantThread = appendTutorReviewMessage({
			thread: respondingThread,
			author: 'assistant',
			markdown: response.replyMarkdown,
			createdAt: completedAt.toISOString(),
			status: response.status === 'resolved' ? 'resolved' : 'open',
			gapBand,
			...(response.status === 'resolved' ? { resolvedAt: completedAt.toISOString() } : {})
		});
		const finalReviewState = updateTutorReviewThread({
			reviewState: respondingReviewState,
			thread: assistantThread,
			now: completedAt
		});
		const summary = summarizeTutorReviewState(finalReviewState);
		await persistReviewState({
			userId,
			sessionId,
			sessionExists: true,
			runId: run.id,
			report,
			reviewState: finalReviewState,
			status: summary.allResolved ? 'completed' : 'awaiting_student',
			now: completedAt
		});

		return json({
			ok: true,
			sessionId,
			reviewState: finalReviewState
		});
	} catch (error) {
		console.error('Failed to generate close-gap sheet reply', {
			error,
			userId,
			sheetId: parsedParams.sheetId,
			questionId: parsedBody.questionId
		});
		const failedAt = new Date();
		const failedThread = {
			...respondingThread,
			status: 'open' as const
		};
		const failedReviewState = updateTutorReviewThread({
			reviewState: respondingReviewState,
			thread: failedThread,
			now: failedAt
		});
		await persistReviewState({
			userId,
			sessionId,
			sessionExists: true,
			runId: run.id,
			report,
			reviewState: failedReviewState,
			status: 'awaiting_student',
			now: failedAt,
			error: 'Unable to generate worksheet feedback right now.'
		});
		return json({ error: 'reply_generation_failed' }, { status: 500 });
	}
};
