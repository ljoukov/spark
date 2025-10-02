export interface BuildCodeProblemExtractionPromptOptions {
  readonly slug: string;
  readonly sourceMarkdown: string;
}

export const CODE_PROBLEM_PROMPT_HEADER = `You are Spark's coding problem curator. Convert each supplied markdown spec into JSON so the education team can seed Firestore with searchable problems.`;

const DIFFICULTY_GUIDANCE = `Difficulty scale:
- easy: warm-up logic, direct simulation, counting, basic data structures (hash map, stack, queue) with O(n log n) or better time and small state.
- medium: classic interview depth (dynamic programming, binary search, greedy proof, graph traversal with pruning) where careful reasoning is required but the solution fits in <120 lines.
- hard: multi-phase reasoning (advanced DP, flows, heavy pruning, combinatorics) or tight optimality proofs where typical learners struggle without hints.`;

const OUTPUT_DIRECTIONS = `Return JSON only. Shape the payload to match CODE_PROBLEM_RESPONSE_SCHEMA:
- title: short human-readable problem name.
- summary: 2 sentences on the core task and key constraints.
- difficulty: "easy" | "medium" | "hard".
- primaryTopic: main algorithm/data-structure family (e.g., "dynamic programming", "graph bfs").
- topics: additional topics ordered from most central to peripheral.
- tags: optional lightweight descriptors (e.g., "counting", "combinatorics").
- tasks: actionable tasks pulled from the spec.
- constraints: critical limits (ranges, complexity hints, invariants). Use one string per constraint without numbering.
- edgeCases: tricky cases that influence implementation.
- summaryBullets: 2-3 bullet notes for a teacher briefing this problem.
- hints: 1-3 progressively stronger hints for learners.
- followUpIdeas: optional related variations to extend practice.
- examples: list every worked example. Preserve I/O exactly; trim commentary into explanation.
- optimalApproach: best recommended solution with overview, concrete steps list, time/space complexity, and keyIdeas (principles that make it work).
- alternativeApproaches: zero or more other viable techniques with the same fields.

Final rule: perform silent reasoning, then output valid JSON only.`;

export function buildCodeProblemExtractionPrompt(
  options: BuildCodeProblemExtractionPromptOptions,
): string {
  const { slug, sourceMarkdown } = options;
  const lines: string[] = [
    CODE_PROBLEM_PROMPT_HEADER,
    "",
    `Problem slug: ${slug}`,
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
