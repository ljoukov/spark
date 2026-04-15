import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

const originalCwd = process.cwd();
const originalChatGptResponsesWebSocketMode =
  process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE;
const originalGoogleApiKey = process.env.GOOGLE_API_KEY;
const originalGeminiApiKey = process.env.GEMINI_API_KEY;
const originalGoogleServiceAccountJson =
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const originalLlmFilesGcsBucket = process.env.LLM_FILES_GCS_BUCKET;
const originalVertexGcsBucket = process.env.VERTEX_GCS_BUCKET;

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
  restoreEnvVar("GOOGLE_API_KEY", originalGoogleApiKey);
  restoreEnvVar("GEMINI_API_KEY", originalGeminiApiKey);
  restoreEnvVar("GOOGLE_SERVICE_ACCOUNT_JSON", originalGoogleServiceAccountJson);
  restoreEnvVar("LLM_FILES_GCS_BUCKET", originalLlmFilesGcsBucket);
  restoreEnvVar("VERTEX_GCS_BUCKET", originalVertexGcsBucket);
});

function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function importFreshEnvModule() {
  const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return import(`../src/utils/env.ts?env-test=${cacheBust}`);
}

describe("loadLocalEnv", () => {
  it("defaults chatgpt responses transport to SSE when unset", async () => {
    delete process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE;

    await withTempDir(async (dir) => {
      process.chdir(dir);
      const { loadLocalEnv } = await importFreshEnvModule();
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
      const { loadLocalEnv } = await importFreshEnvModule();
      loadLocalEnv();
    });

    expect(process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE).toBe("only");
  });

  it("prefers service account auth over inherited Gemini API keys", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, ".env.local"),
        'GOOGLE_SERVICE_ACCOUNT_JSON={"project_id":"test-project"}\n',
        "utf8",
      );
      process.chdir(dir);
      process.env.GOOGLE_API_KEY = "inherited-google-key";
      process.env.GEMINI_API_KEY = "inherited-gemini-key";
      delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

      const { loadLocalEnv } = await importFreshEnvModule();
      loadLocalEnv();
    });

    expect(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).toBe(
      '{"project_id":"test-project"}',
    );
    expect(process.env.GOOGLE_API_KEY).toBe("");
    expect(process.env.GEMINI_API_KEY).toBe("");
  });

  it("derives the default file bucket from service account auth", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        path.join(dir, ".env.local"),
        'GOOGLE_SERVICE_ACCOUNT_JSON={"project_id":"test-project"}\n',
        "utf8",
      );
      process.chdir(dir);
      delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      delete process.env.LLM_FILES_GCS_BUCKET;
      delete process.env.VERTEX_GCS_BUCKET;

      const { loadLocalEnv } = await importFreshEnvModule();
      loadLocalEnv();
    });

    expect(process.env.LLM_FILES_GCS_BUCKET).toBe(
      "test-project.firebasestorage.app",
    );
  });
});
