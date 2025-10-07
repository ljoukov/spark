export interface BuildCodeProblemExtractionPromptOptions {
  readonly slug: string;
  readonly sourceMarkdown: string;
}

export const CODE_PROBLEM_PROMPT_HEADER = `You are Spark's coding problem curator. Convert each supplied markdown spec into JSON so engineers can seed Firestore with runnable coding problems.`;

const DIFFICULTY_GUIDANCE = `Difficulty scale:
- warmup: one or two conceptual steps, straight translation from description, runnable inside 30 lines.
- intro: basic algorithms (loops, conditionals, counting, string parsing) with at most one twist; still suitable for new coders.
- easy: standard interview warm-up material (hash maps, two-pointers, math observations) solved with clear reasoning in O(n log n) or better.
- medium: classic DP / graph / greedy problems that require planning or invariants but still fit comfortably under 120 lines.
- hard: multi-stage reasoning, optimisations, or proofs (advanced DP, flows, heavy pruning) typically challenging without strong hints.`;

const OUTPUT_DIRECTIONS = `Return JSON only that matches CODE_PROBLEM_RESPONSE_SCHEMA:
- title: short human-readable name.
- difficulty: one of warmup | intro | easy | medium | hard.
- topics: ordered list of 2–4 high-level topics (e.g. ["Dynamic Programming", "Combinatorics"]).
- description: markdown body explaining the task, clarifying that the program reads stdin and writes stdout.
- inputFormat: markdown describing the full input contract (order of tokens, spacing, multiple lines).
- constraints: bullet-style strings capturing numeric limits and other must-know rules. No numbering or trailing periods.
- examples: exactly three worked examples. Each item must include:
  • title: "Example 1" etc.
  • input/output: verbatim text blocks.
  • explanation: markdown clarifying why the answer is correct.
- tests: 10–25 total cases. The first three must exactly match the examples (same input/output and same explanation text). Do not include names; the UI will label them “Test 1…”. Inputs/outputs must be raw stdin/stdout blocks.
- hints: exactly three markdown strings, ordered by strength: direction, core idea, almost-full solution.
- solutionCode: Python 3 code that reads from stdin, writes to stdout, and passes every test. Assume it runs as the main script without wrapping it in an if __name__ guard.

Rules:
- Preserve whitespace for inputs/outputs.
- Do not include variable labels like "nums =" or "target ="; capture the exact stdin format.
- For random-looking stress cases, still give deterministic data.
- Think quietly, then output valid JSON only.`;

export function buildCodeProblemExtractionPrompt(
  options: BuildCodeProblemExtractionPromptOptions,
): string {
  const { slug, sourceMarkdown } = options;
  const lines: string[] = [
    CODE_PROBLEM_PROMPT_HEADER,
    "",
    `Problem slug: ${slug}`,
    "",
    DIFFICULTY_GUIDANCE,
    "",
    OUTPUT_DIRECTIONS,
    "",
    "<SOURCE_MARKDOWN>",
    sourceMarkdown,
    "</SOURCE_MARKDOWN>",
  ];
  return lines.join("\n");
}
