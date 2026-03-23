import { describe, expect, it } from "vitest";

describe("resolveSparkAgentThinkingLevel", () => {
  it("uses medium thinking for gpt-5.4 agent runs", async () => {
    const { resolveSparkAgentThinkingLevel } = await import(
      "../src/agent/sparkAgentRunner"
    );

    expect(resolveSparkAgentThinkingLevel("chatgpt-gpt-5.4")).toBe("medium");
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

  it("pins Spark subagents to chatgpt-gpt-5.4", async () => {
    const { resolveSparkAgentSubagentSelection } = await import(
      "../src/agent/sparkAgentRunner"
    );

    expect(resolveSparkAgentSubagentSelection()).toEqual({
      promptPattern: "codex",
    });
  });
});
