import { z } from "zod";
import { loadLocalEnv } from "./env";
import { getGoogleAccessToken, getGoogleServiceAccount } from "./googleAuth";

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

export const TaskSchema = z.discriminatedUnion("type", [
  GenerateQuizTaskEnvelope,
  GenerateLessonTaskEnvelope,
  HelloWorldTaskEnvelope,
]);

export type GenerateQuizTask = z.infer<typeof GenerateQuizTaskSchema>;
export type GenerateLessonTask = z.infer<typeof GenerateLessonTaskSchema>;
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
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
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

async function getTasksAccessToken(): Promise<string> {
  return await getGoogleAccessToken(CLOUD_TASKS_SCOPE);
}

function getProjectId(): string {
  const sa = getGoogleServiceAccount();
  return sa.projectId;
}

export async function createTask(task: Task): Promise<void> {
  loadLocalEnv();
  const serviceUrl = process.env.TASKS_SERVICE_URL ?? "";
  if (!serviceUrl) {
    throw new Error(
      "TASKS_SERVICE_URL is not configured. Set env or pass serviceUrl.",
    );
  }

  const apiKey = process.env.TASKS_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("TASKS_API_KEY is not configured. Set env or pass apiKey.");
  }

  const location = DEFAULT_LOCATION;
  const queue = DEFAULT_QUEUE;

  if (isLocalUrl(serviceUrl)) {
    // Call handler directly during local development
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const body = JSON.stringify(task);
    let postUrl = serviceUrl;
    try {
      const u = new URL(serviceUrl);
      if (u.pathname === "/") {
        u.pathname = "/api/internal/tasks";
      }
      postUrl = u.toString();
    } catch (error) {
      throw new Error(
        `Failed to resolve tasks service URL "${serviceUrl}": ${(error as Error).message}`,
      );
    }
    try {
      console.warn(`Starting a local task: ${postUrl}`);
      const resp = await fetch(postUrl, {
        method: "POST",
        headers,
        body,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn(
          `Local task POST failed: ${resp.status} ${resp.statusText} ${text}`,
        );
      }
    } catch (err) {
      console.warn(`Local task POST error: ${(err as Error).message}`);
    }
    return;
  }

  // Otherwise schedule via Google Cloud Tasks
  const projectId = getProjectId();
  const accessToken = await getTasksAccessToken();

  const handlerUrl = new URL(serviceUrl);
  // If only origin (no path), default to internal tasks handler path
  if (handlerUrl.pathname === "/") {
    handlerUrl.pathname = "/api/internal/tasks";
  }
  handlerUrl.searchParams.set("type", task.type);

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
