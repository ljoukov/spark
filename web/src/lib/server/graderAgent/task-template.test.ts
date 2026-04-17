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
	});

	it('keeps subagents bounded and crop validation dedicated', () => {
		expect(graderTaskTemplate).not.toContain('spawn exactly one subagent per problem');
		expect(graderTaskTemplate).toContain('Direct `view_image` is intentionally not available');
		expect(graderTaskTemplate).toContain('Generic subagents may be used only');
		expect(graderTaskTemplate).toContain('validate_crop_with_fresh_agent');
		expect(graderTaskTemplate).toContain('review_run_progress_with_fresh_agent');
	});
});
