import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobProgressReporter } from "../src/utils/concurrency";

import { requireFunctionTool } from "./toolAssertions";

const dummyServiceAccount = JSON.stringify({
  project_id: "test-project",
  client_email: "test@example.com",
  private_key: "-----BEGIN PRIVATE KEY-----\\nTESTKEY\\n-----END PRIVATE KEY-----",
});

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = dummyServiceAccount;
}

type GeminiStreamRequest = {
  model: string;
  contents: unknown;
  config: Record<string, unknown>;
};

type GeminiGenerateRequest = {
  model: string;
  contents: unknown;
  config: Record<string, unknown>;
};

const { generateContentStreamMock, generateContentMock } = vi.hoisted(() => ({
  generateContentStreamMock: vi.fn<(req: GeminiStreamRequest) => AsyncIterable<unknown>>(),
  generateContentMock: vi.fn<(req: GeminiGenerateRequest) => Promise<unknown>>(),
}));

vi.mock("@google/genai/node", () => {
  class GoogleGenAI {
    readonly models = {
      generateContentStream: generateContentStreamMock,
      generateContent: generateContentMock,
    };

    constructor(_options: unknown) {
      void _options;
    }
  }

  return {
    GoogleGenAI,
    createPartFromBase64: (
      data: string,
      mimeType: string,
      mediaResolution?: string,
    ) => ({
      inlineData: {
        data,
        mimeType,
        ...(mediaResolution ? { mediaResolution } : {}),
      },
    }),
    FinishReason: {
      SAFETY: "SAFETY",
      BLOCKLIST: "BLOCKLIST",
      PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
      SPII: "SPII",
    },
    FunctionCallingConfigMode: {
      VALIDATED: "VALIDATED",
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
    generateContentMock.mockReset();
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

  it("does not send thinkingLevel for gemini-3.1-pro-preview", async () => {
    const { generateText } = await import("../src/utils/llm");

    await generateText({
      modelId: "gemini-3.1-pro-preview",
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

  it("uses direct Vertex image generation for gemini-3-pro-image-preview", async () => {
    const { generateImages } = await import("../src/utils/llm");
    generateContentMock.mockResolvedValue({
      modelVersion: "gemini-3-pro-image-preview",
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: Buffer.from("89504e470d0a1a0a", "hex").toString("base64"),
                },
              },
            ],
          },
        },
      ],
    });

    const images = await generateImages({
      modelId: "gemini-3-pro-image-preview",
      stylePrompt: "flat icon",
      imageGradingPrompt: "must match the prompt",
      imagePrompts: ["a red square"],
    });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(generateContentStreamMock).not.toHaveBeenCalled();
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/png");
    expect(Buffer.isBuffer(images[0]?.data)).toBe(true);
    expect(images[0]?.data.length).toBeGreaterThan(0);
  });
});

describe.skip("Spark agent tool: generate_json", () => {
  beforeEach(() => {
    generateContentStreamMock.mockReset();
  });

  it("writes JSON output and schedules the generated file", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const sourcePath = "source.md";
      const schemaPath = "schema.json";
      const outputPath = "out.json";

      await writeFile(
        path.join(rootDir, sourcePath),
        "Hello world\n",
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
      const tools = buildSparkAgentTools({
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
        expect(config).not.toHaveProperty("responseJsonSchema");
        return buildSingleChunkStream('{"x":1}');
      });

      const generateJsonTool = tools.generate_json;
      requireFunctionTool(generateJsonTool);

      const result = await generateJsonTool.execute({
        sourcePath,
        schemaPath,
        outputPath,
      });

      assertPlainRecord(result, "generate_json result");
      expect(result.status).toBe("written");
      expect(scheduled).toContain(outputPath);
      const written = await readFile(path.join(rootDir, outputPath), "utf8");
      expect(written).toBe('{\n  "x": 1\n}\n');
    });
  }, 10_000);
});

describe("Spark agent tool: extract_text", () => {
  beforeEach(() => {
    generateContentStreamMock.mockReset();
  });

  it("uses the fixed extraction model, writes markdown output, and returns minimal status", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const sourcePath = "student.png";
      const contextPath = "problems.jpg";
      const outputPath = "transcription.md";
      await writeFile(
        path.join(rootDir, sourcePath),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
      );
      await writeFile(
        path.join(rootDir, contextPath),
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      );

      const scheduled: string[] = [];
      const tools = buildSparkAgentTools({
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

      generateContentStreamMock.mockImplementation(() => {
        return buildSingleChunkStream(
          ["# Extracted", "", "Answer is \\(x^2 + y^2\\)."].join("\n"),
        );
      });

      const extractTextTool = tools.extract_text;
      requireFunctionTool(extractTextTool);

      const result = await extractTextTool.execute({
        documentPaths: [sourcePath],
        outputPath,
        instructions: "problems H1 and H2 only",
        supportingPaths: [contextPath],
        supportingInstructions:
          "Use supporting documents only for ambiguity resolution.",
      });

      assertPlainRecord(result, "extract_text result");
      expect(result).toEqual({
        status: "written",
      });
      expect(scheduled).toContain(outputPath);
      expect(generateContentStreamMock).toHaveBeenCalledTimes(1);

      const request = generateContentStreamMock.mock.calls[0]?.[0];
      expect(request?.model).toBe("gemini-flash-latest");
      const promptSent = extractTextFromGoogleContents(request?.contents);
      expect(promptSent).toContain("Agent-supplied prompt (PRIMARY documents to transcribe):");
      expect(promptSent).toContain("Agent-supplied prompt (SUPPORTING documents for disambiguation only):");
      expect(promptSent).toContain("embedded LaTeX");
      expect(promptSent).toContain("inline '\\(...\\)', display '\\[...\\]'");
      expect(promptSent).toContain("problems H1 and H2 only");
      expect(promptSent).toContain(
        "Use supporting documents only for ambiguity resolution.",
      );
      expect(promptSent).not.toContain(contextPath);

      const written = await readFile(path.join(rootDir, outputPath), "utf8");
      expect(written).toContain("Answer is \\(x^2 + y^2\\).");
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
