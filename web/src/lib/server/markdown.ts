import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';

marked.setOptions({ breaks: true, gfm: true });
marked.use(
	markedKatex({
		throwOnError: false,
		// Allow inline math without requiring surrounding spaces (e.g. "($N!$)").
		nonStandard: true
	})
);

export function renderMarkdown(markdown: string): string {
	const parsed = marked.parse(markdown);
	return typeof parsed === 'string' ? parsed : '';
}

export function renderMarkdownOptional(value?: string | null): string | undefined {
	if (!value) {
		return undefined;
	}

	const rendered = renderMarkdown(value);
	const trimmed = rendered.trim();
	return trimmed.length > 0 ? rendered : undefined;
}
