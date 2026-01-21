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

function normalizeDisplayMathBlocks(markdown: string): string {
	const lines = markdown.split(/\r?\n/u);
	let inFence = false;
	let inMathBlock = false;
	const normalized: string[] = [];

	const ensureBlankLineBefore = () => {
		if (normalized.length === 0) {
			return;
		}
		const last = normalized[normalized.length - 1];
		if (last !== undefined && last.trim() !== '') {
			normalized.push('');
		}
	};

	const ensureBlankLineAfter = (nextLine: string | undefined) => {
		if (!nextLine) {
			return;
		}
		if (nextLine.trim() !== '') {
			normalized.push('');
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (trimmed.startsWith('```')) {
			inFence = !inFence;
			normalized.push(line);
			continue;
		}
		if (inFence) {
			normalized.push(line);
			continue;
		}

		if (trimmed === '[') {
			ensureBlankLineBefore();
			inMathBlock = true;
			normalized.push('$$');
			continue;
		}

		if (trimmed === ']') {
			if (inMathBlock) {
				inMathBlock = false;
				normalized.push('$$');
				const next = lines[i + 1];
				ensureBlankLineAfter(next);
				continue;
			}
			normalized.push(line);
			continue;
		}

		if (trimmed === '$$') {
			ensureBlankLineBefore();
			normalized.push('$$');
			if (inMathBlock) {
				inMathBlock = false;
				const next = lines[i + 1];
				ensureBlankLineAfter(next);
			} else {
				inMathBlock = true;
			}
			continue;
		}

		normalized.push(line);
	}

	return normalized.join('\n');
}

export function renderMarkdown(markdown: string): string {
	const normalized = normalizeDisplayMathBlocks(markdown);
	const parsed = marked.parse(normalized);
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
