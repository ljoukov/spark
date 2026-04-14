import path from 'node:path';

import type {
	PaperSheetContentSection,
	PaperSheetData,
	PaperSheetQuestion,
	PaperSheetQuestionEntry,
	SparkGraderWorksheetReport,
	SparkGraderWorksheetReferences,
	SparkSolveSheetDraft
} from '@spark/schemas';
import { isPaperSheetQuestionGroup } from '@spark/schemas';

const WORKSHEET_ASSET_PATH_PREFIXES = [
	'grader/assets/',
	'grader/output/assets/',
	'sheet/assets/',
	'sheet/output/assets/'
] as const;
const SOURCE_ATTACHMENT_PATH_PREFIXES = ['grader/uploads/'] as const;

function normalizeAssetPath(filePath: string): string {
	return filePath.replace(/\\/g, '/').replace(/^\/+/u, '').trim();
}

export function isAllowedWorksheetAssetPath(filePath: string): boolean {
	const normalized = normalizeAssetPath(filePath);
	return WORKSHEET_ASSET_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isAllowedSourceAttachmentPath(filePath: string): boolean {
	const normalized = normalizeAssetPath(filePath);
	return SOURCE_ATTACHMENT_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function buildSheetWorkspaceAssetUrl(options: {
	sheetId: string;
	filePath: string;
}): string {
	const normalizedPath = normalizeAssetPath(options.filePath);
	const params = new URLSearchParams({
		path: normalizedPath,
		filename: path.basename(normalizedPath)
	});
	return `/api/spark/sheets/${encodeURIComponent(options.sheetId)}/attachment?${params.toString()}`;
}

function rewriteMarkdownAssetTargets(markdown: string, sheetId: string): string {
	const rewriteTarget = (target: string): string | null => {
		if (!isAllowedWorksheetAssetPath(target)) {
			return null;
		}
		return buildSheetWorkspaceAssetUrl({ sheetId, filePath: target });
	};

	const imageLinksRewritten = markdown.replace(
		/(\[!\[[^\]]*\]\()<?([^)>\s]+)>?(\)\]\()<?([^)>\s]+)>?(\))/gu,
		(match, prefix, imageTarget, middle, linkTarget, suffix) => {
			const rewrittenImageTarget = rewriteTarget(imageTarget);
			const rewrittenLinkTarget = rewriteTarget(linkTarget);
			if (!rewrittenImageTarget && !rewrittenLinkTarget) {
				return match;
			}
			return `${prefix}${rewrittenImageTarget ?? imageTarget}${middle}${rewrittenLinkTarget ?? linkTarget}${suffix}`;
		}
	);

	return imageLinksRewritten.replace(
		/(!?\[[^\]]*\]\()<?([^)>\s]+)>?(\))/gu,
		(match, prefix, target, suffix) => {
			const rewrittenTarget = rewriteTarget(target);
			if (!rewrittenTarget) {
				return match;
			}
			return `${prefix}${rewrittenTarget}${suffix}`;
		}
	);
}

function rewriteReferences(
	references: SparkGraderWorksheetReferences | undefined,
	sheetId: string
): SparkGraderWorksheetReferences | undefined {
	if (!references) {
		return undefined;
	}
	return {
		...references,
		...(references.problemMarkdown
			? { problemMarkdown: rewriteMarkdownAssetTargets(references.problemMarkdown, sheetId) }
			: {}),
		...(references.officialProblemMarkdown
			? {
					officialProblemMarkdown: rewriteMarkdownAssetTargets(
						references.officialProblemMarkdown,
						sheetId
					)
				}
			: {}),
		...(references.officialSolutionMarkdown
			? {
					officialSolutionMarkdown: rewriteMarkdownAssetTargets(
						references.officialSolutionMarkdown,
						sheetId
					)
				}
			: {}),
		...(references.studentTranscriptMarkdown
			? {
					studentTranscriptMarkdown: rewriteMarkdownAssetTargets(
						references.studentTranscriptMarkdown,
						sheetId
					)
				}
			: {}),
		...(references.gradingMarkdown
			? { gradingMarkdown: rewriteMarkdownAssetTargets(references.gradingMarkdown, sheetId) }
			: {}),
		...(references.overallFeedbackMarkdown
			? {
					overallFeedbackMarkdown: rewriteMarkdownAssetTargets(
						references.overallFeedbackMarkdown,
						sheetId
					)
				}
			: {})
	};
}

function rewriteQuestion(question: PaperSheetQuestion, sheetId: string): PaperSheetQuestion {
	switch (question.type) {
		case 'fill':
			return {
				...question,
				prompt: rewriteMarkdownAssetTargets(question.prompt, sheetId),
				after: rewriteMarkdownAssetTargets(question.after, sheetId),
				...(question.conjunction
					? { conjunction: rewriteMarkdownAssetTargets(question.conjunction, sheetId) }
					: {})
			};
		case 'mcq':
			return {
				...question,
				prompt: rewriteMarkdownAssetTargets(question.prompt, sheetId),
				options: question.options.map((option) => ({
					...option,
					text: rewriteMarkdownAssetTargets(option.text, sheetId)
				}))
			};
		case 'lines':
			return {
				...question,
				prompt: rewriteMarkdownAssetTargets(question.prompt, sheetId)
			};
		case 'calc':
			return {
				...question,
				prompt: rewriteMarkdownAssetTargets(question.prompt, sheetId),
				inputLabel: rewriteMarkdownAssetTargets(question.inputLabel, sheetId),
				unit: rewriteMarkdownAssetTargets(question.unit, sheetId),
				...(question.hint ? { hint: rewriteMarkdownAssetTargets(question.hint, sheetId) } : {})
			};
		case 'match':
			return {
				...question,
				prompt: rewriteMarkdownAssetTargets(question.prompt, sheetId),
				pairs: question.pairs.map((pair) => ({
					term: rewriteMarkdownAssetTargets(pair.term, sheetId),
					match: rewriteMarkdownAssetTargets(pair.match, sheetId)
				}))
			};
		case 'spelling':
			return {
				...question,
				prompt: rewriteMarkdownAssetTargets(question.prompt, sheetId),
				words: question.words.map((word) => ({
					wrong: rewriteMarkdownAssetTargets(word.wrong, sheetId)
				}))
			};
		case 'cloze':
			return {
				...question,
				segments: question.segments.map((segment) =>
					rewriteMarkdownAssetTargets(segment, sheetId)
				),
				...(question.wordBank
					? {
							wordBank: question.wordBank.map((option) =>
								rewriteMarkdownAssetTargets(option, sheetId)
							)
						}
					: {})
			};
		case 'answer_bank':
			return {
				...question,
				segments: question.segments.map((segment) =>
					rewriteMarkdownAssetTargets(segment, sheetId)
				),
				options: question.options.map((option) => ({
					...option,
					text: rewriteMarkdownAssetTargets(option.text, sheetId)
				}))
			};
		case 'flow':
			return {
				...question,
				prompt: rewriteMarkdownAssetTargets(question.prompt, sheetId),
				rows: question.rows.map((row) => ({
					...row,
					items: row.items.map((item) =>
						item.type === 'operation'
							? {
									...item,
									label: rewriteMarkdownAssetTargets(item.label, sheetId)
								}
							: item
					)
				})),
				...(question.connectors
					? {
							connectors: question.connectors.map((connector) => ({
								...connector,
								label: rewriteMarkdownAssetTargets(connector.label, sheetId)
							}))
						}
					: {})
			};
	}
}

function rewriteQuestionEntry(
	entry: PaperSheetQuestionEntry,
	sheetId: string
): PaperSheetQuestionEntry {
	if (isPaperSheetQuestionGroup(entry)) {
		return {
			...entry,
			prompt: rewriteMarkdownAssetTargets(entry.prompt, sheetId),
			questions: entry.questions.map((question) => rewriteQuestion(question, sheetId))
		};
	}
	return rewriteQuestion(entry, sheetId);
}

function rewriteContentSection(
	section: PaperSheetContentSection,
	sheetId: string
): PaperSheetContentSection {
	return {
		...section,
		...(section.theory ? { theory: rewriteMarkdownAssetTargets(section.theory, sheetId) } : {}),
		...(section.infoBox
			? {
					infoBox: {
						...section.infoBox,
						text: rewriteMarkdownAssetTargets(section.infoBox.text, sheetId)
					}
				}
			: {}),
		...(section.questions
			? {
					questions: section.questions.map((entry) => rewriteQuestionEntry(entry, sheetId))
				}
			: {})
	};
}

export function rewritePaperSheetDataAssetTargets(options: {
	sheetId: string;
	sheet: PaperSheetData;
}): PaperSheetData {
	return {
		...options.sheet,
		sections: options.sheet.sections.map((section) =>
			'type' in section
				? {
						...section,
						text: rewriteMarkdownAssetTargets(section.text, options.sheetId)
					}
				: rewriteContentSection(section, options.sheetId)
		)
	};
}

export function rewriteSolveSheetDraftAssetTargets(options: {
	sheetId: string;
	draft: SparkSolveSheetDraft;
}): SparkSolveSheetDraft {
	return {
		...options.draft,
		sheet: rewritePaperSheetDataAssetTargets({
			sheetId: options.sheetId,
			sheet: options.draft.sheet
		}),
		...(options.draft.references
			? { references: rewriteReferences(options.draft.references, options.sheetId) }
			: {})
	};
}

export function rewriteGraderWorksheetReportAssetTargets(options: {
	sheetId: string;
	report: SparkGraderWorksheetReport;
}): SparkGraderWorksheetReport {
	return {
		...options.report,
		sheet: rewritePaperSheetDataAssetTargets({
			sheetId: options.sheetId,
			sheet: options.report.sheet
		}),
		...(options.report.references
			? { references: rewriteReferences(options.report.references, options.sheetId) }
			: {})
	};
}
