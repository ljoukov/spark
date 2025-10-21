import { z } from "zod";
import { loadLocalEnv } from "./env";
import { getGoogleAccessToken, getGoogleServiceAccount } from "./googleAuth";

// Server-side task schema
export const GenerateQuizTaskSchema = z.object({
  userId: z.string().min(1),
  quizId: z.string().min(1),
});

export const TaskSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("generateQuiz"),
    generateQuiz: GenerateQuizTaskSchema,
  }),
]);

export type GenerateQuizTask = z.infer<typeof GenerateQuizTaskSchema>;
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

type CreateTaskOptions = {
  serviceUrl?: string; // full URL to the tasks handler (e.g., https://host/api/internal/tasks)
  apiKey?: string; // bearer token for the handler
  queue?: string; // Cloud Tasks queue name
  location?: string; // GCP region
};

async function getTasksAccessToken(): Promise<string> {
  return await getGoogleAccessToken(CLOUD_TASKS_SCOPE);
}

function getProjectId(): string {
  const sa = getGoogleServiceAccount();
  return sa.projectId;
}

export async function createTask(
  task: Task,
  opts: CreateTaskOptions = {},
): Promise<void> {
  loadLocalEnv();

  const serviceUrl = opts.serviceUrl ?? process.env.TASKS_SERVICE_URL ?? "";
  const apiKey = opts.apiKey ?? process.env.TASKS_API_KEY ?? "";
  const location = opts.location ?? DEFAULT_LOCATION;
  const queue = opts.queue ?? process.env.TASKS_QUEUE ?? DEFAULT_QUEUE;

  if (!serviceUrl) {
    throw new Error(
      "TASKS_SERVICE_URL is not configured. Set env or pass serviceUrl.",
    );
  }

  if (!apiKey) {
    throw new Error("TASKS_API_KEY is not configured. Set env or pass apiKey.");
  }

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
    } catch {
      // keep as-is
    }
    try {
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
