import { describe, expect, it } from 'vitest';

import graderTaskTemplate from './task-template.md?raw';

describe('grader task template', () => {
	it('does not force one subagent per problem', () => {
		expect(graderTaskTemplate).not.toContain('spawn exactly one subagent per problem');
		expect(graderTaskTemplate).toContain(
			'keep short routine worksheet questions in the main agent'
		);
		expect(graderTaskTemplate).toContain('generic `spawn_agent` is not available');
		expect(graderTaskTemplate).toContain('validate_crop_with_fresh_agent');
		expect(graderTaskTemplate).toContain('must not be used for intake');
	});

	it('allows answer-bank, cloze, and flow worksheet questions in graded sheets', () => {
		expect(graderTaskTemplate).toContain(
			'the worksheet UI supports these question types: `group`, `answer_bank`, `fill`, `cloze`, `mcq`, `lines`, `calc`, `match`, `spelling`, `flow`'
		);
		expect(graderTaskTemplate).toContain(
			'`answer_bank` for visible blanks paired with a fixed printed option bank such as `(A)` to `(D)`'
		);
		expect(graderTaskTemplate).toContain(
			'`answer_bank.segments[]` must stay as clean prose around the interactive blank'
		);
		expect(graderTaskTemplate).toContain('`cloze` for short inline multi-blank text');
		expect(graderTaskTemplate).toContain('`flow` for printed box-and-arrow calculations');
		expect(graderTaskTemplate).toContain('`mcq` questions must include structured `options[]`');
		expect(graderTaskTemplate).toContain('valid `displayMode`');
	});

	it('keeps objective answer capture strict and supports official references', () => {
		expect(graderTaskTemplate).toContain('keep answer capture separate from solving');
		expect(graderTaskTemplate).toContain('record a selected MCQ/objective option only');
		expect(graderTaskTemplate).toContain('treat the response as blank/no-answer');
		expect(graderTaskTemplate).toContain('Use `""` for an unanswered MCQ value');
		expect(graderTaskTemplate).toContain('omit `officialSolutionMarkdown`');
		expect(graderTaskTemplate).toContain('allow-official-references');
		expect(graderTaskTemplate).toContain(
			'official answer keys, mark schemes, or official solutions'
		);
	});

	it('requires source-faithful grouped structure, figures, and per-question marks', () => {
		expect(graderTaskTemplate).toContain('the worksheet UI supports these question types: `group`');
		expect(graderTaskTemplate).toContain('source problem-statement transcription');
		expect(graderTaskTemplate).toContain('represent every assessed source question and subquestion');
		expect(graderTaskTemplate).toContain('use worksheet sections as useful collapsible navigation');
		expect(graderTaskTemplate).toContain('use one section per root question');
		expect(graderTaskTemplate).toContain('contiguous neutral ranges such as `Questions 1-5`');
		expect(graderTaskTemplate).toContain('do not group multiple multi-part root questions');
		expect(graderTaskTemplate).toContain('do not put a whole long paper into one giant `Questions` section');
		expect(graderTaskTemplate).toContain('omit cover-page and administration boilerplate');
		expect(graderTaskTemplate).toContain('even when only one marked child subpart is visible');
		expect(graderTaskTemplate).toContain('do not duplicate the root stem inside the first child prompt');
		expect(graderTaskTemplate).toContain('crop it from the source into `grader/output/assets/...`');
		expect(graderTaskTemplate).toContain('clickable image link');
		expect(graderTaskTemplate).toContain('validate_crop_with_fresh_agent');
		expect(graderTaskTemplate).toContain('transcribe all visible text in the crop');
		expect(graderTaskTemplate).toContain('use `pad_image`');
		expect(graderTaskTemplate).toContain('extract_pdf_reference_text');
		expect(graderTaskTemplate).toContain('## Source problem-statement transcription');
		expect(graderTaskTemplate).toContain('fresh reviewer');
		expect(graderTaskTemplate).toContain('Spot-check representative crops');
		expect(graderTaskTemplate).toContain('not a mid-diagram fragment');
		expect(graderTaskTemplate).toContain('exclude duplicated caption/question text');
		expect(graderTaskTemplate).toContain('rectangular crop workflow');
		expect(graderTaskTemplate).toContain('bboxPixels');
		expect(graderTaskTemplate).toContain('"cropBase": "badCrop" | "fullPage"');
		expect(graderTaskTemplate).toContain('remove bare `(A)`, `(B)`, `(C)`, `(D)` lines');
		expect(graderTaskTemplate).toContain('metadata natural and non-redundant');
		expect(graderTaskTemplate).toContain('compact tier/level');
		expect(graderTaskTemplate).toContain('source/provenance identity only');
		expect(graderTaskTemplate).toContain('Question paper transcription');
		expect(graderTaskTemplate).toContain('propose_crop_bbox_with_fresh_agent');
		expect(graderTaskTemplate).toContain('do not publish known-failed crop validation');
		expect(graderTaskTemplate).toContain('do not work around the budget by linking full-page/page fallback images');
		expect(graderTaskTemplate).toContain('grader/output/crop-validation.md');
		expect(graderTaskTemplate).toContain('that validation is stale');
		expect(graderTaskTemplate).toContain('review.message');
		expect(graderTaskTemplate).toContain('Compare how much blue and green light chlorophyll absorbs');
		expect(graderTaskTemplate).toContain('directly stating the correct answer');
		expect(graderTaskTemplate).toContain('Do not output derived answers');
		expect(graderTaskTemplate).toContain('Do not say you cannot access the local PDF');
		expect(graderTaskTemplate).toContain('Do not write `request.json`');
		expect(graderTaskTemplate).toContain('Do not use `generate_json`');
		expect(graderTaskTemplate).toContain('generic `spawn_agent` is not available');
		expect(graderTaskTemplate).toContain(
			'entry must include `score: { "got": number, "total": number }`'
		);
	});

	it('requires the current nested grader run-summary shape', () => {
		expect(graderTaskTemplate).toContain('"presentation": {');
		expect(graderTaskTemplate).toContain('presentation.summaryMarkdown');
		expect(graderTaskTemplate).toContain('Do not write the legacy flat summary shape');
		expect(graderTaskTemplate).toContain('bodySummaryMarkdown');
		expect(graderTaskTemplate).toContain('footerProvenance');
	});

	it('keeps view_image fallback available for rendered workspace images', () => {
		expect(graderTaskTemplate).toContain(
			'if `view_image` fails on any workspace image or rendered PDF page'
		);
		expect(graderTaskTemplate).toContain(
			'use `crop_image` to create a local PNG overview or relevant crop'
		);
		expect(graderTaskTemplate).toContain(
			'do not switch to `extract_pdf_diagrams` as a fallback for `view_image` failures'
		);
	});
});
