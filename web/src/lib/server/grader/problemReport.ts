import {
	visitPaperSheetQuestions,
	PaperSheetAnswersSchema,
	PaperSheetDataSchema,
	SparkGraderWorksheetReportSchema,
	SparkSolveSheetAnswersSchema,
	SparkSolveSheetDraftSchema,
	coerceSparkSolveSheetDraft,
	type PaperSheetContentSection,
	type PaperSheetAnswers,
	type PaperSheetQuestion,
	type SparkGraderWorksheetReport,
	type SparkSolveSheetAnswers,
	type SparkSolveSheetDraft
} from '@spark/schemas';

export type WorksheetQuestionEntry = {
	section: PaperSheetContentSection;
	question: PaperSheetQuestion;
	number: number;
};

export function parseGraderWorksheetReport(raw: string): SparkGraderWorksheetReport {
	return SparkGraderWorksheetReportSchema.parse(JSON.parse(raw));
}

export function safeParseGraderWorksheetReport(raw: string): SparkGraderWorksheetReport | null {
	try {
		return parseGraderWorksheetReport(raw);
	} catch {
		return null;
	}
}

export function parseSolveSheetDraft(raw: string): SparkSolveSheetDraft {
	const parsed = coerceSparkSolveSheetDraft(JSON.parse(raw));
	if (!parsed) {
		return SparkSolveSheetDraftSchema.parse(JSON.parse(raw));
	}
	return parsed;
}

export function safeParseSolveSheetDraft(raw: string): SparkSolveSheetDraft | null {
	try {
		return parseSolveSheetDraft(raw);
	} catch {
		return null;
	}
}

export function parseSolveSheetAnswers(raw: string): SparkSolveSheetAnswers {
	return SparkSolveSheetAnswersSchema.parse(JSON.parse(raw));
}

export function safeParseSolveSheetAnswers(raw: string): SparkSolveSheetAnswers | null {
	try {
		return parseSolveSheetAnswers(raw);
	} catch {
		try {
			return {
				schemaVersion: 1,
				mode: 'draft_answers',
				answers: PaperSheetAnswersSchema.parse(JSON.parse(raw))
			};
		} catch {
			return null;
		}
	}
}

export function listWorksheetQuestionEntries(sheet: SparkGraderWorksheetReport['sheet']): WorksheetQuestionEntry[] {
	const parsedSheet = PaperSheetDataSchema.parse(sheet);
	const entries: WorksheetQuestionEntry[] = [];
	let number = 1;

	for (const section of parsedSheet.sections) {
		if (!('id' in section)) {
			continue;
		}
		visitPaperSheetQuestions(section.questions, (question) => {
			entries.push({
				section,
				question,
				number
			});
			number += 1;
		});
	}

	return entries;
}

export function findWorksheetQuestionEntry(
	sheet: SparkGraderWorksheetReport['sheet'],
	questionId: string
): WorksheetQuestionEntry | null {
	return listWorksheetQuestionEntries(sheet).find((entry) => entry.question.id === questionId) ?? null;
}

export function emptySolveSheetAnswers(): SparkSolveSheetAnswers {
	return {
		schemaVersion: 1,
		mode: 'draft_answers',
		answers: {} satisfies PaperSheetAnswers
	};
}
