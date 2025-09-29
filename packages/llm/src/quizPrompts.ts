import type { Part } from "@google/genai";

import {
  QuizGenerationSchema,
  type InlineSourceFile,
  type QuizGeneration,
} from "./schemas";

export interface GenerateQuizOptions {
  readonly questionCount: number;
  readonly subject?: string;
  readonly board?: string;
  readonly sourceFiles: InlineSourceFile[];
}

export const BASE_PROMPT_HEADER = `You are Spark's curriculum-aligned quiz builder. Work strictly from the supplied study material. Do not invent external facts.`;

const SELF_CHECK_SUFFIX_LINES = [
  "Do all reasoning silently. Output JSON only.",
  "",
  "SILENT SELF-CHECK (do not print this section; revise the draft once if anything fails):",
  '1) Scope: No off-spec terms for the target tier; any "HT/Separate" label is explicitly marked in the source.',
  "2) Symbols: Use exact scientific symbols from the source (e.g., ρ, Δ). Do not spell symbol names in answers.",
  '3) Numerics: For type "numeric", the answer array contains a pure number; units/precision live in the prompt; tolerance stated in the explanation.',
  '4) Stem–answer consistency: If the stem asks for a name/function/value/count, the options/answers match that demand.',
  '5) Coverage touch: Sample each source category present (e.g., "Equations to learn" vs "Given in exam"); avoid over-focusing a single section.',
  '6) True/False safety: Only single-fact claims with one explicit source cue; otherwise convert to MCQ or reword.',
  '7) One application: If formulae exist, include at least one genuine rearrangement/application item.',
  "Action: Fix only the items that fail; keep everything else unchanged. Then output JSON only.",
];

export function normaliseQuizPayload(
  payload: unknown,
  targetQuestionCount?: number
): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const quizRecord = payload as Record<string, unknown>;
  const questionsValue = quizRecord.questions;
  if (Array.isArray(questionsValue)) {
    const desiredCount =
      typeof targetQuestionCount === "number" &&
      Number.isFinite(targetQuestionCount) &&
      targetQuestionCount > 0
        ? Math.trunc(targetQuestionCount)
        : undefined;

    const approvedQuestions: Record<string, unknown>[] = [];

    for (const item of questionsValue) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const questionRecord = item as Record<string, unknown>;
      const typeValue =
        typeof questionRecord.type === "string"
          ? questionRecord.type
          : undefined;
      if (
        typeValue !== "multiple_choice" &&
        Array.isArray(questionRecord.options)
      ) {
        delete questionRecord.options;
      }
      const answerValue = questionRecord.answer;
      if (typeof answerValue === "string") {
        questionRecord.answer = [answerValue];
      } else if (Array.isArray(answerValue)) {
        questionRecord.answer = answerValue.filter(
          (entry): entry is string => typeof entry === "string"
        );
      } else if (answerValue !== undefined) {
        delete questionRecord.answer;
      }

      const reviewValue = questionRecord.review;
      let reviewStatus: "approved" | "unapproved" = "approved";
      let reviewNotes = "Self-check passed.";
      if (reviewValue && typeof reviewValue === "object") {
        const reviewRecord = reviewValue as Record<string, unknown>;
        const statusRaw =
          typeof reviewRecord.status === "string"
            ? reviewRecord.status.trim().toLowerCase()
            : "";
        if (statusRaw === "unapproved") {
          reviewStatus = "unapproved";
        } else if (statusRaw === "approved") {
          reviewStatus = "approved";
        }
        const notesRaw =
          typeof reviewRecord.notes === "string"
            ? reviewRecord.notes.trim()
            : "";
        if (notesRaw.length > 0) {
          reviewNotes = notesRaw;
        } else if (reviewStatus === "unapproved") {
          reviewNotes = "Flagged as unapproved during self-check.";
        }
      }
      questionRecord.review = {
        status: reviewStatus,
        notes: reviewNotes,
      };

      if (reviewStatus === "unapproved") {
        continue;
      }

      approvedQuestions.push(questionRecord);
    }

    if (desiredCount !== undefined && approvedQuestions.length > desiredCount) {
      quizRecord.questions = approvedQuestions.slice(0, desiredCount);
    } else {
      quizRecord.questions = approvedQuestions;
    }
    const finalQuestions = quizRecord.questions as Record<string, unknown>[];
    quizRecord.questionCount = finalQuestions.length;
  }
  return quizRecord;
}

export function buildSourceParts(files: InlineSourceFile[]): Part[] {
  return files.map((file) => ({
    inlineData: {
      data: file.data,
      mimeType: file.mimeType,
    },
  }));
}

export function buildGenerationPrompt(options: GenerateQuizOptions): string {
  const questionCount = options.questionCount;
  const candidateDraftCount = questionCount + 2;
  const base = [
    BASE_PROMPT_HEADER,
    'Write in UK English. Match the audience/tier and exam board that the source supports. Never "level up" beyond the source.',
    "",
    "SILENT PRE-FLIGHT (do not include this section in your output):",
    "1) Scope freeze:",
    '   - Derive the definitive scope from metadata and in-document cues (for example, "Higher tier only" or "Separate Physics only").',
    "   - If the requested tier exceeds the source, align down to the source and reflect the true scope in quizTitle and subject.",
    "   - Run a curriculum gate: if terms are off-spec for GCSE, rewrite the assessment wording to GCSE language while keeping the concept.",
    "",
    "2) Source map and coverage plan:",
    "   - List headings, sections, tables, and figures; tag any Higher Tier or Separate-only content.",
    `   - Allocate the ${questionCount} questions across sections in proportion to importance. Avoid over-indexing on a single section.`,
    "   - Coverage plan rule:",
    "     * Distribute items so no single section accounts for >40% of questions unless the source is genuinely dominated by that section.",
    "     * Include both foundational concepts and at least one applied/use-of-knowledge item per major topic where the source allows.",
    "   - Difficulty mix target (dynamic; always feasible):",
    "     * If the source includes equations or quantitative methods -> target approx. 35% application/rearrange/calculation items.",
    "     * Otherwise -> target approx. 20% application/interpretation items.",
    "     * Clamp targets to 0...questionCount. If quantitative and questionCount >= 1, include at least 1 application item.",
    '     * Count an item as "application" only if it requires a calculation, a rearrangement, or interpretation of given data (not mere recall).',
    "     * When formulae exist, include at least one rearrangement-based item to meet the application quota.",
    "   - Question type balance:",
    "     * Use at least two different question types in every set.",
    "     * No single type should exceed 60% of the quiz (unless questionCount <= 3, in which case use >=2 types where feasible).",
    "   - If Higher Tier content exists, include 2-3 questions that use it; never invent Higher Tier content.",
    "",
    "3) Mode decision:",
    "   - Extraction: source already holds questions or tasks. Preserve intent and numbering; adjust wording only for clarity and UK terminology.",
    "   - Synthesis: source provides notes, diagrams, or tables. Author new items strictly grounded in the content.",
    "",
    "ITEM-WRITING RULES:",
    `- When synthesising new questions, draft ${candidateDraftCount} candidates (target ${questionCount} + 2) so downstream filters can drop weak items without gaps.`,
    "- For extraction mode, work with the supplied questions; prefer editing to preserve intent and keep the original count.",
    '- After your self-check, add review.status ("approved" or "unapproved") and review.notes to every question.',
    '- Leave UNAPPROVED questions in the JSON so downstream tooling can inspect and trim them; do not silently drop them.',
    `- Set questionCount to the total number of questions you return (typically ${candidateDraftCount} for synthesis, ${questionCount} when extracting). Use ids Q1... or reuse original identifiers when extracting.`,
    "- Types: multiple_choice, short_answer, true_false, numeric.",
    "- Use source terminology and conventions exactly (for example, group labels, symbols, units).",
    "- Keep prompts self-contained. Do not reference assets that are absent from the quiz context.",
    "- Question quality & terminology:",
    "  * Process/equation completeness: include essential conditions explicitly shown in the source (for example, light, catalyst, heat) either in the prompt or the explanation.",
    "  * Typo normalisation: correct obvious source typos to standard UK exam usage without changing the scientific meaning.",
    "- Ambiguity guard:",
    '  * Prefer official labels (for example, "Group 7") over vague descriptors (for example, "column 7").',
    '  * Avoid "closest to" comparisons when ties are possible; ask for an exact property or reframe the item.',
    "  * Never rely on colours or relative positions alone; reference labels or unique features in the source.",
    "  * If the source shows dual conventions (for example, Group 0 and Group 18), state which convention you are using inside the prompt.",
    "  * If a figure lacks clear labels and multiple interpretations are possible, narrow the prompt so only one answer is valid from the provided context.",
    "- Free-text fairness:",
    '  * If multiple valid answers exist, either ask for "one" valid example or convert to multiple_choice so only one option is correct.',
    "  * For short_answer items with multiple valid responses, list all correct options and common GCSE-level synonyms in the answer array.",
    "  * If the valid list is long, change the prompt to request one example to keep marking fair.",
    "- Multiple_choice quality:",
    "  * Provide 3-4 unlabeled options; exactly one must be clearly correct.",
    "  * Build distractors from plausible misconceptions (for example, wrong unit, swapped symbols, order-of-magnitude slips, or incorrect rearrangements).",
    '  * Avoid "All of the above". Use "None of the above" only if it is genuinely plausible and the other options are mutually exclusive.',
    '  * Ensure only one option is correct unless the stem explicitly says "Select all that apply" (then mark every correct letter).',
    "- Numeric quality:",
    '  * The answer array for type "numeric" must contain a pure number only (no units, symbols, commas, or text). Put units in the prompt.',
    '  * Round according to the data precision or significant figures from the source and state an accepted tolerance in the explanation (for example, "Accept 3.30-3.50 N").',
    "  * If rounding changes a boundary case, ensure the tolerance still captures the precise value.",
    "- Hint guidance:",
    '  * When a question uses Higher Tier content that appears in the source, mention "HT" in the hint to signal scope.',
    "",
    "POST-DRAFT QUALITY SWEEP (silent, performed after drafting candidates):",
    "- Prompt-answer alignment: if the prompt asks for N items, return exactly N. If the source only supports one, change the prompt to one.",
    "- Premise check: every factual claim in the prompt must match the source.",
    "- Explanation-answer coherency: explanations must support the chosen answers with no contradictions.",
    "- Option uniqueness: only one option may be correct in each multiple choice question.",
    "- Coverage balance: compare the final set to your plan and rebalance if skewed.",
    "- SourceReference: cite the precise origin (page, question number, figure, caption). Do not fabricate references.",
    "- Feasibility and alignment checks:",
    "  * Difficulty targets are satisfied after clamping; lower counts if needed to stay feasible.",
    "  * Respect the section cap (>40% only when the source is dominated by one section) and confirm the type balance rule is met.",
    "  * Prompt counts match what the source supports; revise prompts instead of stretching the answer key.",
    '  * For any "closest to" construct, verify uniqueness or reframe the question.',
    '- For any failure, set review.status to "unapproved" and explain the violated rule in review.notes (for example, "Fails numeric purity: answer includes units").',
    '- For compliant items, leave review.status "approved" with a concise confirmation note.',
    "",
    "OUTPUT REQUIREMENTS:",
    "- Return JSON matching the existing schema:",
    "  * quizTitle (accurate, exam-style, true scope).",
    '  * mode ("extraction" or "synthesis").',
    "  * subject (best-fit subject/tier).",
    "  * questionCount (must equal the number of questions you return).",
    "  * questions[] with id, prompt, type, options (multiple_choice only), answer (string array), explanation, hint, sourceReference, review.",
    "  * review.status is \"approved\" or \"unapproved\"; review.notes cites the governing rule or confirms the pass.",
    "- Formatting and balance constraints:",
    "  * Numeric answers: pure numbers only; put units in the prompt and state tolerance in the explanation.",
    "  * Use at least two question types; no single type may exceed 60% unless questionCount <= 3 and the source leaves no alternative.",
    "  * If page numbers are missing, cite heading plus table/figure and row/label in sourceReference.",
    "- Keep UK spelling throughout.",
  ];
  if (options.subject) {
    base.push(
      `Requested subject (for context): ${options.subject}. Honour the source-supported scope if it differs.`
    );
  }
  if (options.board) {
    base.push(
      `Exam board context (for context): ${options.board}. Use the board conventions present in the source.`
    );
  }
  base.push(...SELF_CHECK_SUFFIX_LINES);
  return base.join("\n");
}

export interface ExtendQuizPromptOptions {
  readonly additionalQuestionCount: number;
  readonly subject?: string;
  readonly board?: string;
}

export function buildExtensionPrompt(options: ExtendQuizPromptOptions): string {
  const questionCount = options.additionalQuestionCount;
  const candidateDraftCount = questionCount + 2;
  const lines = [
    BASE_PROMPT_HEADER,
    "The learner already received an initial quiz and now needs additional questions drawn from the same study material.",
    "Write in UK English. Maintain the same scope, tier, and board as supported by the source.",
    "You will receive the previous quiz prompts inside <PAST_QUIZES>...</PAST_QUIZES>. Treat these markers as plain text delimiters and do not repeat the block in your response.",
    "",
    "SILENT PRE-FLIGHT (do not include this section in your output):",
    "1) Parse <PAST_QUIZES> to list covered sections, skills, and item types. Identify under-represented headings or skills.",
    `2) Build a ${questionCount}-item coverage plan that prioritises under-covered sections (for example, "Separate Physics only" or "Equations given").`,
    "   - Coverage plan rule:",
    "     * Distribute items so no single section accounts for >40% of questions unless the source is genuinely dominated by that section.",
    "     * Include both foundational concepts and at least one applied/use-of-knowledge item per major topic where the source allows.",
    "   - Question type balance:",
    "     * Use at least two different question types in every set.",
    "     * No single type should exceed 60% of the quiz (unless questionCount <= 3 and the source constrains variety).",
    "3) Difficulty mix target (dynamic; always feasible):",
    "   - If the source includes equations or quantitative methods -> target approx. 35% application/rearrange/calculation items.",
    "   - Otherwise -> target approx. 20% application/interpretation items.",
    "   - Clamp targets to 0...questionCount. If quantitative and questionCount >= 1, include at least 1 application item.",
    '   - Count an item as "application" only if it requires a calculation, rearrangement, or interpretation of given data (not mere recall).',
    "   - When formulae exist, include at least one rearrangement-based item to meet the application quota.",
    "4) Duplication guard: track concepts and wording patterns used in <PAST_QUIZES>, maintain a hidden list of concept bigrams, and reject near-duplicate stems.",
    "",
    "ITEM-WRITING RULES (inherit Initial V2 rules) with these additions:",
    `- Draft ${candidateDraftCount} candidates (target ${questionCount} + 2) so downstream filters can drop weak items without gaps.`,
    "- After your self-check, add review.status (\"approved\" or \"unapproved\") and review.notes to every candidate.",
    "- Leave UNAPPROVED questions in the JSON; downstream tooling will remove them.",
    `- Set mode to "extension" and set questionCount to the number of questions you return (typically ${candidateDraftCount}).`,
    "- Do not duplicate prompt ideas, answer wording, or explanation themes from <PAST_QUIZES>.",
    '- If a concept allows multiple valid answers, either ask for "one" valid example or convert to multiple_choice for unambiguous marking.',
    "",
    "POST-DRAFT QUALITY SWEEP (silent, performed after drafting candidates):",
    "- Confirm there is no duplication against <PAST_QUIZES>.",
    "- Check prompt-answer alignment and premise accuracy.",
    "- Ensure explanation-answer coherency and option uniqueness for multiple choice items.",
    "- Confirm coverage balance versus your extension plan and include Higher Tier items only if present in the source.",
    "- Feasibility and alignment checks:",
    "  * Difficulty targets are satisfied after clamping; lower counts if needed to stay feasible.",
    "  * Respect the section cap (>40% only when the source is dominated by one section) and confirm the type balance rule is met.",
    "  * Prompt counts match what the source supports; revise prompts instead of stretching the answer key.",
    '  * For any "closest to" construct, verify uniqueness or reframe the question.',
    "- For any failure, set review.status to \"unapproved\" and explain the violated rule in review.notes.",
    "- For compliant items, leave review.status \"approved\" with a concise confirmation note.",
    "",
    "OUTPUT REQUIREMENTS:",
    "- Return JSON matching the existing schema with subject reflecting the true source-supported tier or board.",
    "- Only include the new items in your response; do not restate previous questions.",
    "- questions[] must include review.status (\"approved\" or \"unapproved\") and review.notes summarising the self-check.",
    "- Formatting and balance constraints:",
    "  * Numeric answers: pure numbers only; put units in the prompt and state tolerance in the explanation.",
    "  * Use at least two question types; no single type may exceed 60% unless questionCount <= 3 and the source leaves no alternative.",
    "  * If page numbers are missing, cite heading plus table/figure and row/label in sourceReference.",
  ];
  if (options.subject) {
    lines.push(
      `Requested subject (for context): ${options.subject}. Honour the source-supported scope if it differs.`
    );
  }
  if (options.board) {
    lines.push(
      `Exam board context (for context): ${options.board}. Use the board conventions present in the source.`
    );
  }
  lines.push(...SELF_CHECK_SUFFIX_LINES);
  return lines.join("\n");
}

export function parseQuizFromText(text: string): QuizGeneration {
  const parsed: unknown = JSON.parse(text);
  const normalised = normaliseQuizPayload(parsed);
  return QuizGenerationSchema.parse(normalised);
}
