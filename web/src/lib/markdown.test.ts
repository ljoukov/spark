import { expect, test } from 'vitest';
import { renderMarkdown } from './markdown';

test('renders KaTeX for inline code spans that contain only $...$ math', () => {
	const html = renderMarkdown('For example, `$BB$`, `$Bb$`, or `$bb$`.');
	expect(html).toContain('class="katex"');
	expect(html).not.toContain('<code>$BB$</code>');
	expect(html).not.toContain('<code>$Bb$</code>');
	expect(html).not.toContain('<code>$bb$</code>');
});

test('keeps non-math inline code spans as <code>', () => {
	const html = renderMarkdown('Use `$PATH` to reference the PATH env var.');
	expect(html).toContain('<code>$PATH</code>');
	expect(html).not.toContain('class="katex"');
});

test('renders KaTeX for \\(...\\) inline formulas', () => {
	const html = renderMarkdown('Inline formula: \\(x^2 + y^2\\).');
	expect(html).toContain('class="katex"');
	expect(html).not.toContain('\\(x^2 + y^2\\)');
});

test('renders KaTeX display mode for \\[...\\] formulas', () => {
	const html = renderMarkdown('Display formula:\\n\\[x^2 + y^2 = z^2\\]');
	expect(html).toContain('class="katex-display"');
});

test('renders KaTeX for code spans that contain only \\(...\\) math', () => {
	const html = renderMarkdown('Use `\\(x^2\\)` for inline math.');
	expect(html).toContain('class="katex"');
	expect(html).not.toContain('<code>\\(x^2\\)</code>');
});

test('does not render KaTeX inside fenced code blocks', () => {
	const html = renderMarkdown('```\\n$BB$\\n```');
	expect(html).toContain('$BB$');
	expect(html).not.toContain('class="katex"');
});

test('does not render KaTeX for \\(...\\) inside fenced code blocks', () => {
	const html = renderMarkdown('```\\n\\\\(x^2\\\\)\\n```');
	expect(html).toContain('<code>');
	expect(html).not.toContain('class="katex"');
});
