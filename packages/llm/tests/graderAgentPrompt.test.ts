import { describe, expect, it } from "vitest";

import { buildSparkGraderAgentPrompt } from "../src/agent/graderAgentPrompt";
import { resolveSparkAgentSubagentSelection } from "../src/agent/sparkAgentRunner";
import {
  buildSparkGraderBrief,
  renderSparkGraderTask,
  resolveSparkGraderModelTools,
} from "../src/agent/sparkChatShared";

describe("grader agent prompt", () => {
  it("disables generic grader subagents and uses dedicated crop review", () => {
    const prompt = buildSparkGraderAgentPrompt();

    expect(prompt).toContain("Generic `spawn_agent` is not available");
    expect(prompt).toContain("validate_crop_with_fresh_agent");
    expect(prompt).toContain("Do not call generic `spawn_agent` in grader runs");
  });

  it("keeps grader run-mode subagent guidance selective", () => {
    const task = renderSparkGraderTask("# Task");
    const subagents = resolveSparkAgentSubagentSelection();

    expect(task).toContain("short routine worksheet questions in the main agent");
    expect(task).toContain("Generic `spawn_agent` is not available");
    expect(task).toContain("validate_crop_with_fresh_agent");
    expect(task).not.toContain("exactly 1 subagent per problem");
    expect(subagents).toMatchObject({
      promptPattern: "codex",
      maxAgents: 6,
    });
    expect(JSON.stringify(subagents)).toContain(
      "never use spawn_agent for intake",
    );
    expect(JSON.stringify(subagents)).toContain(
      "final figure/image crop validation must use the dedicated validate_crop_with_fresh_agent tool",
    );
  });

  it("mentions modern worksheet types and verifies both output files before publish", () => {
    const prompt = buildSparkGraderAgentPrompt();

    expect(prompt).toContain(
      "`fill`, `cloze`, `mcq`, `lines`, `calc`, `match`, `spelling`, `flow`",
    );
    expect(prompt).toContain(
      "Before the first publish attempt, verify that both grader/output/sheet.json and grader/output/run-summary.json exist",
    );
    expect(prompt).toContain('"totals": { "awardedMarks": number');
    expect(prompt).toContain(
      '"filePath": "grader/output/sheet.json"',
    );
    expect(prompt).toContain("Do not write legacy flat summary keys");
  });

  it("keeps objective answer capture separate from solving", () => {
    const prompt = buildSparkGraderAgentPrompt();
    const task = renderSparkGraderTask("# Task");

    expect(prompt).toContain("Keep answer capture separate from solving");
    expect(prompt).toContain("If no selected option is visible");
    expect(prompt).toContain("omit `officialSolutionMarkdown`");
    expect(task).toContain("keep answer capture separate from solving");
    expect(task).toContain("selected MCQ/objective option only");
    expect(task).toContain('use `""` for unanswered MCQ values');
  });

  it("defaults grader reference policy to official lookup unless uploaded-only is explicit", () => {
    const brief = buildSparkGraderBrief({
      input: {},
      attachments: [],
    });

    expect(brief).toContain("allow-official-references");
    expect(resolveSparkGraderModelTools({ input: {} })).toEqual([
      { type: "web-search", mode: "live" },
    ]);
    expect(
      resolveSparkGraderModelTools({
        input: { referenceSourcePolicy: "uploaded-only" },
      }),
    ).toBeUndefined();
  });

  it("pushes the grader toward source-faithful worksheet structure", () => {
    const prompt = buildSparkGraderAgentPrompt();
    const brief = buildSparkGraderBrief({
      input: {},
      attachments: [],
    });
    const task = renderSparkGraderTask("# Task");

    expect(prompt).toContain("shared stems via `group`");
    expect(prompt).toContain(
      "Represent every assessed question and subquestion",
    );
    expect(prompt).toContain("per-question awarded marks");
    expect(brief).toContain("original numbering hierarchy");
    expect(brief).toContain("one section per root question");
    expect(brief).toContain("many small standalone questions");
    expect(brief).toContain("Do not render cover-page or administration boilerplate");
    expect(brief).toContain("only one marked child subpart is visible");
    expect(task).toContain("Preserve printed worksheet structure directly");
    expect(task).toContain(
      "Represent every assessed question/subquestion from the printed source",
    );
    expect(prompt).toContain("source problem-statement transcription");
    expect(task).toContain("source problem-statement transcription");
    expect(task).toContain("only one answer-bearing child subpart");
    expect(prompt).toContain("do not duplicate the root stem inside the first child prompt");
    expect(task).toContain("do not duplicate the root stem inside the first child prompt");
    expect(task).toContain("crop it into `grader/output/assets/...`");
    expect(prompt).toContain("use `pad_image`");
    expect(task).toContain("use `pad_image`");
    expect(task).toContain("grader/output/crop-validation.md");
    expect(prompt).toContain("the validation is stale");
    expect(task).toContain("validation is stale");
    expect(task).toContain("score: { got, total }");
    expect(task).toContain("one giant section");
    expect(task).toContain("validate_crop_with_fresh_agent");
    expect(task).toContain("transcribe all visible text in the crop");
    expect(task).toContain("not answer-key reveals");
    expect(prompt).toContain("do not output derived answers");
    expect(prompt).toContain("Do not say you cannot access the local PDF");
    expect(prompt).toContain("Do not write `request.json`");
    expect(prompt).toContain("Do not use `generate_json`");
    expect(prompt).toContain("Generic `spawn_agent` is not available");
    expect(prompt).toContain("extract_pdf_reference_text");
    expect(task).toContain("extract_pdf_reference_text");
    expect(task).toContain("## Source problem-statement transcription");
    expect(task).toContain("validate_crop_with_fresh_agent");
    expect(prompt).toContain("spot-check representative crops");
    expect(task).toContain("Spot-check representative crops");
    expect(prompt).toContain("not a mid-diagram fragment");
    expect(prompt).toContain("exclude duplicated caption/question text");
    expect(prompt).toContain("bare `(A)`, `(B)`, `(C)`, `(D)` lines");
    expect(prompt).toContain("rectangular crop workflow");
    expect(prompt).toContain("bboxPixels");
    expect(prompt).toContain('"cropBase": "badCrop" | "fullPage"');
    expect(task).toContain("rectangular crop workflow");
    expect(task).toContain("bboxPixels");
    expect(task).toContain("do not group multiple multi-part roots into one numeric-range section");
    expect(task).toContain("exclude duplicated caption/question text");
    expect(task).toContain("remove bare `(A)`, `(B)`, `(C)`, `(D)` lines");
    expect(task).toContain("Keep worksheet metadata natural and non-redundant");
    expect(task).toContain("compact tier/level");
    expect(task).toContain("source/provenance identity only");
    expect(prompt).toContain("Question paper transcription");
    expect(task).toContain("not a mid-diagram fragment");
    expect(prompt).toContain("propose_crop_bbox_with_fresh_agent");
    expect(task).toContain("propose_crop_bbox_with_fresh_agent");
    expect(prompt).toContain("Do not publish known-failed crop validation");
    expect(task).toContain("Do not publish known-failed crop validation");
    expect(prompt).toContain("do not work around the budget by linking full-page/page fallback images");
    expect(task).toContain("do not work around the budget by linking full-page/page fallback images");
    expect(prompt).toContain("`review.message` should be a short learning summary");
    expect(task).toContain("`review.message` should be a short learning summary");
    expect(prompt).toContain("Compare how much blue and green light chlorophyll absorbs");
    expect(task).toContain("Compare how much blue and green light chlorophyll absorbs");
  });
});
