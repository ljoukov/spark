import { describe, expect, it } from "vitest";

describe("resolveSparkAgentThinkingLevel", () => {
  it("uses medium thinking for gpt-5.5-fast agent runs", async () => {
    const { resolveSparkAgentThinkingLevel } = await import(
      "../src/agent/sparkAgentRunner"
    );

    expect(resolveSparkAgentThinkingLevel("chatgpt-gpt-5.5-fast")).toBe("medium");
  });

  it("uses medium thinking for gpt-5.3-codex-spark agent runs", async () => {
    const { resolveSparkAgentThinkingLevel } = await import(
      "../src/agent/sparkAgentRunner"
    );

    expect(resolveSparkAgentThinkingLevel("chatgpt-gpt-5.3-codex-spark")).toBe(
      "medium",
    );
  });

  it("leaves non-gpt models unset", async () => {
    const { resolveSparkAgentThinkingLevel } = await import(
      "../src/agent/sparkAgentRunner"
    );

    expect(resolveSparkAgentThinkingLevel("gemini-flash-latest")).toBeUndefined();
  });

  it("keeps the Codex prompt pattern for Spark subagents", async () => {
    const { resolveSparkAgentSubagentSelection } = await import(
      "../src/agent/sparkAgentRunner"
    );

    const selection = resolveSparkAgentSubagentSelection();
    expect(selection).toMatchObject({
      promptPattern: "codex",
    });
    if (selection === false || selection === true) {
      return;
    }
    expect(selection.maxAgents).toBe(6);
    expect(selection.instructions).toContain("Grader subagent policy");
  });
});
