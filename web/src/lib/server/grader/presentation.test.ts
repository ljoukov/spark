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
					'- Graded all 8 uploaded problems.\n- Student work was present on every graded problem.'
			},
			totals: {
				problemCount: 8,
				gradedCount: 8
			},
			problems: [{ index: 1 }, { index: 2 }, { index: 8 }]
		});

		expect(display.title).toBe('Hamilton 2017 submission');
		expect(display.metaLine).toBe('2017 • Hamilton Olympiad');
		expect(display.summaryMarkdown).toContain('Graded all 8 uploaded problems.');
	});

	it('drops machine-style result summaries and falls back to structured text', () => {
		const display = buildGraderRunDisplay({
			status: 'done',
			paper: {
				contextLabel: 'Unknown (not identifiable from uploaded materials only)',
				year: 'Unknown',
				paperName: 'Unknown paper (uploaded excerpt contains Problem 8 only)'
			},
			totals: {
				problemCount: 1,
				gradedCount: 1
			},
			problems: [{ index: 8 }],
			resultSummary:
				'Completed grader run 8c08e319-01f3-4d9c-ade1-0416e3892cd1 using uploaded-only sources. Wrote grader/output/run-summary.json.'
		});

		expect(display.title).toBe('Problem 8 submission');
		expect(display.metaLine).toBeNull();
		expect(display.summaryMarkdown).toContain('Problem 8 only');
		expect(display.summaryMarkdown).not.toContain('grader/output');
	});

	it('describes partial gradability for multi-problem uploads', () => {
		const display = buildGraderRunDisplay({
			status: 'done',
			totals: {
				problemCount: 8,
				gradedCount: 5
			},
			problems: [
				{ index: 1 },
				{ index: 2 },
				{ index: 3 },
				{ index: 4 },
				{ index: 5 },
				{ index: 6 },
				{ index: 7 },
				{ index: 8 }
			]
		});

		expect(display.title).toBe('Problems 1-8 submission');
		expect(display.summaryMarkdown).toContain('Problems 1-8');
		expect(display.summaryMarkdown).toContain('5 of 8 problems');
	});

	it('uses a neutral fallback title when no paper context is known', () => {
		const display = buildGraderRunDisplay({
			status: 'created'
		});

		expect(display.title).toBe('Uploaded submission');
		expect(display.metaLine).toBeNull();
		expect(display.summaryMarkdown).toBe('Waiting for grading to start.');
	});
});
