import { describe, expect, it } from 'vitest';

import {
	findWorksheetQuestionEntry,
	listWorksheetQuestionEntries,
	parseGraderWorksheetReport,
	safeParseSolveSheetDraft,
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
						id: 'q2-group',
						type: 'group',
						displayNumber: '2',
						prompt:
							'For Question 2, use the table below.\n\n| Option | Value |\n| --- | ---: |\n| A | 3 |\n| B | 4 |',
						questions: [
							{
								id: 'q2',
								type: 'fill',
								displayNumber: '2(a)',
								marks: 1,
								prompt: 'The correct option is',
								blanks: [{}],
								after: '.'
							},
							{
								id: 'q3',
								type: 'lines',
								displayNumber: '2(b)',
								marks: 2,
								prompt: 'Explain why your answer is correct.',
								lines: 3
							}
						]
					}
				]
			}
		]
	},
	answers: {
		q1: '4',
		q2: {
			'0': 'B'
		},
		q3: 'I added 2 and 2.'
	},
	review: {
		score: {
			got: 2,
			total: 4
		},
		label: '2/4 correct',
		message: 'Solid start.',
		note: 'Review the explanation question.',
		questions: {
			q1: {
				status: 'correct',
				note: 'Correct answer.'
			},
			q2: {
				status: 'correct',
				note: 'Correct option.'
			},
			q3: {
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

		expect(entries.map((entry) => entry.number)).toEqual([1, 2, 3]);
		expect(entries.map((entry) => entry.question.id)).toEqual(['q1', 'q2', 'q3']);
		expect(findWorksheetQuestionEntry(report.sheet, 'q3')?.section.label).toBe('Section A');
	});

	it('does not accept the old markdown-style problem artifact', () => {
		expect(safeParseGraderWorksheetReport('# Problem 1\n\nOld markdown report')).toBeNull();
	});

	it('coerces legacy worksheet draft question shapes into the current schema', () => {
		const draft = safeParseSolveSheetDraft(
			JSON.stringify({
				schemaVersion: 1,
				mode: 'draft',
				sheet: {
					id: 'division-of-fractions-2',
					subject: 'Mathematics',
					level: 'Fractions',
					title: 'Division of fractions (2)',
					subtitle:
						'Learning objective: Divide an integer or a fraction by a fraction and use the notation of reciprocals.',
					color: '#36587A',
					accent: '#4D7AA5',
					light: '#E8F2FB',
					border: '#BFD0E0',
					sections: [
						{
							title: 'A. Multiple choice questions',
							instructions: 'Choose the correct answer.',
							questions: [
								{
									type: 'mcq',
									displayNumber: '1',
									promptMarkdown: 'The correct calculation of the following is (___).',
									options: [
										{ id: 'A', text: '$$\\frac{1}{2}$$' },
										{ id: 'B', text: '$$\\frac{3}{4}$$' }
									]
								}
							]
						},
						{
							title: 'B. Fill in the blanks',
							questions: [
								{
									type: 'fill',
									displayNumber: '5',
									promptMarkdown: '___________ of $\\frac{1}{8}$ is 5.'
								}
							]
						},
						{
							title: 'C. Questions that require solutions',
							questions: [
								{
									type: 'calc',
									displayNumber: '9(a)',
									promptMarkdown: 'Calculate.\\n\\n$$3\\frac{1}{3}\\div \\frac{9}{2}$$'
								},
								{
									type: 'flow',
									displayNumber: '12',
									promptMarkdown:
										'Complete the flow chart of calculation. Write a suitable number in each box.',
									boxes: [
										{ id: 'top0', initialValue: '1', editable: false },
										{ id: 'top1' },
										{ id: 'top2' },
										{ id: 'bottom1' },
										{ id: 'bottom0' }
									],
									arrows: [
										{ from: 'top0', to: 'top1', label: '$\\div\\ \\frac{2}{3}$' },
										{ from: 'top1', to: 'top2', label: '$\\times\\ 2$' },
										{ from: 'bottom1', to: 'bottom0', label: '$-\\ 3$' }
									]
								}
							]
						}
					]
				}
			})
		);

		expect(draft).not.toBeNull();
		expect(draft?.sheet.sections[0]).toMatchObject({
			id: 'A',
			label: 'Multiple choice questions'
		});
		expect('id' in (draft?.sheet.sections[1] ?? {})).toBe(true);
		const secondSection = draft?.sheet.sections[1];
		if (!secondSection || !('id' in secondSection)) {
			throw new Error('Expected normalized content section');
		}
		expect(secondSection.questions?.[0]).toMatchObject({
			type: 'cloze',
			displayNumber: '5'
		});
		const thirdSection = draft?.sheet.sections[2];
		if (!thirdSection || !('id' in thirdSection)) {
			throw new Error('Expected normalized third section');
		}
		expect(thirdSection.questions?.[0]).toMatchObject({
			type: 'lines',
			displayNumber: '9(a)'
		});
		expect(thirdSection.questions?.[1]).toMatchObject({
			type: 'flow',
			displayNumber: '12'
		});
	});

	it('preserves structured fill questions that only omit marks', () => {
		const draft = safeParseSolveSheetDraft(
			JSON.stringify({
				schemaVersion: 1,
				mode: 'draft',
				sheet: {
					id: 'interest-sheet',
					subject: 'Mathematics',
					level: 'Secondary',
					title: 'Calculating interest and percentage',
					subtitle: 'Solve the worksheet.',
					color: '#36587A',
					accent: '#4D7AA5',
					light: '#E8F2FB',
					border: '#BFD0E0',
					sections: [
						{
							id: 'B',
							label: 'Fill in the blanks',
							questions: [
								{
									id: 'q4',
									type: 'fill',
									displayNumber: '4',
									prompt: 'Given that the taxable amount is £150 000 and the tax rate is 10.5%, the amount of tax to pay is £',
									blanks: [{}],
									after: ' .'
								},
								{
									id: 'q10a',
									type: 'fill',
									displayNumber: '10(a)',
									prompt: 'For a three-year fixed deposit of £10 000, the interest earned under the new interest rate will be £',
									blanks: [{}],
									after: ' less than the interest that would be earned under the original interest rate.'
								}
							]
						}
					]
				}
			})
		);

		expect(draft).not.toBeNull();
		const section = draft?.sheet.sections[0];
		if (!section || !('id' in section)) {
			throw new Error('Expected normalized content section');
		}
		expect(section.questions).toMatchObject([
			{
				type: 'fill',
				displayNumber: '4',
				marks: 1
			},
			{
				type: 'fill',
				displayNumber: '10(a)',
				marks: 1
			}
		]);
	});
});
