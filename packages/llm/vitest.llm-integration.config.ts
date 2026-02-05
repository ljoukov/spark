import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["llm-integration/**/*.test.ts"],
    testTimeout: 20 * 60 * 1000,
    hookTimeout: 20 * 60 * 1000,
    maxConcurrency: 1,
    sequence: {
      concurrent: false,
    },
  },
});

