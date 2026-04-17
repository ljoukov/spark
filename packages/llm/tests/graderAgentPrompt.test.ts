import { describe, expect, it } from "vitest";

import { buildSparkGraderAgentPrompt } from "../src/agent/graderAgentPrompt";
import { resolveSparkAgentSubagentSelection } from "../src/agent/sparkAgentRunner";
import {
  resolveSparkAgentSkills,
  SPARK_GRADER_SKILL_IDS,
} from "../src/agent/sparkAgentSkills";
import {
  buildSparkGraderBrief,
  buildSparkGraderLaunchPlan,
  renderSparkGraderTask,
  resolveSparkGraderModelTools,
} from "../src/agent/sparkChatShared";

function renderGraderSkillText(): string {
  return resolveSparkAgentSkills(SPARK_GRADER_SKILL_IDS)
    .map((skill) => skill.content)
    .join("\n");
}

describe("grader agent prompt", () => {
  it("keeps the grader harness thin and points at skills", () => {
    const prompt = buildSparkGraderAgentPrompt();
    const task = renderSparkGraderTask("# Task");

    expect(prompt).toContain("skills/paper-to-sheet/SKILL.md");
    expect(prompt).toContain("skills/handwritten-answers-to-sheet/SKILL.md");
    expect(prompt).toContain("skills/source-image-cropping/SKILL.md");
    expect(task).toContain("## Required skills");
    expect(task).toContain("skills/handwritten-answers-to-sheet/SKILL.md");
    expect(prompt).not.toContain("## Handwriting transcription workflow");
  });

  it("keeps grader subagents bounded and uses dedicated crop review", () => {
    const prompt = buildSparkGraderAgentPrompt();
    const task = renderSparkGraderTask("# Task");
    const subagents = resolveSparkAgentSubagentSelection();

    expect(prompt).toContain("Use bounded subagents only");
    expect(prompt).toContain("direct `view_image` is intentionally not available");
    expect(prompt).toContain("validate_crop_with_fresh_agent");
    expect(prompt).toContain("review_run_progress_with_fresh_agent");
    expect(task).toContain("validate_crop_with_fresh_agent");
    expect(task).toContain("review_run_progress_with_fresh_agent");
    expect(task).not.toContain("exactly 1 subagent per problem");
    expect(subagents).toMatchObject({
      promptPattern: "codex",
      maxAgents: 6,
    });
    expect(JSON.stringify(subagents)).toContain(
      "keep intake, upload inventory, workspace file reading",
    );
    expect(JSON.stringify(subagents)).toContain(
      "Final figure/image crop validation must use the dedicated validate_crop_with_fresh_agent tool",
    );
  });

  it("keeps publish/output requirements in the grader harness", () => {
    const prompt = buildSparkGraderAgentPrompt();

    expect(prompt).toContain(
      "Once transcription, official/source references, and the sheet plan exist, stop broad reference reading",
    );
    expect(prompt).toContain(
      "before the first publish attempt, verify that both files exist",
    );
    expect(prompt).toContain('"totals": { "awardedMarks": number');
    expect(prompt).toContain('"filePath": "grader/output/sheet.json"');
    expect(prompt).toContain("full graded report wrapper");
    expect(prompt).toContain("`schemaVersion`, `sheet`, `answers`, `review`");
    expect(prompt).toContain("Do not use `generate_json`");
    expect(prompt).toContain("publish_sheet({})");
  });

  it("preserves high-risk grading workflow rules in skills", () => {
    const skills = renderGraderSkillText();

    expect(skills).toContain("## Source problem-statement transcription");
    expect(skills).toContain("source-fidelity");
    expect(skills).toContain(
      "[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/assets/q1-figure-1.jpg)",
    );
    expect(skills).toContain("placeholder ovals");
    expect(skills).toContain("review.score.total");
    expect(skills).toContain("top-level keys must be `schemaVersion`, `sheet`, `answers`, `review`");
    expect(skills).toContain("Do not put student answers inside question objects");
    expect(skills).toContain("[got/total mark(s)]");
    expect(skills).toContain('score: { "got": number, "total": number }');
    expect(skills).toContain("score blank/incorrect work as `got: 0`");
    expect(skills).toContain(
      "`totals.awardedMarks` equals `review.score.got`",
    );
    expect(skills).toContain("## Official Reference Lookup");
    expect(skills).toContain("grade-boundary / prize-threshold / medal-cutoff");
    expect(skills).toContain("## Real-World Outcome Reporting");
    expect(skills).toContain("omit per-question scores");
    expect(skills).toContain("Do not publish linked crop assets");
    expect(skills).toContain("question-relevant content");
    expect(skills).toContain("expectedContent");
    expect(skills).toContain("duplicatedTextToExclude");
    expect(skills).toContain("image-cutting-step N/8");
    expect(skills).toContain("extract_pdf_images");
    expect(skills).toContain("review_run_progress_with_fresh_agent");
    expect(skills).toContain("compact grading-report mode");
    expect(skills).toContain(
      "do not rebuild every visual and layout feature from the source paper",
    );
    expect(skills).toContain(
      "do not search online just to rediscover the same PDFs",
    );
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

  it("seeds grader skills into the agent workspace", () => {
    const plan = buildSparkGraderLaunchPlan({
      input: {},
      attachments: [],
      graderTaskTemplate: "# Task",
      createId: () => "00000000-0000-4000-8000-000000000000",
    });

    expect(plan.skillFiles.map((skillFile) => skillFile.path)).toEqual(
      SPARK_GRADER_SKILL_IDS.map((skillId) => `skills/${skillId}/SKILL.md`),
    );
    expect(plan.skillFiles.map((skillFile) => skillFile.content)).toEqual([
      expect.stringContaining("name: paper-to-sheet"),
      expect.stringContaining("name: handwritten-answers-to-sheet"),
      expect.stringContaining("name: source-image-cropping"),
    ]);
  });
});
