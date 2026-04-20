import { describe, expect, it } from 'vitest';

import type { SparkGraderWorksheetReport } from '@spark/schemas';

import {
	appendTutorReviewMessage,
	buildInitialTutorReviewState,
	buildTutorReviewFocusLabel,
	buildTutorReviewPreview,
	findTutorReviewThread,
	summarizeTutorReviewState,
	syncTutorReviewStateWithReport,
	updateTutorReviewThread
} from './reviewState';

const worksheetReport: SparkGraderWorksheetReport = {
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
						displayMode: 'full_options',
						prompt: 'What is 2 + 2?',
						options: [
							{ id: 'A', label: 'A', text: '3' },
							{ id: 'B', label: 'B', text: '4' }
						]
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
		q1: 'B',
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
};

describe('worksheet tutor review state', () => {
	it('opens review threads per worksheet question and focuses the first unresolved one', () => {
		const reviewState = buildInitialTutorReviewState({
			report: worksheetReport,
			now: new Date('2026-03-17T13:00:00.000Z')
		});

		expect(reviewState.threads.q1?.status).toBe('resolved');
		expect(reviewState.threads.q2?.status).toBe('open');
		expect(buildTutorReviewFocusLabel(reviewState)).toBe('Question 2');
		expect(buildTutorReviewPreview(reviewState)).toBe('1 worksheet question still needs revision.');
	});

	it('marks the worksheet summary resolved once the last open question is resolved', () => {
		const initialState = buildInitialTutorReviewState({
			report: worksheetReport,
			now: new Date('2026-03-17T13:00:00.000Z')
		});
		const q2Thread = findTutorReviewThread(initialState, 'q2');
		expect(q2Thread).not.toBeNull();
		if (!q2Thread) {
			return;
		}

		const resolvedThread = appendTutorReviewMessage({
			thread: q2Thread,
			author: 'assistant',
			markdown: 'Yes, that completes the missing reasoning step.',
			createdAt: '2026-03-17T13:05:00.000Z',
			status: 'resolved',
			resolvedAt: '2026-03-17T13:05:00.000Z'
		});
		const nextState = updateTutorReviewThread({
			reviewState: initialState,
			thread: resolvedThread,
			now: new Date('2026-03-17T13:05:00.000Z')
		});
		const summary = summarizeTutorReviewState(nextState);

		expect(summary.allResolved).toBe(true);
		expect(buildTutorReviewFocusLabel(nextState)).toBe('Resolved');
		expect(buildTutorReviewPreview(nextState)).toBe('All 2 worksheet comments resolved.');
	});

	it('refreshes stale session sheet content from the latest report', () => {
		const initialState = buildInitialTutorReviewState({
			report: worksheetReport,
			now: new Date('2026-03-17T13:00:00.000Z')
		});
		const staleState = {
			...initialState,
			sheet: {
				...initialState.sheet,
				sections: initialState.sheet.sections.map((section) =>
					'id' in section
						? {
								...section,
								questions: section.questions?.map((question) =>
									question.id === 'q2'
										? {
												...question,
												prompt: 'Old image: grader/output/assets/q2-diagram.jpg'
											}
										: question
								)
							}
						: section
				)
			}
		};
		const updatedReport: SparkGraderWorksheetReport = {
			...worksheetReport,
			sheet: {
				...worksheetReport.sheet,
				sections: worksheetReport.sheet.sections.map((section) =>
					'id' in section
						? {
								...section,
								questions: section.questions?.map((question) =>
									question.id === 'q2'
										? {
												...question,
												prompt: 'New image: grader/output/assets/q2-diagram.svg'
											}
										: question
								)
							}
						: section
				)
			}
		};

		const nextState = syncTutorReviewStateWithReport({
			reviewState: staleState,
			report: updatedReport,
			now: new Date('2026-03-17T13:05:00.000Z')
		});

		expect(nextState.sheet.sections).toEqual(updatedReport.sheet.sections);
		expect(nextState.threads.q2?.status).toBe('open');
	});
});
