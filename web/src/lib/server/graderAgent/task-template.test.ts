import { describe, expect, it } from 'vitest';

import graderTaskTemplate from './task-template.md?raw';

describe('grader task template', () => {
	it('stays thin and delegates detailed workflow to skills', () => {
		expect(graderTaskTemplate.length).toBeLessThan(10000);
		expect(graderTaskTemplate).toContain('skills/paper-to-sheet/SKILL.md');
		expect(graderTaskTemplate).toContain('skills/handwritten-answers-to-sheet/SKILL.md');
		expect(graderTaskTemplate).toContain('skills/source-image-cropping/SKILL.md');
		expect(graderTaskTemplate).toContain('The detailed reusable workflow lives in skills');
	});

	it('keeps mode choice and publish contract in the harness', () => {
		expect(graderTaskTemplate).toContain('## Mode Decision');
		expect(graderTaskTemplate).toContain('`handwritten-grading`');
		expect(graderTaskTemplate).toContain('compact scored worksheet report');
		expect(graderTaskTemplate).toContain('`source-paper-only`');
		expect(graderTaskTemplate).toContain('"presentation": {');
		expect(graderTaskTemplate).toContain('"filePath": "grader/output/sheet.json"');
		expect(graderTaskTemplate).toContain('publish_sheet({})');
	});

	it('keeps mechanical schema requirements close to the output contract', () => {
		expect(graderTaskTemplate).toContain('If you include `year`, write it as a string');
		expect(graderTaskTemplate).toContain('every scored review entry must include `status` and `score`');
		expect(graderTaskTemplate).toContain('full graded worksheet report wrapper');
		expect(graderTaskTemplate).toContain('`schemaVersion`, `sheet`, `answers`, `review`');
		expect(graderTaskTemplate).toContain('answers belong only in the top-level `answers` object');
		expect(graderTaskTemplate).toContain('use `status: "correct"` only for full marks');
		expect(graderTaskTemplate).toContain('[got/total mark(s)]');
		expect(graderTaskTemplate).toContain('Do not use `generate_json`');
		expect(graderTaskTemplate).toContain('validate_grader_artifacts');
		expect(graderTaskTemplate).toContain('Use returned question/modelAnswer results directly');
		expect(graderTaskTemplate).toContain('even when the learner asks for model answers');
		expect(graderTaskTemplate).toContain('preserving `teacher-review`');
		expect(graderTaskTemplate).toContain('Preserve returned scores/statuses');
		expect(graderTaskTemplate).toContain('The next non-repair tool call must be');
		expect(graderTaskTemplate).toContain('Do not reread every scoring file');
		expect(graderTaskTemplate).toContain('omit optional enrichment');
		expect(graderTaskTemplate).toContain('never write a bare `type: "calc"`');
	});

	it('keeps subagents bounded and crop validation dedicated', () => {
		expect(graderTaskTemplate).not.toContain('spawn exactly one subagent per problem');
		expect(graderTaskTemplate).toContain('Use `view_image` for source-page/photo fidelity checks');
		expect(graderTaskTemplate).toContain('Generic subagents may be used only');
		expect(graderTaskTemplate).toContain('pre-publish source-fidelity audits');
		expect(graderTaskTemplate).toContain('split long material by source page or root question');
		expect(graderTaskTemplate).toContain('validate_crop_with_fresh_agent');
		expect(graderTaskTemplate).toContain('review_run_progress_with_fresh_agent');
	});
});
