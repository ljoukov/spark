import { describe, expect, it } from "vitest";

import { buildSparkGraderAgentPrompt } from "../src/agent/graderAgentPrompt";
import { renderSparkGraderTask } from "../src/agent/sparkChatShared";

describe("grader agent prompt", () => {
  it("tells subagent spawns to use one text field and no workspace items", () => {
    const prompt = buildSparkGraderAgentPrompt();

    expect(prompt).toContain(
      "pass one text instruction via `prompt` or `message` only",
    );
    expect(prompt).toContain(
      "Do not include `items` for workspace files or uploads",
    );
  });

  it("keeps grader run-mode subagent guidance selective", () => {
    const task = renderSparkGraderTask("# Task");

    expect(task).toContain(
      "use subagents selectively for substantial reasoning work",
    );
    expect(task).toContain("keep short routine worksheet questions in the main agent");
    expect(task).toContain("use at most 1 subagent per problem");
    expect(task).toContain(
      "call `spawn_agent` with a single text instruction in `prompt` or `message` only",
    );
    expect(task).not.toContain("exactly 1 subagent per problem");
  });

  it("mentions modern worksheet types and verifies both output files before publish", () => {
    const prompt = buildSparkGraderAgentPrompt();

    expect(prompt).toContain("`fill`, `cloze`, `mcq`, `lines`, `calc`, `match`, `spelling`, `flow`");
    expect(prompt).toContain(
      "Before the first publish attempt, verify that both grader/output/sheet.json and grader/output/run-summary.json exist",
    );
  });
});
