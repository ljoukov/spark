import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        // Ensure @ljoukov/llm (and its @google/genai dependency) are processed by Vite,
        // so vi.mock("@google/genai") can intercept Gemini calls in unit tests.
        inline: ["@ljoukov/llm", "@google/genai"],
      },
    },
  },
});
