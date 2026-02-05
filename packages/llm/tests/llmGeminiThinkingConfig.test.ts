import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobProgressReporter } from "../src/utils/concurrency";

type GeminiStreamRequest = {
  model: string;
  contents: unknown;
  config: Record<string, unknown>;
};

const generateContentStreamMock =
  vi.fn<(req: GeminiStreamRequest) => AsyncIterable<unknown>>();

vi.mock("../src/utils/gemini", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/gemini")>(
    "../src/utils/gemini",
  );
  return {
    ...actual,
    runGeminiCall: async (fn: (client: unknown) => Promise<void>) => {
      const client = {
        models: {
          generateContentStream: generateContentStreamMock,
        },
      };
      await fn(client);
    },
  };
});

function buildSingleChunkStream(text: string): AsyncIterable<unknown> {
  const chunk = {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text }],
        },
      },
    ],
  };
  return {
    [Symbol.asyncIterator]: () => {
      let done = false;
      return {
        next: () => {
          if (done) {
            return Promise.resolve({ done: true, value: undefined });
          }
          done = true;
          return Promise.resolve({ done: false, value: chunk });
        },
      };
    },
  };
}

const silentProgress: JobProgressReporter = {
  log: () => {},
  startModelCall: () => Symbol("test-model-call"),
  recordModelUsage: () => {},
  finishModelCall: () => {},
  startStage: () => Symbol("test-stage"),
  finishStage: () => {},
  setActiveStages: () => {},
};

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "spark-llm-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function extractTextFromGoogleContents(contents: unknown): string {
  if (!Array.isArray(contents)) {
    return "";
  }
  const pieces: string[] = [];
  for (const content of contents) {
    if (!content || typeof content !== "object") {
      continue;
    }
    const partsRaw = (content as { parts?: unknown }).parts;
    if (!Array.isArray(partsRaw)) {
      continue;
    }
    for (const part of partsRaw) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) {
        pieces.push(text);
      }
    }
  }
  return pieces.join("\n");
}

function assertPlainRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`);
  }
}

describe("Gemini thinkingConfig", () => {
  beforeEach(() => {
    generateContentStreamMock.mockReset();
    generateContentStreamMock.mockImplementation(({ config }) => {
      void config;
      return buildSingleChunkStream("ok");
    });
  });

  it("does not send thinkingLevel for gemini-2.5-pro", async () => {
    const { generateText } = await import("../src/utils/llm");

    await generateText({
      modelId: "gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      progress: silentProgress,
    });

    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    const request = generateContentStreamMock.mock.calls[0]?.[0];
    const thinkingConfig = request?.config?.thinkingConfig as
      | Record<string, unknown>
      | undefined;
    expect(thinkingConfig).toBeTruthy();
    expect(thinkingConfig).not.toHaveProperty("thinkingLevel");
    expect(thinkingConfig).toHaveProperty("includeThoughts", true);
    expect(thinkingConfig).toHaveProperty("thinkingBudget", 32_768);
  });

  it("does not send thinkingLevel for gemini-flash-latest", async () => {
    const { generateText } = await import("../src/utils/llm");

    await generateText({
      modelId: "gemini-flash-latest",
      contents: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      progress: silentProgress,
    });

    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    const request = generateContentStreamMock.mock.calls[0]?.[0];
    const thinkingConfig = request?.config?.thinkingConfig as
      | Record<string, unknown>
      | undefined;
    expect(thinkingConfig).toBeTruthy();
    expect(thinkingConfig).not.toHaveProperty("thinkingLevel");
    expect(thinkingConfig).toHaveProperty("includeThoughts", true);
    expect(thinkingConfig).toHaveProperty("thinkingBudget", 24_576);
  });

  it("does not send thinkingLevel for gemini-3-pro-preview", async () => {
    const { generateText } = await import("../src/utils/llm");

    await generateText({
      modelId: "gemini-3-pro-preview",
      contents: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      progress: silentProgress,
    });

    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    const request = generateContentStreamMock.mock.calls[0]?.[0];
    const thinkingConfig = request?.config?.thinkingConfig as
      | Record<string, unknown>
      | undefined;
    expect(thinkingConfig).toBeTruthy();
    expect(thinkingConfig).not.toHaveProperty("thinkingLevel");
    expect(thinkingConfig).toHaveProperty("includeThoughts", true);
    expect(thinkingConfig).not.toHaveProperty("thinkingBudget");
  });
});

describe("Spark agent tool: generate_text", () => {
  beforeEach(() => {
    generateContentStreamMock.mockReset();
  });

  it("writes JSON output via schema, expands templates, and attaches files", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentToolsForTest } =
        await import("../src/agent/sparkAgentRunner");

      const promptPath = "prompt.md";
      const dataPath = "data.txt";
      const attachmentPath = "extra.txt";
      const schemaPath = "schema.json";
      const outputPath = "out.json";

      await writeFile(path.join(rootDir, dataPath), "world\n", "utf8");
      await writeFile(path.join(rootDir, attachmentPath), "EXTRA\n", "utf8");
      await writeFile(
        path.join(rootDir, promptPath),
        "Hello {{data.txt}}",
        "utf8",
      );
      await writeFile(
        path.join(rootDir, schemaPath),
        JSON.stringify(
          {
            type: "object",
            properties: { x: { type: "number" } },
            required: ["x"],
            additionalProperties: false,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const scheduled: string[] = [];
      const tools = buildSparkAgentToolsForTest({
        workspace: {
          scheduleUpdate: (p) => {
            scheduled.push(p);
          },
          deleteFile: () => Promise.resolve(),
          moveFile: () => Promise.resolve(),
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        progress: silentProgress,
      });

      generateContentStreamMock.mockImplementation(({ config }) => {
        expect(config).toHaveProperty("responseMimeType", "application/json");
        expect(config).toHaveProperty("responseJsonSchema");
        return buildSingleChunkStream('{"x":1}');
      });

      const result = await tools.generate_text.execute({
        promptPath,
        inputPaths: [attachmentPath],
        responseSchemaPath: schemaPath,
        outputPath,
      });

      assertPlainRecord(result, "generate_text result");
      expect(result.status).toBe("written");
      expect(scheduled).toContain(outputPath);
      expect(generateContentStreamMock).toHaveBeenCalledTimes(1);

      const request = generateContentStreamMock.mock.calls[0]?.[0];
      expect(request?.model).toBe("gemini-2.5-pro");

      const promptSent = extractTextFromGoogleContents(request?.contents);
      expect(promptSent).toContain("Hello world");
      expect(promptSent).toContain("# Attached files");
      expect(promptSent).toContain(`## ${attachmentPath}`);
      expect(promptSent).toContain("EXTRA");

      const written = await readFile(path.join(rootDir, outputPath), "utf8");
      expect(written).toBe('{\n  "x": 1\n}\n');
    });
  });
});

describe("Session agent tools: read_file_summary and generate_text", () => {
  beforeEach(() => {
    generateContentStreamMock.mockReset();
  });

  it("read_file_summary calls gemini-flash-latest and includes question + file", async () => {
    await withTempDir(async (workingDirectory) => {
      const { buildSessionAgentToolsForTest } =
        await import("../src/code/sessionGenerationAgent");

      const { paths, tools } = buildSessionAgentToolsForTest({
        workingDirectory,
        includeStory: false,
        includeCoding: false,
        progress: silentProgress,
      });

      await mkdir(paths.workspaceDir, { recursive: true });

      await writeFile(
        path.join(paths.workspaceDir, "note.txt"),
        "alpha\nbeta\n",
        "utf8",
      );

      generateContentStreamMock.mockImplementation((req) => {
        expect(req.model).toBe("gemini-flash-latest");
        const sent = extractTextFromGoogleContents(req.contents);
        expect(sent).toContain("Question: What is in this file?");
        expect(sent).toContain("alpha");
        expect(sent).toContain("beta");
        return buildSingleChunkStream("NO_CHANGES");
      });

      const out = await tools.read_file_summary.execute({
        path: "note.txt",
        question: "What is in this file?",
      });
      expect(out.summary).toBe("NO_CHANGES");
      expect(out.path).toBe("note.txt");
    });
  });

  it("session agent generate_text uses gemini-2.5-pro", async () => {
    await withTempDir(async (workingDirectory) => {
      const { buildSessionAgentToolsForTest } =
        await import("../src/code/sessionGenerationAgent");

      const { paths, tools } = buildSessionAgentToolsForTest({
        workingDirectory,
        includeStory: false,
        includeCoding: false,
        progress: silentProgress,
      });

      await mkdir(paths.workspaceDir, { recursive: true });

      await writeFile(
        path.join(paths.workspaceDir, "draft.md"),
        "Say hi.",
        "utf8",
      );

      generateContentStreamMock.mockImplementation((req) => {
        expect(req.model).toBe("gemini-2.5-pro");
        return buildSingleChunkStream("hello");
      });

      const out = await tools.generate_text.execute({
        promptPath: "draft.md",
        outputPath: "out.md",
      });
      expect(out).toHaveProperty("outputPath", "out.md");
    });
  });
});
