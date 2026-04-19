import { describe, expect, it } from 'vitest';

import { CLOSE_GAP_NO_IMMEDIATE_MODEL_ANSWER_RULES } from './closeGapRules';

describe('close-gap tutor answer-reveal rules', () => {
	it('keeps model answers private on the first gap-closing reply', () => {
		const promptText = CLOSE_GAP_NO_IMMEDIATE_MODEL_ANSWER_RULES.join('\n');

		expect(promptText).toContain('first close-gap reply');
		expect(promptText).toContain('do not provide a final answer');
		expect(promptText).toContain('full worked solution');
		expect(promptText).toContain('give me the answer/model answer');
		expect(promptText).toContain('hint/checkpoint first');
	});
});
