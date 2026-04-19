import { describe, expect, it } from "vitest";

import { buildSparkGraderAgentPrompt } from "../src/agent/graderAgentPrompt";
import {
  buildSparkAgentSystemPrompt,
  resolveSparkAgentSubagentSelection,
} from "../src/agent/sparkAgentRunner";
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
    expect(prompt).toContain("Use `view_image` when it is exposed");
    expect(prompt).toContain("validate_crop_with_fresh_agent");
    expect(prompt).toContain("Do not ask the reviewer to require inferred answers");
    expect(prompt).toContain("correct `expectedContent` and revalidate once");
    expect(prompt).toContain("review_run_progress_with_fresh_agent");
    expect(prompt).toContain("score_answers_with_fresh_agent");
    expect(prompt).toContain("returns per-question results inline");
    expect(prompt).toContain("do not spend turns rereading every scoring file");
    expect(prompt).toContain("validate_grader_artifacts");
    expect(prompt).toContain("pre-publish source-fidelity audits");
    expect(prompt).toContain("Split long material by source page or root question");
    expect(task).toContain("validate_crop_with_fresh_agent");
    expect(task).toContain("printed/visible visual labels");
    expect(task).toContain("correct `expectedContent` and revalidate once");
    expect(task).toContain("review_run_progress_with_fresh_agent");
    expect(task).toContain("score_answers_with_fresh_agent");
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
    expect(JSON.stringify(subagents)).toContain(
      "score_answers_with_fresh_agent",
    );
  });

  it("keeps publish/output requirements in the grader harness", () => {
    const prompt = buildSparkGraderAgentPrompt();

    expect(prompt).toContain(
      "Once transcription, official/source references, and the sheet plan exist, stop broad reference reading/searching",
    );
    expect(prompt).toContain("do not search for schema examples");
    expect(prompt).toContain("Do not score the whole paper in one long hidden reasoning pass");
    expect(prompt).toContain("do not reread every scoring file");
    expect(prompt).toContain("modelAnswer");
    expect(prompt).toContain("including `teacher-review` when returned");
    expect(prompt).toContain("Preserve returned scores/statuses");
    expect(prompt).toContain("omit optional model-answer/reference enrichment");
    expect(prompt).toContain("the next non-repair tool call must be");
    expect(prompt).toContain(
      'validate_grader_artifacts({"requireSourceFidelityAudit": false})',
    );
    expect(prompt).toContain('"totals": { "awardedMarks": number');
    expect(prompt).toContain('"filePath": "grader/output/sheet.json"');
    expect(prompt).toContain("full graded report wrapper");
    expect(prompt).toContain("`schemaVersion`, `sheet`, `answers`, `review`");
    expect(prompt).toContain("Do not use `generate_json`");
    expect(prompt).toContain("validate_grader_artifacts");
    expect(prompt).toContain("publish_sheet({})");
    expect(prompt).toContain("stable Apple-style sheet palette");
    expect(prompt).toContain("presentation.summaryMarkdown");
    expect(prompt).toContain("one compact sentence or two short fragments");
    expect(prompt).toContain("official grade/prize/medal/percentile outcome");
    expect(prompt).toContain('generic lead-ins such as "This sheet"');
  });

  it("keeps lesson JSON pipeline instructions out of grader-mode system prompts", () => {
    const prompt = buildSparkAgentSystemPrompt({
      includePdfTranscriptionSkill: true,
      mode: "grader",
    });

    expect(prompt).toContain("Grader / worksheet publishing pipeline");
    expect(prompt).toContain("Do not use generate_json for grader/output/sheet.json");
    expect(prompt).not.toContain("Lesson creation pipeline");
    expect(prompt).not.toContain("Use generate_json({ sourcePath");
    expect(prompt).not.toContain("validate_json({ schemaPath");
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
    expect(skills).toContain(
      "top-level keys must be `schemaVersion`, `sheet`, `answers`, `review`",
    );
    expect(skills).toContain(
      "Do not put student answers inside question objects",
    );
    expect(skills).toContain("[got/total mark(s)]");
    expect(skills).toContain('score: { "got": number, "total": number }');
    expect(skills).toContain("score blank/incorrect work as `got: 0`");
    expect(skills).toContain("`totals.awardedMarks` equals `review.score.got`");
    expect(skills).toContain("## Official Reference Lookup");
    expect(skills).toContain("grade-boundary / prize-threshold / medal-cutoff");
    expect(skills).toContain("## Real-World Outcome Reporting");
    expect(skills).toContain("omit per-question scores");
    expect(skills).toContain("Do not publish linked crop assets");
    expect(skills).toContain("question-relevant content");
    expect(skills).toContain("expectedContent");
    expect(skills).toContain(
      "Do not include inferred answers, hidden context, mark-scheme facts, or unprinted labels",
    );
    expect(skills).toContain("fix `expectedContent` and rerun validation once");
    expect(skills).toContain("duplicatedTextToExclude");
    expect(skills).toContain("image-cutting-step N/4");
    expect(skills).toContain("reached the 4-step cap");
    expect(skills).not.toContain("reached the 8-step cap");
    expect(skills).not.toContain("intentionally unavailable");
    expect(skills).toContain("extract_pdf_images");
    expect(skills).toContain("review_run_progress_with_fresh_agent");
    expect(skills).toContain("score_answers_with_fresh_agent");
    expect(skills).toContain("returns per-question results inline");
    expect(skills).toContain("modelAnswer");
    expect(skills).toContain("including `teacher-review` when returned");
    expect(skills).toContain("reread every scoring file");
    expect(skills).toContain("validate_grader_artifacts");
    expect(skills).toContain("Do not search for schema examples");
    expect(skills).toContain("never wrap those leaves in an unnumbered parent group");
    expect(skills).not.toContain(
      "create an explicit parent `group` entry for the root question",
    );
    expect(skills).toContain("## Fresh Source-Fidelity Audit");
    expect(skills).toContain("Do not drop a visible prompt or partial response");
    expect(skills).toContain("Do not treat a learner's broad focus wording");
    expect(skills).toContain("compact grading-report mode");
    expect(skills).toContain(
      "without rebuilding irrelevant exam layout chrome",
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
