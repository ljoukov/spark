const DOUBLY_ESCAPED_LATEX_TOKEN = /\\\\(?=[()[\]A-Za-z])/g;

export function normalizeTutorMarkdown(markdown: string): string {
  let normalized = markdown;
  for (;;) {
    const next = normalized.replace(DOUBLY_ESCAPED_LATEX_TOKEN, "\\");
    if (next === normalized) {
      return normalized;
    }
    normalized = next;
  }
}
