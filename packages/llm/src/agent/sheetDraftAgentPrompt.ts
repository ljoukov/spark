import { SPARK_GRADER_UPLOADS_MANIFEST_PATH } from "./graderAgentPrompt";

export const SPARK_SHEET_DRAFT_SUMMARY_PATH =
  "sheet/output/run-summary.json" as const;
export const SPARK_SHEET_DRAFT_PATH = "sheet/output/draft.json" as const;
export const SPARK_SHEET_DRAFT_ANSWERS_PATH =
  "sheet/state/answers.json" as const;

export function buildSparkSheetDraftAgentPrompt(options?: {
  summaryPath?: string;
  sheetPath?: string;
}): string {
  const summaryPath = options?.summaryPath ?? SPARK_SHEET_DRAFT_SUMMARY_PATH;
  const sheetPath = options?.sheetPath ?? SPARK_SHEET_DRAFT_PATH;
  return [
    "Create a student worksheet from uploaded study material.",
    "",
    "Read and follow these files first:",
    "- brief.md",
    "- request.json",
    "- sheet/task.md",
    `- ${SPARK_GRADER_UPLOADS_MANIFEST_PATH}`,
    "- Work only from the uploaded material and the explicit request.",
    "- If the uploaded material is already a worksheet, textbook exercise, or exam paper, preserve every question, subsection, blank, option list, table, and visual calculation structure as closely as possible.",
    "- Treat an uploaded question sheet or exam page as canonical source text: do not simplify it, rewrite it into your preferred style, or silently drop marks / labels / answer cues.",
    "- When the uploads are already a question sheet, default to source-faithful transcription into the worksheet JSON rather than synthesis.",
    "- Keep wording, numbering, formulas, and notation faithful to the source. Only do light OCR/layout cleanup when meaning is unchanged.",
    "- When fidelity and polish conflict, choose fidelity.",
    "- Do not merge questions, normalize numbering, or omit marks, labels, blanks, tables, or flow-box answer cues from a canonical question sheet.",
    "- If one numbered source question has shared context such as a stem, table, or diagram before subparts, keep that shared context inside a `group` entry instead of moving it to section theory.",
    "- When a grouped child subpart should show a compact badge, keep the full source label in `displayNumber` and set `badgeLabel` separately, for example `displayNumber: \"10(a)\"` with `badgeLabel: \"a\"`.",
    "- Every printed question or subpart visible in the source must become a worksheet question object. Do not leave a titled section empty when the source page shows questions there.",
    "- `fill` questions must use the real schema shape with `prompt`, `blanks`, `after`, optional `conjunction`, and `marks`.",
    "- If the source shows a short answer line such as `Answer ____ £`, prefer `calc` or `fill` instead of a long `lines` response.",
    "- If the uploads are already a printed worksheet or exam page, follow the extraction workflow in sheet/task.md and inspect the relevant page images before finalizing the draft.",
    "- If pdf_to_images or view_image fails for a printed worksheet / exam page, stop and fix or report that failure instead of publishing a partial text-only worksheet.",
    "- Before publish, compare the worksheet draft against extracted text and viewed source pages. Fix any paraphrase, omission, reorder, invented placeholder text, or guessed OCR.",
    "- Mark uncertainty explicitly instead of guessing missing source text.",
    "- Do not invent placeholder copy for blanks or empty boxes unless the source itself prints that placeholder.",
    "- If the latest user request asks for verbatim structure, treat that as a hard requirement.",
    "- If the uploads are notes or teaching material rather than a ready-made question sheet, synthesize a clean student worksheet grounded only in that material.",
    "- The worksheet UI supports grouped multipart questions, Markdown, LaTeX, tables, subpart labels, answer-bank blanks, cloze blanks, and flow-chart answer boxes.",
    "- When the source prints visible blanks plus a fixed answer bank such as `(A)` to `(D)`, use `answer_bank` instead of `cloze` so each blank stays constrained to those source options.",
    "- For `answer_bank`, keep `segments[]` as clean running sentence prose around the interactive blank. Do not copy decorative `(____)` wrappers, underscores, or dangling blank brackets into `segments[]`.",
    "- For `answer_bank`, use `displayMode: \"inline_labeled\"` by default when the full labelled option such as `(A) principal amount` can sit directly inside each selector. Use `displayMode: \"banked\"` only when the source shows a separate answer bank that should stay visible below the sentence or when the full labelled option text is too long to fit cleanly in the selector.",
    "- For `mcq`, keep the question stem in `prompt`, keep the options in structured `options[]`, and choose `displayMode: \"full_options\"` by default when the selectable cards should show the full option text. Use `displayMode: \"labels_only\"` only when the source options are long enough that they should stay listed separately above compact label-only selectors.",
    "- The JSON contract is defined explicitly in sheet/task.md. Follow that contract directly and do not infer alternate keys from logs or unrelated files.",
    "",
    "Deliverables:",
    `1) Write one worksheet draft JSON file at ${sheetPath}`,
    `2) Write ${summaryPath} including a concise student-facing presentation title, subtitle, body summary markdown, and footer provenance`,
    "3) Call publish_sheet_draft({}) to validate and publish the worksheet draft; this only validates the artifact contract/persistence, so complete the source-fidelity check before calling it. If it fails, fix the files and retry until it succeeds",
    "4) Call done with a short summary after publish_sheet_draft succeeds",
  ].join("\n");
}
