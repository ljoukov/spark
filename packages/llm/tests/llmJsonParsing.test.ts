import { describe, expect, it } from "vitest";

import { parseJsonFromLlmText } from "../src/utils/llm";

describe("parseJsonFromLlmText", () => {
  it("parses plain JSON", () => {
    expect(parseJsonFromLlmText('{ "ok": true }')).toEqual({ ok: true });
  });

  it("parses fenced JSON", () => {
    const raw = ["```json", '{ "value": 123 }', "```"].join("\n");
    expect(parseJsonFromLlmText(raw)).toEqual({ value: 123 });
  });

  it("repairs unescaped newlines inside JSON strings", () => {
    const raw = '{ "text": "hello\\nworld" }'.replace("\\n", "\n");
    expect(parseJsonFromLlmText(raw)).toEqual({ text: "hello\nworld" });
  });
});

