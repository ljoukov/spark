import { z } from "zod";
import { encodeBytesToBase64 } from "./gcp/base64";
import { getGoogleAccessToken as getGoogleServiceAccountAccessToken } from "./gcp/googleAccessToken";
import { isNodeRuntime } from "./runtime";

// Server-side task schema
export const GenerateQuizTaskSchema = z.object({
  userId: z.string().min(1),
  uploadId: z.string().min(1),
  quizId: z.string().min(1),
});

const GenerateQuizTaskEnvelope = z.object({
  type: z.literal("generateQuiz"),
  generateQuiz: GenerateQuizTaskSchema,
});

export const GenerateLessonTaskSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  proposalId: z.string().min(1),
  title: z.string().min(1),
  tagline: z.string().min(1).optional(),
  topics: z.array(z.string().min(1)).min(1),
  emoji: z.string().min(1).optional(),
  sourceSessionId: z.string().min(1).optional(),
});

const GenerateLessonTaskEnvelope = z.object({
  type: z.literal("generateLesson"),
  generateLesson: GenerateLessonTaskSchema,
});

const HelloWorldTaskEnvelope = z.object({
  type: z.literal("helloWorld"),
});

export const GenerateWelcomeSessionTaskSchema = z.object({
  topic: z.string().min(1),
});

const GenerateWelcomeSessionTaskEnvelope = z.object({
  type: z.literal("generateWelcomeSession"),
  generateWelcomeSession: GenerateWelcomeSessionTaskSchema,
});

export const RunAgentTaskSchema = z.object({
  userId: z.string().min(1),
  agentId: z.string().min(1),
  workspaceId: z.string().min(1),
});

const RunAgentTaskEnvelope = z.object({
  type: z.literal("runAgent"),
  runAgent: RunAgentTaskSchema,
});

export const TaskSchema = z.discriminatedUnion("type", [
  GenerateQuizTaskEnvelope,
  GenerateLessonTaskEnvelope,
  GenerateWelcomeSessionTaskEnvelope,
  RunAgentTaskEnvelope,
  HelloWorldTaskEnvelope,
]);

export type GenerateQuizTask = z.infer<typeof GenerateQuizTaskSchema>;
export type GenerateLessonTask = z.infer<typeof GenerateLessonTaskSchema>;
export type GenerateWelcomeSessionTask = z.infer<
  typeof GenerateWelcomeSessionTaskSchema
>;
export type RunAgentTask = z.infer<typeof RunAgentTaskSchema>;
export type HelloWorldTask = z.infer<typeof HelloWorldTaskEnvelope>;
export type Task = z.infer<typeof TaskSchema>;

const CLOUD_TASKS_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/cloud-tasks",
];

const DEFAULT_LOCATION = "us-central1"; // per instruction
const DEFAULT_QUEUE = "spark-tasks";

function base64EncodeUrlSafe(bytes: Uint8Array): string {
  // URL-safe base64 encoding: '+' -> '-', '/' -> '_', keep '=' padding
  return encodeBytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_");
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // Treat any localhost/127.0.0.1 (http or https) as local dev
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

function readEnvVar(name: string): string {
  const env = (globalThis as unknown as { process?: { env?: unknown } }).process
    ?.env as Record<string, unknown> | undefined;
  const value = env?.[name];
  return typeof value === "string" ? value : "";
}

function formatFetchError(error: unknown): string {
  if (error instanceof Error) {
    const pieces: string[] = [error.message];
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      pieces.push(`cause=${cause.message}`);
    } else if (cause) {
      pieces.push(`cause=${String(cause)}`);
    }
    return pieces.join(" ");
  }
  return String(error);
}

export async function createTask(
  task: Task,
  options: {
    serviceUrl?: string;
    apiKey?: string;
    serviceAccountJson?: string;
    location?: string;
    queue?: string;
  } = {},
): Promise<void> {
  const serviceUrl = options.serviceUrl ?? readEnvVar("TASKS_SERVICE_URL");
  if (!serviceUrl) {
    throw new Error(
      "TASKS_SERVICE_URL is not configured. Set env or pass serviceUrl.",
    );
  }

  const apiKey = options.apiKey ?? readEnvVar("TASKS_API_KEY");
  if (!apiKey) {
    throw new Error("TASKS_API_KEY is not configured. Set env or pass apiKey.");
  }

  const location = options.location ?? DEFAULT_LOCATION;
  const envQueue = readEnvVar("TASKS_QUEUE");
  const queue =
    options.queue ?? (envQueue.trim().length > 0 ? envQueue : DEFAULT_QUEUE);

  if (isLocalUrl(serviceUrl)) {
    // Local development: emulate Cloud Tasks by fire-and-forget scheduling.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const body = JSON.stringify(task);
    let postUrl = serviceUrl;
    try {
      const u = new URL(serviceUrl);
      if (u.hostname === "127.0.0.1" || u.hostname === "0.0.0.0") {
        u.hostname = "localhost";
      }
      // Allow local dev callers to omit the port and reuse the Vite HTTPS port.
      if (!u.port) {
        const vitePort = readEnvVar("VITE_DEV_PORT").trim();
        const envPort = readEnvVar("PORT").trim();
        if (vitePort && /^[0-9]+$/.test(vitePort)) {
          u.port = vitePort;
        } else if (envPort && /^[0-9]+$/.test(envPort)) {
          u.port = envPort;
        } else {
          u.port = "8081";
        }
      }
      if (u.pathname === "/") {
        u.pathname = "/api/internal/tasks";
      }
      u.searchParams.set("type", task.type);
      if (task.type === "runAgent") {
        u.searchParams.set("userId", task.runAgent.userId);
        u.searchParams.set("agentId", task.runAgent.agentId);
        u.searchParams.set("workspaceId", task.runAgent.workspaceId);
      }
      postUrl = u.toString();
    } catch (error) {
      throw new Error(
        `Failed to resolve tasks service URL "${serviceUrl}": ${(error as Error).message}`,
      );
    }
    console.warn(`Starting a local task: ${postUrl}`);
    void (async () => {
      type NodeFetchInit = RequestInit & { dispatcher?: unknown };
      const init: NodeFetchInit = {
        method: "POST",
        headers,
        body,
      };

      try {
        const u = new URL(postUrl);
        if (isNodeRuntime() && u.protocol === "https:") {
          const undici = await import("undici");
          init.dispatcher = new undici.Agent({
            connect: { rejectUnauthorized: false },
          });
        }
      } catch (error) {
        console.warn(`Local task dispatcher setup failed: ${formatFetchError(error)}`);
      }

      try {
        const resp = await fetch(postUrl, init);
        const text = await resp.text().catch(() => "");
        if (!resp.ok) {
          console.warn(
            `Local task POST failed: ${resp.status} ${resp.statusText} ${text}`,
          );
        }
      } catch (error) {
        console.warn(`Local task POST error: ${formatFetchError(error)}`);
      }
    })();
    return;
  }

  // Otherwise schedule via Google Cloud Tasks
  const serviceAccountJson =
    options.serviceAccountJson ?? readEnvVar("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!serviceAccountJson) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not configured. Set env or pass serviceAccountJson.",
    );
  }
  const { accessToken, projectId } = await getGoogleServiceAccountAccessToken({
    serviceAccountJson,
    scopes: CLOUD_TASKS_SCOPE,
  });

  const handlerUrl = new URL(serviceUrl);
  // If only origin (no path), default to internal tasks handler path
  if (handlerUrl.pathname === "/") {
    handlerUrl.pathname = "/api/internal/tasks";
  }
  handlerUrl.searchParams.set("type", task.type);
  if (task.type === "runAgent") {
    handlerUrl.searchParams.set("userId", task.runAgent.userId);
    handlerUrl.searchParams.set("agentId", task.runAgent.agentId);
    handlerUrl.searchParams.set("workspaceId", task.runAgent.workspaceId);
  }

  const taskPayload = JSON.stringify(task);
  const encodedBody = base64EncodeUrlSafe(
    new TextEncoder().encode(taskPayload),
  );

  const createUrl = `https://cloudtasks.googleapis.com/v2/projects/${projectId}/locations/${location}/queues/${queue}/tasks`;

  console.warn(`Starting remote task via TasksAPI: ${handlerUrl}`);
  const resp = await fetch(createUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      task: {
        httpRequest: {
          url: handlerUrl.toString(),
          httpMethod: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: encodedBody,
        },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.warn(
      `Cloud Tasks create failed: ${resp.status} ${resp.statusText} ${text}`,
    );
    throw new Error("Task creation failed");
  }
}
