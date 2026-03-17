import { marked, type TokenizerAndRendererExtension } from 'marked';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import katex from 'katex';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);

const LANGUAGE_ALIASES = new Map<string, string>([
	['js', 'javascript'],
	['javascript', 'javascript'],
	['ts', 'typescript'],
	['typescript', 'typescript'],
	['py', 'python'],
	['python', 'python'],
	['c', 'c'],
	['c++', 'cpp'],
	['cpp', 'cpp'],
	['cc', 'cpp'],
	['cxx', 'cpp']
]);

const LANGUAGE_LABELS = new Map<string, string>([
	['javascript', 'js'],
	['typescript', 'ts'],
	['python', 'python'],
	['c', 'c'],
	['cpp', 'c++']
]);

const INLINE_PAREN_MATH_RULE = /^\\\(((?:\\.|[^\\\n])+?)\\\)/;
const INLINE_BRACKET_MATH_RULE = /^\\\[(((?:\\.|[^\\\n])+?))\\\]/;
const BLOCK_BRACKET_MATH_RULE = /^\\\[\n((?:\\[^]|[^\\])+?)\n\\\](?:\n|$)/;

marked.setOptions({ breaks: true, gfm: true });
marked.use(
	markedKatex({
		throwOnError: false,
		// Allow inline math without requiring surrounding spaces (e.g. "($N!$)").
		nonStandard: true
	})
);
marked.use({
	extensions: [createInlineBackslashMathExtension(), createBlockBackslashMathExtension()]
});

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function resolveLanguageLabel(raw: string, normalized: string): string {
	if (normalized && LANGUAGE_LABELS.has(normalized)) {
		return LANGUAGE_LABELS.get(normalized) ?? raw;
	}
	return raw || normalized || 'text';
}

type CodeSpanMath = { expr: string; displayMode: boolean };
type BackslashMathToken = {
	type: 'inlineBackslashMath' | 'blockBackslashMath';
	raw: string;
	text: string;
	displayMode: boolean;
};

function renderKatex(expr: string, displayMode: boolean): string {
	return katex.renderToString(expr, {
		displayMode,
		throwOnError: false
	});
}

function createInlineBackslashMathExtension(): TokenizerAndRendererExtension {
	return {
		name: 'inlineBackslashMath',
		level: 'inline',
		start(src) {
			const parenIndex = src.indexOf('\\(');
			const bracketIndex = src.indexOf('\\[');
			if (parenIndex === -1) {
				if (bracketIndex === -1) {
					return;
				}
				return bracketIndex;
			}
			if (bracketIndex === -1) {
				return parenIndex;
			}
			return Math.min(parenIndex, bracketIndex);
		},
		tokenizer(src) {
			const parenMatch = src.match(INLINE_PAREN_MATH_RULE);
			if (parenMatch) {
				const text = parenMatch[1]?.trim() ?? '';
				if (text.length === 0) {
					return;
				}
				return {
					type: 'inlineBackslashMath',
					raw: parenMatch[0],
					text,
					displayMode: false
				} as BackslashMathToken;
			}

			const bracketMatch = src.match(INLINE_BRACKET_MATH_RULE);
			if (bracketMatch) {
				const text = bracketMatch[1]?.trim() ?? '';
				if (text.length === 0) {
					return;
				}
				return {
					type: 'inlineBackslashMath',
					raw: bracketMatch[0],
					text,
					displayMode: true
				} as BackslashMathToken;
			}
		},
		renderer(token) {
			const backslashMathToken = token as BackslashMathToken;
			return renderKatex(backslashMathToken.text, backslashMathToken.displayMode);
		}
	};
}

function createBlockBackslashMathExtension(): TokenizerAndRendererExtension {
	return {
		name: 'blockBackslashMath',
		level: 'block',
		tokenizer(src) {
			const match = src.match(BLOCK_BRACKET_MATH_RULE);
			if (!match) {
				return;
			}
			const text = match[1]?.trim() ?? '';
			if (text.length === 0) {
				return;
			}
			return {
				type: 'blockBackslashMath',
				raw: match[0],
				text,
				displayMode: true
			} as BackslashMathToken;
		},
		renderer(token) {
			const backslashMathToken = token as BackslashMathToken;
			return `${renderKatex(backslashMathToken.text, backslashMathToken.displayMode)}\n`;
		}
	};
}

function parseCodeSpanMath(value: string): CodeSpanMath | null {
	const trimmed = value.trim();
	if (trimmed.length < 3) {
		return null;
	}
	if (trimmed.includes('\n') || trimmed.includes('\r')) {
		return null;
	}

	if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
		const expr = trimmed.slice(2, -2).trim();
		if (expr.length === 0 || expr.includes('$')) {
			return null;
		}
		return { expr, displayMode: true };
	}

	if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]') && trimmed.length > 4) {
		const expr = trimmed.slice(2, -2).trim();
		if (expr.length === 0) {
			return null;
		}
		return { expr, displayMode: true };
	}

	if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length > 2) {
		const expr = trimmed.slice(1, -1).trim();
		if (expr.length === 0 || expr.includes('$')) {
			return null;
		}
		return { expr, displayMode: false };
	}

	if (trimmed.startsWith('\\(') && trimmed.endsWith('\\)') && trimmed.length > 4) {
		const expr = trimmed.slice(2, -2).trim();
		if (expr.length === 0) {
			return null;
		}
		return { expr, displayMode: false };
	}

	return null;
}

const renderer = new marked.Renderer();
renderer.codespan = (token) => {
	const code = typeof token.text === 'string' ? token.text : '';
	const math = parseCodeSpanMath(code);
	if (math) {
		return renderKatex(math.expr, math.displayMode);
	}
	return `<code>${escapeHtml(code)}</code>`;
};
renderer.code = (token) => {
	const code = typeof token.text === 'string' ? token.text : '';
	const rawLanguage = (token.lang ?? '').trim().split(/\s+/u)[0]?.toLowerCase() ?? '';
	const normalized = LANGUAGE_ALIASES.get(rawLanguage) ?? rawLanguage;
	const resolvedLanguage = normalized && hljs.getLanguage(normalized) ? normalized : '';
	const languageLabel = resolveLanguageLabel(rawLanguage, normalized);
	const highlighted = resolvedLanguage
		? hljs.highlight(code, { language: resolvedLanguage }).value
		: escapeHtml(code);
	const languageClass = resolvedLanguage
		? `hljs language-${resolvedLanguage}`
		: 'hljs language-text';

	return [
		'<div class="code-block">',
		'<div class="code-block__header">',
		`<span class="code-block__lang">${escapeHtml(languageLabel)}</span>`,
		'<button class="code-block__copy" type="button" data-code-copy aria-label="Copy code">',
		'<svg class="code-block__copy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
		'<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>',
		'<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
		'</svg>',
		'<span class="sr-only">Copy code</span>',
		'</button>',
		'</div>',
		`<pre><code class="${languageClass}">${highlighted}</code></pre>`,
		'</div>'
	].join('');
};

function normalizeLatexLists(markdown: string): string {
	const lines = markdown.split(/\r?\n/u);
	const normalized: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (/^\\begin\{(enumerate|itemize)\}/.test(trimmed)) {
			normalized.push('');
			continue;
		}
		if (/^\\end\{(enumerate|itemize)\}/.test(trimmed)) {
			normalized.push('');
			continue;
		}
		const itemMatch = trimmed.match(/^\\item(?:\[(.+?)\])?\s*(.*)$/);
		if (itemMatch) {
			const label = itemMatch[1]?.trim();
			const rest = itemMatch[2]?.trim() ?? '';
			const prefix = label ? `- ${label}` : '-';
			normalized.push(rest.length > 0 ? `${prefix} ${rest}` : prefix);
			continue;
		}
		normalized.push(line);
	}

	return normalized.join('\n');
}

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

		const blockMathStartMatch = line.match(/^\s*\\\[(.*)$/u);
		if (blockMathStartMatch) {
			const remainder = blockMathStartMatch[1] ?? '';
			if (remainder.includes('\\]')) {
				normalized.push(line);
				continue;
			}
			ensureBlankLineBefore();
			inMathBlock = true;
			normalized.push('$$');
			if (remainder.length > 0) {
				normalized.push(remainder);
			}
			continue;
		}

		if (trimmed === '[') {
			ensureBlankLineBefore();
			inMathBlock = true;
			normalized.push('$$');
			continue;
		}

		const blockMathEndMatch = line.match(/^(.*)\\\]\s*$/u);
		if (blockMathEndMatch) {
			if (inMathBlock) {
				const remainder = blockMathEndMatch[1] ?? '';
				if (remainder.length > 0) {
					normalized.push(remainder);
				}
				inMathBlock = false;
				normalized.push('$$');
				const next = lines[i + 1];
				ensureBlankLineAfter(next);
				continue;
			}
			normalized.push(line);
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
	const normalized = normalizeDisplayMathBlocks(normalizeLatexLists(markdown));
	const parsed = marked.parse(normalized, { renderer });
	return typeof parsed === 'string' ? parsed : '';
}

export function renderMarkdownInline(markdown: string): string {
	const rendered = renderMarkdown(markdown).trim();
	if (
		rendered.startsWith('<p>') &&
		rendered.endsWith('</p>') &&
		!rendered.includes('</p><p>') &&
		!rendered.includes('</p>\n<p>')
	) {
		return rendered.slice(3, -4);
	}
	return rendered;
}

export function renderMarkdownOptional(value?: string | null): string | undefined {
	if (!value) {
		return undefined;
	}

	const rendered = renderMarkdown(value);
	const trimmed = rendered.trim();
	return trimmed.length > 0 ? rendered : undefined;
}
