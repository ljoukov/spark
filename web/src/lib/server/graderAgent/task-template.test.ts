import { describe, expect, it } from 'vitest';

import graderTaskTemplate from './task-template.md?raw';

describe('grader task template', () => {
	it('does not force one subagent per problem', () => {
		expect(graderTaskTemplate).not.toContain('spawn exactly one subagent per problem');
		expect(graderTaskTemplate).toContain('keep short routine problems in the main agent');
		expect(graderTaskTemplate).toContain(
			'solution/explanation that would normally take about a page or more'
		);
		expect(graderTaskTemplate).toContain(
			'at most 6 subagents can be live at once; close finished subagents before spawning more'
		);
		expect(graderTaskTemplate).toContain('if you use a subagent, give it one problem only');
		expect(graderTaskTemplate).toContain(
			'use exactly one text instruction field (`prompt` or `message`)'
		);
		expect(graderTaskTemplate).toContain(
			'do not include `items` for workspace files or uploads'
		);
	});
});
