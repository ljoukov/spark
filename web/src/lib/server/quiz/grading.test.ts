import { describe, expect, it } from 'vitest';
import { parseGradeOutput } from './grading';

describe('parseGradeOutput', () => {
	it('parses awarded marks, max marks, and feedback', () => {
		const raw = [
			'%AWARDED_MARKS%: 2',
			'%MAX_MARKS%: 4',
			'%FEEDBACK%:',
			'### (a) Your grade and feedback',
			'**Mark:** **2/4**',
			'Reason: Clear start but missing immune detail.',
			'',
			'---',
			'',
			'### (c) Marking points (1 bullet per mark)',
			'Point one',
			'Point two'
		].join('\n');

		const parsed = parseGradeOutput(raw, 4);
		expect(parsed.awardedMarks).toBe(2);
		expect(parsed.maxMarks).toBe(4);
		expect(parsed.feedback).toContain('- Point one');
		expect(parsed.feedback).toContain('- Point two');
	});

	it('falls back to provided max marks when missing', () => {
		const raw = [
			'%AWARDED_MARKS%: 3',
			'%FEEDBACK%:',
			'### (a) Your grade and feedback',
			'**Mark:** **3/6**',
			'Reason: ...'
		].join('\n');

		const parsed = parseGradeOutput(raw, 6);
		expect(parsed.maxMarks).toBe(6);
	});

	it('derives marks from the Mark line when keys are missing', () => {
		const raw = [
			'### (a) Your grade and feedback',
			'**Mark:** **3/5**',
			'Reason: ...',
			'',
			'---',
			'',
			'### (c) Marking points (1 bullet per mark)',
			'Point one'
		].join('\n');

		const parsed = parseGradeOutput(raw, 5);
		expect(parsed.awardedMarks).toBe(3);
		expect(parsed.maxMarks).toBe(5);
	});

	it('throws when feedback is missing', () => {
		const raw = ['%AWARDED_MARKS%: 1', '%MAX_MARKS%: 2'].join('\n');
		expect(() => parseGradeOutput(raw, 2)).toThrow(/feedback/i);
	});
});
