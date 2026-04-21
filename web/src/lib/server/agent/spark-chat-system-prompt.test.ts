import { describe, expect, it } from 'vitest';

import sparkChatSystemPrompt from './spark-chat-system-prompt.md?raw';

describe('spark chat system prompt', () => {
	it('asks a clarifying question for upload-only turns', () => {
		expect(sparkChatSystemPrompt).toContain(
			'ask one concise clarifying question instead of guessing the goal'
		);
		expect(sparkChatSystemPrompt).toContain('Do not proactively summarize the uploaded content');
	});

	it('requires immediate worksheet tool routing for explicit attachment-based requests', () => {
		expect(sparkChatSystemPrompt).toContain('call create_sheet immediately in that same response');
		expect(sparkChatSystemPrompt).toContain(
			'Do not claim the sheet is ready unless create_sheet returned status="started"'
		);
	});

	it('treats uploaded question sheets as canonical worksheet sources', () => {
		expect(sparkChatSystemPrompt).toContain(
			'default to source-faithful transcription into the worksheet draft'
		);
	});

	it('requires immediate grading tool routing for explicit attachment-based requests', () => {
		expect(sparkChatSystemPrompt).toContain('call create_grader immediately in that same response');
	});

	it('does not route model-answer requests to grading', () => {
		expect(sparkChatSystemPrompt).toContain(
			'Requests for model answers, full-mark answers, answer keys, worked solutions'
		);
		expect(sparkChatSystemPrompt).toContain('Do not treat the noun phrase "mark scheme"');
	});

	it('allows official grading references unless the learner forbids online lookup', () => {
		expect(sparkChatSystemPrompt).toContain('referenceSourcePolicy="allow-official-references"');
		expect(sparkChatSystemPrompt).toContain('explicitly says not to search online');
		expect(sparkChatSystemPrompt).toContain('referenceSourcePolicy="uploaded-only"');
	});
});
