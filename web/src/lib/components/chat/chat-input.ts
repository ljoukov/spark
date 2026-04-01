export type ChatInputVariant = 'default' | 'chat';

export function resolveChatInputExpansionState(options: {
	value: string;
	variant: ChatInputVariant;
	stickyExpanded: boolean;
	hasVisualOverflow: boolean;
}): {
	isExpanded: boolean;
	nextStickyExpanded: boolean;
	baseMinLines: number;
} {
	const hasValue = options.value.length > 0;
	const wantsExtraLine = options.variant === 'chat' && options.value.includes('\n');
	let nextStickyExpanded = options.stickyExpanded;

	if (!hasValue) {
		nextStickyExpanded = false;
	} else if (options.variant !== 'chat') {
		nextStickyExpanded = wantsExtraLine || options.hasVisualOverflow;
	} else if (wantsExtraLine || options.hasVisualOverflow) {
		nextStickyExpanded = true;
	}

	const isExpanded = hasValue && nextStickyExpanded;
	const baseMinLines = wantsExtraLine ? 3 : isExpanded ? 2 : 1;
	return {
		isExpanded,
		nextStickyExpanded,
		baseMinLines
	};
}
