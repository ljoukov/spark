import { describe, expect, it } from 'vitest';

import { resolveChatInputExpansionState } from './chat-input';

describe('resolveChatInputExpansionState', () => {
	it('sticks to multiline for chat input after visual overflow until cleared', () => {
		const expanded = resolveChatInputExpansionState({
			value: 'word '.repeat(60),
			variant: 'chat',
			stickyExpanded: false,
			hasVisualOverflow: true
		});
		expect(expanded).toMatchObject({
			isExpanded: true,
			nextStickyExpanded: true,
			baseMinLines: 2
		});

		const shortened = resolveChatInputExpansionState({
			value: 'word',
			variant: 'chat',
			stickyExpanded: expanded.nextStickyExpanded,
			hasVisualOverflow: false
		});
		expect(shortened).toMatchObject({
			isExpanded: true,
			nextStickyExpanded: true,
			baseMinLines: 2
		});

		const cleared = resolveChatInputExpansionState({
			value: '',
			variant: 'chat',
			stickyExpanded: shortened.nextStickyExpanded,
			hasVisualOverflow: false
		});
		expect(cleared).toMatchObject({
			isExpanded: false,
			nextStickyExpanded: false,
			baseMinLines: 1
		});
	});

	it('uses three minimum lines when chat input contains a newline', () => {
		expect(
			resolveChatInputExpansionState({
				value: 'first line\nsecond line',
				variant: 'chat',
				stickyExpanded: false,
				hasVisualOverflow: false
			})
		).toMatchObject({
			isExpanded: true,
			nextStickyExpanded: true,
			baseMinLines: 3
		});
	});

	it('does not keep non-chat inputs sticky after overflow disappears', () => {
		const expanded = resolveChatInputExpansionState({
			value: 'word '.repeat(60),
			variant: 'default',
			stickyExpanded: false,
			hasVisualOverflow: true
		});
		expect(expanded).toMatchObject({
			isExpanded: true,
			nextStickyExpanded: true,
			baseMinLines: 2
		});

		expect(
			resolveChatInputExpansionState({
				value: 'word',
				variant: 'default',
				stickyExpanded: expanded.nextStickyExpanded,
				hasVisualOverflow: false
			})
		).toMatchObject({
			isExpanded: false,
			nextStickyExpanded: false,
			baseMinLines: 1
		});
	});
});
