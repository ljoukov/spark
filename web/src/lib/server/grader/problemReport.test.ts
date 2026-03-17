import { describe, expect, it } from 'vitest';

import {
	findWorksheetQuestionEntry,
	listWorksheetQuestionEntries,
	parseGraderWorksheetReport,
	safeParseGraderWorksheetReport
} from './problemReport';

const worksheetReportJson = JSON.stringify({
	schemaVersion: 1,
	sheet: {
		id: 'sheet-1',
		subject: 'Maths',
		level: 'KS2',
		title: 'Sample worksheet',
		subtitle: 'Problem 1',
		color: '#123456',
		accent: '#345678',
		light: '#f0f4f8',
		border: '#89abcd',
		sections: [
			{
				type: 'hook',
				text: 'Try each question carefully.'
			},
			{
				id: 'section-a',
				label: 'Section A',
				questions: [
					{
						id: 'q1',
						type: 'mcq',
						marks: 1,
						prompt: 'What is 2 + 2?',
						options: ['3', '4']
					},
					{
						id: 'q2',
						type: 'lines',
						marks: 2,
						prompt: 'Explain why your answer is correct.',
						lines: 3
					}
				]
			}
		]
	},
	answers: {
		q1: '4',
		q2: 'I added 2 and 2.'
	},
	review: {
		score: {
			got: 2,
			total: 3
		},
		label: '2/3 correct',
		message: 'Solid start.',
		note: 'Review the explanation question.',
		questions: {
			q1: {
				status: 'correct',
				note: 'Correct answer.'
			},
			q2: {
				status: 'teacher-review',
				note: 'Add the missing reasoning step.'
			}
		}
	}
});

describe('problem worksheet report parsing', () => {
	it('parses worksheet JSON and exposes numbered worksheet entries', () => {
		const report = parseGraderWorksheetReport(worksheetReportJson);
		const entries = listWorksheetQuestionEntries(report.sheet);

		expect(entries.map((entry) => entry.number)).toEqual([1, 2]);
		expect(entries.map((entry) => entry.question.id)).toEqual(['q1', 'q2']);
		expect(findWorksheetQuestionEntry(report.sheet, 'q2')?.section.label).toBe('Section A');
	});

	it('does not accept the old markdown-style problem artifact', () => {
		expect(safeParseGraderWorksheetReport('# Problem 1\n\nOld markdown report')).toBeNull();
	});
});
