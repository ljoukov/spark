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
				subtitle: 'Student solutions checked against the uploaded olympiad paper.',
				summaryMarkdown:
					'- Graded the uploaded worksheet.\n- Student work was present on the sheet.',
				footer: 'Hamilton Olympiad · uploaded paper'
			}
		});

		expect(display.title).toBe('Hamilton 2017 submission');
		expect(display.subtitle).toBe('Student solutions checked against the uploaded olympiad paper.');
		expect(display.metaLine).toBe('2017 • Hamilton Olympiad');
		expect(display.summaryMarkdown).toContain('Graded the uploaded worksheet.');
		expect(display.footer).toBe('Hamilton Olympiad · uploaded paper');
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

		expect(display.title).toBe('Student worksheet');
		expect(display.subtitle).toBe('Worksheet review prepared.');
		expect(display.metaLine).toBeNull();
		expect(display.summaryMarkdown).toContain(
			'worksheet source could not be confidently identified'
		);
		expect(display.summaryMarkdown).not.toContain('grader run');
		expect(display.footer).toBe('Uploaded material');
	});

	it('drops process-language footers and rebuilds source identity', () => {
		const display = buildGraderRunDisplay({
			status: 'done',
			paper: {
				contextLabel: 'AQA GCSE Biology',
				year: '2023',
				paperName: '8461/1H Paper 1 Higher Tier'
			},
			presentation: {
				title: 'AQA GCSE Biology 8461/1H Paper 1 Higher Tier',
				subtitle: 'June 2023 source worksheet',
				footer: 'Question paper transcription'
			}
		});

		expect(display.footer).toBe('AQA GCSE Biology · 8461/1H Paper 1 Higher Tier · 2023');
	});

	it('uses the presentation title when process footer has no paper metadata', () => {
		const display = buildGraderRunDisplay({
			status: 'done',
			presentation: {
				title: 'AQA GCSE Biology Higher Tier Paper 1H',
				subtitle: 'June 2023 source worksheet',
				footer: 'Question paper transcription'
			}
		});

		expect(display.footer).toBe('AQA GCSE Biology Higher Tier Paper 1H · June 2023');
	});

	it('describes an active grading state without old problem wording', () => {
		const display = buildGraderRunDisplay({
			status: 'executing'
		});

		expect(display.title).toBe('Student worksheet');
		expect(display.subtitle).toBe('Submitted answers are being graded.');
		expect(display.summaryMarkdown).toBe('This sheet is still being graded.');
		expect(display.footer).toBe('Uploaded material');
	});

	it('does not carry in-progress copy onto a graded sheet display', () => {
		const display = buildGraderRunDisplay({
			status: 'executing',
			sheetPhase: 'graded',
			presentation: {
				title: 'Student worksheet',
				subtitle: 'Submitted answers are being graded.',
				summaryMarkdown: 'This sheet is still being graded.',
				footer: 'Uploaded material'
			}
		});

		expect(display.subtitle).toBe('Worksheet review prepared.');
		expect(display.summaryMarkdown).toBe(
			'The worksheet source could not be confidently identified.'
		);
	});

	it('uses a neutral fallback title when no paper context is known', () => {
		const display = buildGraderRunDisplay({
			status: 'created'
		});

		expect(display.title).toBe('Student worksheet');
		expect(display.subtitle).toBe('Queued for sheet generation.');
		expect(display.metaLine).toBeNull();
		expect(display.summaryMarkdown).toBe('Waiting for grading to start.');
		expect(display.footer).toBe('Uploaded material');
	});

	it('describes a ready-to-solve draft sheet separately from graded output', () => {
		const display = buildGraderRunDisplay({
			status: 'done',
			sheetPhase: 'solving'
		});

		expect(display.title).toBe('Student worksheet');
		expect(display.subtitle).toBe('Worksheet draft prepared.');
		expect(display.summaryMarkdown).toBe('This sheet is ready to solve.');
		expect(display.footer).toBe('Uploaded material');
	});
});
