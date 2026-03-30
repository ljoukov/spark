import { describe, expect, it } from 'vitest';

import { buildGraderRunDisplay } from './presentation';

describe('buildGraderRunDisplay', () => {
	it('uses the explicit presentation payload when present', () => {
		const display = buildGraderRunDisplay({
			status: 'done',
			paper: {
				contextLabel: 'Hamilton Olympiad',
				year: '2017',
				paperName: 'Hamilton Olympiad 2017'
			},
			presentation: {
				title: 'Hamilton 2017 submission',
				summaryMarkdown:
					'- Graded the uploaded worksheet.\n- Student work was present on the sheet.'
			}
		});

		expect(display.title).toBe('Hamilton 2017 submission');
		expect(display.metaLine).toBe('2017 • Hamilton Olympiad');
		expect(display.summaryMarkdown).toContain('Graded the uploaded worksheet.');
	});

	it('drops machine-style result summaries and falls back to structured text', () => {
		const display = buildGraderRunDisplay({
			status: 'done',
			paper: {
				contextLabel: 'Unknown (not identifiable from uploaded materials only)',
				year: 'Unknown',
				paperName: 'Unknown paper (uploaded excerpt contains Problem 8 only)'
			},
			resultSummary:
				'Completed grader run 8c08e319-01f3-4d9c-ade1-0416e3892cd1 using uploaded-only sources. Wrote grader/output/run-summary.json.'
		});

		expect(display.title).toBe('Uploaded worksheet');
		expect(display.metaLine).toBeNull();
		expect(display.summaryMarkdown).toContain('worksheet source could not be confidently identified');
		expect(display.summaryMarkdown).not.toContain('grader run');
	});

	it('describes an active grading state without old problem wording', () => {
		const display = buildGraderRunDisplay({
			status: 'executing'
		});

		expect(display.title).toBe('Uploaded worksheet');
		expect(display.summaryMarkdown).toBe('This sheet is still being graded.');
	});

	it('uses a neutral fallback title when no paper context is known', () => {
		const display = buildGraderRunDisplay({
			status: 'created'
		});

		expect(display.title).toBe('Uploaded worksheet');
		expect(display.metaLine).toBeNull();
		expect(display.summaryMarkdown).toBe('Waiting for grading to start.');
	});

	it('describes a ready-to-solve draft sheet separately from graded output', () => {
		const display = buildGraderRunDisplay({
			status: 'done',
			sheetPhase: 'solving'
		});

		expect(display.title).toBe('Uploaded worksheet');
		expect(display.summaryMarkdown).toBe('This sheet is ready to solve.');
	});
});
