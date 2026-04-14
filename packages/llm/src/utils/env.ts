import fs from "node:fs";
import path from "node:path";

let envLoaded = false;

export function loadLocalEnv(): void {
  if (envLoaded) {
    return;
  }
  const envPath = path.join(process.cwd(), ".env.local");
  loadEnvFromFile(envPath, { override: false });
  preferGoogleServiceAccountAuth();
  applyDefaultLlmTransportEnv();
  envLoaded = true;
}

export function preferGoogleServiceAccountAuth(): void {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!serviceAccountJson) {
    return;
  }
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;

  if (
    process.env.LLM_FILES_GCS_BUCKET === undefined &&
    process.env.VERTEX_GCS_BUCKET === undefined
  ) {
    const projectId = parseServiceAccountProjectId(serviceAccountJson);
    if (projectId !== null) {
      process.env.LLM_FILES_GCS_BUCKET = `${projectId}.firebasestorage.app`;
    }
  }
}

export function loadEnvFromFile(
  filePath: string,
  { override = false }: { override?: boolean } = {},
): void {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of content.split(/\r?\n/u)) {
    const entry = parseEnvLine(line);
    if (!entry) {
      continue;
    }
    const [key, value] = entry;
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  preferGoogleServiceAccountAuth();
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = trimmed.match(
    /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_\-.]*)\s*=\s*(.*)$/u,
  );
  if (!match) {
    return null;
  }

  const key = match[1];
  let value = match[2] ?? "";

  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1);
  } else if (
    value.startsWith("'") &&
    value.endsWith("'") &&
    value.length >= 2
  ) {
    value = value.slice(1, -1);
  } else {
    const commentIndex = value.indexOf(" #");
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex);
    }
    value = value.trim();
  }
  return [key, value];
}

function parseServiceAccountProjectId(serviceAccountJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const projectId = (parsed as { project_id?: unknown }).project_id;
  if (typeof projectId !== "string") {
    return null;
  }
  const trimmed = projectId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function applyDefaultLlmTransportEnv(): void {
  // ChatGPT Responses WebSocket transport can hang before the first event in this repo's
  // runtime environments, so default to SSE unless the operator explicitly overrides it.
  if (process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE === undefined) {
    process.env.CHATGPT_RESPONSES_WEBSOCKET_MODE = "off";
  }
}
