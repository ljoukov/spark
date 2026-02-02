// Ported from web/src/lib/markdown.ts to keep iOS rendering aligned with Spark web chat.
(() => {
  const markedInstance = window.marked;
  if (!markedInstance) {
    return;
  }

  const LANGUAGE_ALIASES = new Map([
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

  const LANGUAGE_LABELS = new Map([
    ['javascript', 'js'],
    ['typescript', 'ts'],
    ['python', 'python'],
    ['c', 'c'],
    ['cpp', 'c++']
  ]);

  markedInstance.setOptions({ breaks: true, gfm: true });
  if (window.markedKatex) {
    markedInstance.use(
      window.markedKatex({
        throwOnError: false,
        nonStandard: true
      })
    );
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function resolveLanguageLabel(raw, normalized) {
    if (normalized && LANGUAGE_LABELS.has(normalized)) {
      return LANGUAGE_LABELS.get(normalized) || raw;
    }
    return raw || normalized || 'text';
  }

  const renderer = new markedInstance.Renderer();
  renderer.code = (token) => {
    const code = typeof token.text === 'string' ? token.text : '';
    const rawLanguage = (token.lang || '').trim().split(/\s+/u)[0]?.toLowerCase() || '';
    const normalized = LANGUAGE_ALIASES.get(rawLanguage) || rawLanguage;
    const hljs = window.hljs;
    const resolvedLanguage = normalized && hljs && hljs.getLanguage(normalized) ? normalized : '';
    const languageLabel = resolveLanguageLabel(rawLanguage, normalized);
    const highlighted = resolvedLanguage && hljs
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

  function normalizeLatexLists(markdown) {
    const lines = markdown.split(/\r?\n/u);
    const normalized = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\\begin\{(enumerate|itemize)\}/u.test(trimmed)) {
        normalized.push('');
        continue;
      }
      if (/^\\end\{(enumerate|itemize)\}/u.test(trimmed)) {
        normalized.push('');
        continue;
      }
      const itemMatch = trimmed.match(/^\\item(?:\[(.+?)\])?\s*(.*)$/u);
      if (itemMatch) {
        const label = itemMatch[1]?.trim();
        const rest = itemMatch[2]?.trim() || '';
        const prefix = label ? `- ${label}` : '-';
        normalized.push(rest.length > 0 ? `${prefix} ${rest}` : prefix);
        continue;
      }
      normalized.push(line);
    }

    return normalized.join('\n');
  }

  function normalizeDisplayMathBlocks(markdown) {
    const lines = markdown.split(/\r?\n/u);
    let inFence = false;
    let inMathBlock = false;
    const normalized = [];

    const ensureBlankLineBefore = () => {
      if (normalized.length === 0) {
        return;
      }
      const last = normalized[normalized.length - 1];
      if (last !== undefined && last.trim() !== '') {
        normalized.push('');
      }
    };

    const ensureBlankLineAfter = (nextLine) => {
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

      if (trimmed === '[' || trimmed === '\\[') {
        ensureBlankLineBefore();
        inMathBlock = true;
        normalized.push('$$');
        continue;
      }

      if (trimmed === ']' || trimmed === '\\]') {
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

  function renderMarkdown(markdownText, enableLatex = true) {
    const container = document.getElementById('markdown-content');
    if (!container) {
      return 0;
    }

    if (!markdownText || !markdownText.trim()) {
      container.innerHTML = '';
      container.style.display = 'none';
      return 0;
    }

    container.style.display = 'block';

    const normalized = normalizeDisplayMathBlocks(normalizeLatexLists(markdownText));
    const parsed = enableLatex
      ? markedInstance.parse(normalized, { renderer })
      : markedInstance.parse(markdownText, { renderer });
    container.innerHTML = typeof parsed === 'string' ? parsed : '';

    return document.body.scrollHeight || container.scrollHeight || 0;
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-code-copy]');
    if (!target) {
      return;
    }
    const codeBlock = target.closest('.code-block');
    const codeEl = codeBlock ? codeBlock.querySelector('pre code') : null;
    const codeText = codeEl ? codeEl.innerText : '';
    try {
      await copyText(codeText);
      target.dataset.copyState = 'copied';
    } catch (error) {
      target.dataset.copyState = 'error';
    }
    setTimeout(() => {
      if (target.dataset.copyState) {
        delete target.dataset.copyState;
      }
    }, 1500);
  });

  window.renderMarkdown = renderMarkdown;
})();
