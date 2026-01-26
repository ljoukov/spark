import { describe, expect, it } from 'vitest';
import { createFeedbackStreamParser } from './feedbackStream';

describe('createFeedbackStreamParser', () => {
	it('emits feedback only after the marker', () => {
		const parser = createFeedbackStreamParser();
		expect(parser.append('%AWARDED_MARKS%: 2\n')).toBeNull();
		expect(parser.append('%MAX_MARKS%: 4\n')).toBeNull();
		expect(parser.append('%FEEDBACK%:\n### (a) Your grade')).toBe('### (a) Your grade');
	});

	it('handles markers split across chunks', () => {
		const parser = createFeedbackStreamParser();
		expect(parser.append('%FEED')).toBeNull();
		expect(parser.append('BACK%:\nLine 1')).toBe('Line 1');
	});

	it('appends subsequent deltas after the marker', () => {
		const parser = createFeedbackStreamParser();
		parser.append('%FEEDBACK%:\n### (a) First');
		expect(parser.append('\nSecond line')).toBe('### (a) First\nSecond line');
	});
});
