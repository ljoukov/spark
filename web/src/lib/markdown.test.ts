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

test('does not render KaTeX inside fenced code blocks', () => {
	const html = renderMarkdown('```\\n$BB$\\n```');
	expect(html).toContain('$BB$');
	expect(html).not.toContain('class="katex"');
});

