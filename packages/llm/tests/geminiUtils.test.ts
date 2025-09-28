import { describe, expect, it } from "vitest";

import { GEMINI_MODEL_IDS, isGeminiModelId } from "../src/utils/gemini";

describe("Gemini utils", () => {
  it("confirms known model ids as valid", () => {
    for (const model of GEMINI_MODEL_IDS) {
      expect(isGeminiModelId(model)).toBe(true);
    }
  });

  it("rejects unknown model ids", () => {
    expect(isGeminiModelId("gemini-unknown-model")).toBe(false);
    expect(isGeminiModelId("")).toBe(false);
  });
});
