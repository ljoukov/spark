import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();
const originalChatGptResponsesWebSocketMode =
  process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE;

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "spark-env-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  process.chdir(originalCwd);
  if (originalChatGptResponsesWebSocketMode === undefined) {
    delete process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE;
  } else {
    process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE =
      originalChatGptResponsesWebSocketMode;
  }
  vi.resetModules();
});

describe("loadLocalEnv", () => {
  it("defaults chatgpt responses transport to SSE when unset", async () => {
    delete process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE;

    await withTempDir(async (dir) => {
      process.chdir(dir);
      const { loadLocalEnv } = await import("../src/utils/env");
      loadLocalEnv();
    });

    expect(process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE).toBe("off");
  });

  it("preserves an explicit chatgpt responses transport setting", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, ".env.local"),
        "CHATGPT_RESPONSES_WEBSOCKET_MODE=only\n",
        "utf8",
      );
      process.chdir(dir);
      delete process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE;
      const { loadLocalEnv } = await import("../src/utils/env");
      loadLocalEnv();
    });

    expect(process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE).toBe("only");
  });
});
