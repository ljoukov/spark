import { describe, expect, it } from 'vitest';

import {
	AMBIGUOUS_ATTACHMENT_CLARIFYING_QUESTION,
	buildForcedSparkChatStartedReply,
	buildForcedSparkChatToolInstruction,
	resolveForcedSparkChatToolForTurn,
	shouldAskClarifyingQuestionForAttachmentTurn
} from './turnRouting';

describe('resolveForcedSparkChatToolForTurn', () => {
	it('forces create_sheet for explicit worksheet-generation turns with attachments', () => {
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Create a student worksheet from the attached PDF.',
				hasAttachmentContext: true
			})
		).toBe('create_sheet');
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Turn these notes into questions for me to solve.',
				hasAttachmentContext: true
			})
		).toBe('create_sheet');
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Please make a worksheet based on the uploaded material for students to solve.',
				hasAttachmentContext: true
			})
		).toBe('create_sheet');
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Use this attached PDF to draft a question sheet.',
				hasAttachmentContext: true
			})
		).toBe('create_sheet');
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Make questions from this upload.',
				hasAttachmentContext: true
			})
		).toBe('create_sheet');
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Turn this PDF into something I can solve.',
				hasAttachmentContext: true
			})
		).toBe('create_sheet');
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Use that uploaded paper as a sheet for me to answer.',
				hasAttachmentContext: true
			})
		).toBe('create_sheet');
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Make a practice paper from the upload.',
				hasAttachmentContext: true
			})
		).toBe('create_sheet');
	});

	it('forces create_grader for explicit grading turns with attachments', () => {
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Please grade this worksheet.',
				hasAttachmentContext: true
			})
		).toBe('create_grader');
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Can you mark these answers?',
				hasAttachmentContext: true
			})
		).toBe('create_grader');
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Please grade and mark this uploaded Junior Mathematical Challenge question paper as a source-faithful worksheet in the graded sheet UI.',
				hasAttachmentContext: true
			})
		).toBe('create_grader');
	});

	it('does not force grading for model-answer requests that mention mark schemes or full marks', () => {
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Please give modal answers to these questions using mark scheme, please make them as short as possible but full marks',
				hasAttachmentContext: true
			})
		).toBeNull();
		expect(
			resolveForcedSparkChatToolForTurn({
				text: "No I didn't want you to mark, I want you to give model answers using papers and mark schemes, as short as possible and full marks.",
				hasAttachmentContext: true
			})
		).toBeNull();
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Please give a full-mark answer key for the uploaded paper.',
				hasAttachmentContext: true
			})
		).toBeNull();
	});

	it('does not force routing without attachment context or explicit action phrasing', () => {
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'What topics are covered in this worksheet?',
				hasAttachmentContext: true
			})
		).toBeNull();
		expect(
			resolveForcedSparkChatToolForTurn({
				text: 'Create a worksheet from this PDF.',
				hasAttachmentContext: false
			})
		).toBeNull();
	});
});

describe('attachment clarification fallback', () => {
	it('asks for a goal when the learner uploads files without any text request', () => {
		expect(
			shouldAskClarifyingQuestionForAttachmentTurn({
				text: '',
				currentMessageHasAttachments: true
			})
		).toBe(true);
		expect(AMBIGUOUS_ATTACHMENT_CLARIFYING_QUESTION).toContain('worksheet to solve');
	});

	it('does not trigger when the user already gave a text request', () => {
		expect(
			shouldAskClarifyingQuestionForAttachmentTurn({
				text: 'Create a worksheet from this PDF.',
				currentMessageHasAttachments: true
			})
		).toBe(false);
	});
});

describe('forced Spark chat tool messaging', () => {
	it('states that acknowledgements alone are not acceptable', () => {
		expect(buildForcedSparkChatToolInstruction('create_sheet')).toContain(
			'Do not emit an acknowledgement-only reply'
		);
		expect(buildForcedSparkChatToolInstruction('create_grader')).toContain(
			'Do not emit an acknowledgement-only reply'
		);
	});

	it('returns stable started replies for deterministic routing', () => {
		expect(buildForcedSparkChatStartedReply('create_sheet')).toContain('/spark/sheets');
		expect(buildForcedSparkChatStartedReply('create_grader')).toContain('grading run');
	});
});
