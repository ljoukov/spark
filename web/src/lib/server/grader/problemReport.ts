import {
	PaperSheetDataSchema,
	SparkGraderWorksheetReportSchema,
	type PaperSheetContentSection,
	type PaperSheetQuestion,
	type SparkGraderWorksheetReport
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

export function listWorksheetQuestionEntries(sheet: SparkGraderWorksheetReport['sheet']): WorksheetQuestionEntry[] {
	const parsedSheet = PaperSheetDataSchema.parse(sheet);
	const entries: WorksheetQuestionEntry[] = [];
	let number = 1;

	for (const section of parsedSheet.sections) {
		if (!('id' in section)) {
			continue;
		}
		for (const question of section.questions ?? []) {
			entries.push({
				section,
				question,
				number
			});
			number += 1;
		}
	}

	return entries;
}

export function findWorksheetQuestionEntry(
	sheet: SparkGraderWorksheetReport['sheet'],
	questionId: string
): WorksheetQuestionEntry | null {
	return listWorksheetQuestionEntries(sheet).find((entry) => entry.question.id === questionId) ?? null;
}
