import { expect, test } from 'vitest';
import { normalizeTutorMarkdown } from '@spark/schemas';
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

test('renders KaTeX display mode for multiline \\[...\\] blocks that start inline', () => {
	const html = renderMarkdown('For (b): write\n\\[m=T_a+b,\n\\quad 0\\le b\\le a+1.\n\\]');
	expect(html).toContain('class="katex-display"');
	expect(html).not.toContain('[m=T_a+b,');
	expect(html).not.toContain('\\[m=T_a+b,');
});

test('renders KaTeX display mode for multiline \\[...\\] blocks that end inline', () => {
	const html = renderMarkdown(
		'The first terms contribute\n\\[\ny_{T_a}=1^2+2^2+\\cdots+a^2=\\frac{a(a+1)(2a+1)}{6}.\\]'
	);
	expect(html).toContain('class="katex-display"');
	expect(html).not.toContain('\\\\]');
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

test('renders KaTeX after normalizing over-escaped tutor math markdown', () => {
	const html = renderMarkdown(
		normalizeTutorMarkdown(
			'Fair enough: \\\\(n\\\\) is between \\\\(25\\\\) and \\\\(100\\\\).\\n\\\\[26,27,\\\\dots,100.\\\\]'
		)
	);
	expect(html).toContain('class="katex"');
	expect(html).toContain('class="katex-display"');
	expect(html).not.toContain('\\\\(n\\\\)');
	expect(html).not.toContain('\\\\[26,27,\\\\dots,100.\\\\]');
});
