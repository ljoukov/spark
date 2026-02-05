import { describe, expect, it } from "vitest";

import {
  appendMarkdownSourcesSection,
  stripCodexCitationMarkers,
} from "../src/utils/llm";

describe("web search citation rendering", () => {
  it("strips Codex-style citation markers from text", () => {
    const input = `Hello\uE200cite\uE202turn10view0\uE202turn11view0\uE201 world`;
    const result = stripCodexCitationMarkers(input);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe("Hello world");

    for (const ch of result.text) {
      const code = ch.codePointAt(0) ?? 0;
      expect(code >= 0xe200 && code <= 0xe2ff).toBe(false);
    }
  });

  it("appends a Sources section when missing", () => {
    const input = "Some report content.";
    const output = appendMarkdownSourcesSection(input, [
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(output).toContain("## Sources");
    expect(output).toContain("<https://example.com/a>");
    expect(output).toContain("<https://example.com/b>");
  });

  it("does not duplicate Sources section", () => {
    const input = "Some report.\n\n## Sources\n- <https://example.com/a>";
    const output = appendMarkdownSourcesSection(input, [
      "https://example.com/b",
    ]);
    expect(output.match(/^##\s+Sources\s*$/gmu)?.length ?? 0).toBe(1);
  });
});
