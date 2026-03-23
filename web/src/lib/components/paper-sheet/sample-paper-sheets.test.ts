import { describe, expect, it } from 'vitest';

import { samplePaperSheets } from './sample-paper-sheets';

function listQuestionIds(sheet: (typeof samplePaperSheets)[number]): string[] {
	const questionIds: string[] = [];
	for (const section of sheet.sections) {
		if (!('id' in section)) {
			continue;
		}
		for (const question of section.questions ?? []) {
			questionIds.push(question.id);
		}
	}
	return questionIds;
}

describe('sample paper sheets', () => {
	it('uses globally unique question ids for seeded sheets', () => {
		for (const sheet of samplePaperSheets) {
			const questionIds = listQuestionIds(sheet);
			expect(new Set(questionIds).size).toBe(questionIds.length);
		}
	});

	it('keeps seeded answer and review keys aligned with question ids', () => {
		for (const sheet of samplePaperSheets) {
			const questionIds = listQuestionIds(sheet).sort();
			const answerKeys = Object.keys(sheet.initialAnswers ?? {}).sort();
			const reviewKeys = Object.keys(sheet.mockReview?.questions ?? {}).sort();

			if (answerKeys.length > 0) {
				expect(answerKeys).toEqual(questionIds);
			}
			if (reviewKeys.length > 0) {
				expect(reviewKeys).toEqual(questionIds);
			}
		}
	});
});
