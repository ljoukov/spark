import { z } from "zod";
import { encodeBytesToBase64 } from "./gcp/base64";
import { getGoogleAccessToken as getGoogleServiceAccountAccessToken } from "./gcp/googleAccessToken";
import { isNodeRuntime } from "./runtime";
import { errorAsString } from "./error";

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
export const TASKS_HANDLER_PATH = "/api/internal/tasks";
export const TASKS_INFO_PATH = "/api/internal/tasks/info";

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
      pieces.push(`cause=${errorAsString(cause)}`);
    }
    return pieces.join(" ");
  }
  return String(error);
}

function normalizeLocalServiceUrl(url: URL): void {
  if (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "0.0.0.0"
  ) {
    if (url.hostname === "127.0.0.1" || url.hostname === "0.0.0.0") {
      url.hostname = "localhost";
    }
    if (!url.port) {
      const vitePort = readEnvVar("VITE_DEV_PORT").trim();
      const envPort = readEnvVar("PORT").trim();
      if (vitePort && /^[0-9]+$/.test(vitePort)) {
        url.port = vitePort;
      } else if (envPort && /^[0-9]+$/.test(envPort)) {
        url.port = envPort;
      } else {
        url.port = "8081";
      }
    }
  }
}

export function resolveTaskServiceUrl(
  serviceUrl: string,
  options: {
    pathname?: string;
    query?: Record<string, string | undefined>;
  } = {},
): string {
  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(serviceUrl);
  } catch (error) {
    throw new Error(
      `Failed to resolve tasks service URL "${serviceUrl}": ${(error as Error).message}`,
    );
  }

  normalizeLocalServiceUrl(resolvedUrl);

  const targetPath = options.pathname ?? TASKS_HANDLER_PATH;
  const currentPath = resolvedUrl.pathname.replace(/\/+$/, "") || "/";
  if (currentPath === "/" || currentPath === TASKS_HANDLER_PATH) {
    resolvedUrl.pathname = targetPath;
  } else if (currentPath.startsWith(`${TASKS_HANDLER_PATH}/`)) {
    resolvedUrl.pathname = targetPath;
  }

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value.length === 0) {
        resolvedUrl.searchParams.delete(key);
      } else {
        resolvedUrl.searchParams.set(key, value);
      }
    }
  }

  return resolvedUrl.toString();
}

async function buildTaskServiceRequestInit(options: {
  url: string;
  apiKey: string;
  method: string;
  body?: string;
}): Promise<RequestInit & { dispatcher?: unknown }> {
  const init: RequestInit & { dispatcher?: unknown } = {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
  };

  if (options.body !== undefined) {
    init.body = options.body;
  }

  try {
    const parsedUrl = new URL(options.url);
    if (isNodeRuntime() && parsedUrl.protocol === "https:" && isLocalUrl(options.url)) {
      const undici = await import("undici");
      init.dispatcher = new undici.Agent({
        connect: { rejectUnauthorized: false },
      });
    }
  } catch (error) {
    console.warn(
      `Task service dispatcher setup failed: ${formatFetchError(error)}`,
    );
  }

  return init;
}

export async function fetchTaskService(
  options: {
    serviceUrl?: string;
    apiKey?: string;
    pathname?: string;
    method?: "GET" | "POST";
    body?: string;
    query?: Record<string, string | undefined>;
  } = {},
): Promise<Response> {
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

  const url = resolveTaskServiceUrl(serviceUrl, {
    pathname: options.pathname,
    query: options.query,
  });
  const init = await buildTaskServiceRequestInit({
    url,
    apiKey,
    method: options.method ?? "GET",
    body: options.body,
  });
  return await fetch(url, init);
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
    const body = JSON.stringify(task);
    const postUrl = resolveTaskServiceUrl(serviceUrl, {
      pathname: TASKS_HANDLER_PATH,
      query:
        task.type === "runAgent"
          ? {
              type: task.type,
              userId: task.runAgent.userId,
              agentId: task.runAgent.agentId,
              workspaceId: task.runAgent.workspaceId,
            }
          : { type: task.type },
    });
    console.warn(`Starting a local task: ${postUrl}`);
    void (async () => {
      try {
        const init = await buildTaskServiceRequestInit({
          url: postUrl,
          apiKey,
          method: "POST",
          body,
        });
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
  handlerUrl.pathname =
    handlerUrl.pathname === "/" ? TASKS_HANDLER_PATH : handlerUrl.pathname;
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
