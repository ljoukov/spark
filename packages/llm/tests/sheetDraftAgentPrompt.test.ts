import { describe, expect, it } from "vitest";

import { buildSparkSheetDraftAgentPrompt } from "../src/agent/sheetDraftAgentPrompt";
import {
  resolveSparkAgentSkills,
  SPARK_SHEET_DRAFT_SKILL_IDS,
} from "../src/agent/sparkAgentSkills";
import {
  buildSparkSheetDraftLaunchPlan,
  renderSparkSheetDraftTask,
  SPARK_CHAT_CREATE_SHEET_TOOL_DESCRIPTION,
} from "../src/agent/sparkChatShared";

function renderSheetDraftSkillText(): string {
  return resolveSparkAgentSkills(SPARK_SHEET_DRAFT_SKILL_IDS)
    .map((skill) => skill.content)
    .join("\n");
}

describe("sheet draft prompt", () => {
  it("keeps draft-sheet harness output-focused and points at skills", () => {
    const prompt = buildSparkSheetDraftAgentPrompt();

    expect(prompt).toContain("skills/paper-to-sheet/SKILL.md");
    expect(prompt).toContain("skills/source-image-cropping/SKILL.md");
    expect(prompt).toContain(
      "presentation: { title, subtitle, summaryMarkdown, footer }",
    );
    expect(prompt).toContain("publish_sheet_draft({})");
    expect(prompt).not.toContain("## Extraction workflow");
  });

  it("keeps source-fidelity and visual rules in skills", () => {
    const skills = renderSheetDraftSkillText();

    expect(skills).toContain("Treat uploaded question sheets as canonical");
    expect(skills).toContain("Every worksheet question must include `marks`");
    expect(skills).toContain("missing visuals");
    expect(skills).toContain("sheet/output/assets/...");
    expect(skills).toContain("placeholder ovals");
    expect(skills).toContain(
      "[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/assets/q1-figure-1.jpg)",
    );
  });

  it("includes required skills in the rendered task", () => {
    const task = renderSparkSheetDraftTask("# Task");

    expect(task).toContain("## Required skills");
    expect(task).toContain("skills/paper-to-sheet/SKILL.md");
    expect(task).toContain("skills/source-image-cropping/SKILL.md");
  });

  it("tells the chat tool to reuse earlier uploads for worksheet requests", () => {
    expect(SPARK_CHAT_CREATE_SHEET_TOOL_DESCRIPTION).toContain(
      "If the request refers to an earlier upload in the same conversation",
    );
  });

  it("seeds sheet-draft skills into the agent workspace", () => {
    const plan = buildSparkSheetDraftLaunchPlan({
      input: {},
      attachments: [],
      sheetTaskTemplate: "# Task",
      createId: () => "00000000-0000-4000-8000-000000000000",
    });

    expect(plan.skillFiles.map((skillFile) => skillFile.path)).toEqual(
      SPARK_SHEET_DRAFT_SKILL_IDS.map(
        (skillId) => `skills/${skillId}/SKILL.md`,
      ),
    );
    expect(plan.skillFiles[0]?.content).toContain("---");
    expect(plan.skillFiles[0]?.content).toContain("name: paper-to-sheet");
  });
});
