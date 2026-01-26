import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import lockfile from "proper-lockfile";
import { z } from "zod";

import { loadLocalEnv } from "./env";

const CHATGPT_AUTH_STORE_ENV = "CHATGPT_AUTH_STORE_PATH";
const CHATGPT_AUTH_SOURCE_ENV = "CHATGPT_AUTH_SOURCE";
const CHATGPT_ACCESS_ENV = "CHATGPT_ACCESS";
const CHATGPT_REFRESH_ENV = "CHATGPT_REFRESH";
const CHATGPT_EXPIRES_ENV = "CHATGPT_EXPIRES";
const CHATGPT_ACCOUNT_ID_ENV = "CHATGPT_ACCOUNT_ID";
const CHATGPT_ACCESS_TOKEN_ENV = "CHATGPT_ACCESS_TOKEN";
const CHATGPT_REFRESH_TOKEN_ENV = "CHATGPT_REFRESH_TOKEN";
const CHATGPT_EXPIRES_AT_ENV = "CHATGPT_EXPIRES_AT";

const CHATGPT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CHATGPT_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CHATGPT_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CHATGPT_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";

const TOKEN_EXPIRY_BUFFER_MS = 30_000;
const LOCK_RETRY_OPTIONS = {
  retries: {
    retries: 24,
    minTimeout: 200,
    maxTimeout: 200,
  },
  stale: 12_000,
  realpath: false,
} as const;

export type ChatGptAuthProfile = {
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
  readonly accountId: string;
  readonly idToken?: string;
};

export type ChatGptAuthSource = "env" | "store" | "pkce";

const ChatGptAuthSourceSchema = z.enum(["env", "store", "pkce"]);

const StoredAuthSchema = z
  .object({
    access: z.string().min(1),
    refresh: z.string().min(1),
    expires: z.number(),
    accountId: z.string().min(1),
    id_token: z.string().optional(),
    idToken: z.string().optional(),
  })
  .passthrough();

const EnvAuthSchema = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1),
  expires: z.union([z.number(), z.string()]).optional(),
  accountId: z.string().optional(),
  idToken: z.string().optional(),
  id_token: z.string().optional(),
});

const RefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.union([z.number(), z.string()]),
});

const ExchangeResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.union([z.number(), z.string()]),
  id_token: z.string().optional(),
});

let cachedProfile: ChatGptAuthProfile | null = null;
let refreshPromise: Promise<ChatGptAuthProfile> | null = null;

export function createChatGptPkce(): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = toBase64Url(randomBytes(64));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  const state = toBase64Url(randomBytes(32));
  return { verifier, challenge, state };
}

export function buildChatGptAuthorizeUrl({
  challenge,
  state,
  redirectUri = CHATGPT_OAUTH_REDIRECT_URI,
}: {
  challenge: string;
  state: string;
  redirectUri?: string;
}): string {
  const url = new URL(CHATGPT_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CHATGPT_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "spark");
  return url.toString();
}

export async function exchangeChatGptOauthCode({
  code,
  verifier,
  redirectUri = CHATGPT_OAUTH_REDIRECT_URI,
}: {
  code: string;
  verifier: string;
  redirectUri?: string;
}): Promise<ChatGptAuthProfile> {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("client_id", CHATGPT_OAUTH_CLIENT_ID);
  params.set("code", code);
  params.set("code_verifier", verifier);
  params.set("redirect_uri", redirectUri);
  const response = await fetch(CHATGPT_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `ChatGPT OAuth token exchange failed (${response.status}): ${body}`,
    );
  }
  const payload = ExchangeResponseSchema.parse(await response.json());
  return profileFromTokenResponse(payload);
}

export async function refreshChatGptOauthToken(
  refreshToken: string,
): Promise<ChatGptAuthProfile> {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("client_id", CHATGPT_OAUTH_CLIENT_ID);
  params.set("refresh_token", refreshToken);
  const response = await fetch(CHATGPT_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `ChatGPT OAuth refresh failed (${response.status}): ${body}`,
    );
  }
  const payload = RefreshResponseSchema.parse(await response.json());
  return profileFromTokenResponse(payload);
}

export function parseChatGptOauthRedirect(
  input: string,
  expectedState?: string,
): { code: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Empty OAuth redirect input.");
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? undefined;
    if (!code) {
      throw new Error("OAuth redirect URL missing code parameter.");
    }
    if (expectedState && state && state !== expectedState) {
      throw new Error("OAuth redirect state did not match expected value.");
    }
    return { code, state };
  }
  if (trimmed.includes("code=")) {
    const params = new URLSearchParams(trimmed);
    const code = params.get("code");
    const state = params.get("state") ?? undefined;
    if (!code) {
      throw new Error("OAuth redirect input missing code parameter.");
    }
    if (expectedState && state && state !== expectedState) {
      throw new Error("OAuth redirect state did not match expected value.");
    }
    return { code, state };
  }
  return { code: trimmed };
}

export async function startChatGptOauthCallbackServer(options: {
  expectedState: string;
  redirectUri?: string;
  timeoutMs?: number;
}): Promise<{ code: string; state?: string }> {
  const redirectUri = options.redirectUri ?? CHATGPT_OAUTH_REDIRECT_URI;
  const url = new URL(redirectUri);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(
      "OAuth redirect URI must be localhost for callback server.",
    );
  }
  const port = Number.parseInt(url.port || "1455", 10);
  const pathName = url.pathname || "/auth/callback";
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Missing URL.");
        return;
      }
      const requestUrl = new URL(req.url, `http://${url.hostname}:${port}`);
      if (requestUrl.pathname !== pathName) {
        res.statusCode = 404;
        res.end("Not found.");
        return;
      }
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state") ?? undefined;
      if (!code) {
        res.statusCode = 400;
        res.end("Missing code.");
        return;
      }
      if (state && state !== options.expectedState) {
        res.statusCode = 400;
        res.end("State mismatch.");
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Auth received. You can close this tab.");
      server.close(() => {
        resolve({ code, state });
      });
    });
    server.on("error", (error) => {
      reject(error);
    });
    server.listen(port, "127.0.0.1");
    const timeoutMs = options.timeoutMs ?? 120_000;
    const timeout = setTimeout(() => {
      server.close(() => {
        reject(new Error("OAuth callback timed out."));
      });
    }, timeoutMs);
    server.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

export async function getChatGptAuthProfile(): Promise<ChatGptAuthProfile> {
  if (cachedProfile && !isExpired(cachedProfile)) {
    return cachedProfile;
  }
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    const resolved = await resolveAuthProfile();
    const profile =
      resolved.source === "store"
        ? await refreshStoredProfile(resolved.profile)
        : await refreshEnvProfile(resolved.profile);
    cachedProfile = profile;
    refreshPromise = null;
    return profile;
  })();
  return refreshPromise;
}

export async function writeChatGptAuthProfile(
  profile: ChatGptAuthProfile,
): Promise<void> {
  const storePath = resolveAuthStorePath();
  await ensureStoreFile(storePath);
  const payload = {
    access: profile.access,
    refresh: profile.refresh,
    expires: profile.expires,
    accountId: profile.accountId,
    ...(profile.idToken ? { id_token: profile.idToken } : {}),
  };
  await writeFile(storePath, JSON.stringify(payload, null, 2));
}

async function resolveAuthProfile(): Promise<{
  profile: ChatGptAuthProfile;
  source: ChatGptAuthSource;
}> {
  loadLocalEnv();
  const sources = resolveAuthSourceOrder();
  const errors: string[] = [];
  for (const source of sources) {
    try {
      const profile = await loadAuthProfileFromSource(source);
      if (profile) {
        return { profile, source };
      }
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error"),
      );
    }
  }
  const details = errors.length > 0 ? `\n${errors.join("\n")}` : "";
  throw new Error(`Unable to resolve ChatGPT OAuth credentials.${details}`);
}

function resolveAuthSourceOrder(): ChatGptAuthSource[] {
  const raw = process.env[CHATGPT_AUTH_SOURCE_ENV];
  if (!raw) {
    return ["env", "store"];
  }
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    return ["env", "store"];
  }
  const parsed = z.array(ChatGptAuthSourceSchema).safeParse(entries);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join("\n");
    throw new Error(`Invalid ${CHATGPT_AUTH_SOURCE_ENV}: ${message}`);
  }
  return parsed.data;
}

async function loadAuthProfileFromSource(
  source: ChatGptAuthSource,
): Promise<ChatGptAuthProfile | null> {
  switch (source) {
    case "env":
      return loadAuthProfileFromEnv();
    case "store":
      return loadAuthProfileFromStore();
    case "pkce":
      throw new Error(
        "CHATGPT_AUTH_SOURCE=pkce requires running the OAuth login flow.",
      );
  }
}

function loadAuthProfileFromEnv(): ChatGptAuthProfile | null {
  const access =
    process.env[CHATGPT_ACCESS_ENV]?.trim() ??
    process.env[CHATGPT_ACCESS_TOKEN_ENV]?.trim();
  const refresh =
    process.env[CHATGPT_REFRESH_ENV]?.trim() ??
    process.env[CHATGPT_REFRESH_TOKEN_ENV]?.trim();
  const expiresRaw =
    process.env[CHATGPT_EXPIRES_ENV]?.trim() ??
    process.env[CHATGPT_EXPIRES_AT_ENV]?.trim();
  const accountId = process.env[CHATGPT_ACCOUNT_ID_ENV]?.trim();
  if (!access && !refresh && !expiresRaw && !accountId) {
    return null;
  }
  const parsed = EnvAuthSchema.safeParse({
    access,
    refresh,
    expires: expiresRaw,
    accountId: accountId || undefined,
    idToken: process.env.CHATGPT_ID_TOKEN?.trim() || undefined,
  });
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join("\n");
    throw new Error(`Invalid ChatGPT env credentials: ${message}`);
  }
  return normalizeAuthProfile(parsed.data);
}

async function loadAuthProfileFromStore(): Promise<ChatGptAuthProfile | null> {
  const storePath = resolveAuthStorePath();
  let content: string;
  try {
    content = await readFile(storePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const raw = JSON.parse(content) as Record<string, unknown>;
  const hasAny =
    typeof raw.access === "string" ||
    typeof raw.refresh === "string" ||
    typeof raw.expires === "number" ||
    typeof raw.accountId === "string";
  if (!hasAny) {
    return null;
  }
  const parsed = StoredAuthSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => issue.message)
      .join("\n");
    throw new Error(`Invalid ChatGPT auth store payload: ${message}`);
  }
  return normalizeAuthProfile(parsed.data);
}

async function refreshEnvProfile(
  profile: ChatGptAuthProfile,
): Promise<ChatGptAuthProfile> {
  if (!isExpired(profile)) {
    return profile;
  }
  return refreshChatGptOauthToken(profile.refresh);
}

async function refreshStoredProfile(
  profile: ChatGptAuthProfile,
): Promise<ChatGptAuthProfile> {
  if (!isExpired(profile)) {
    return profile;
  }
  const storePath = resolveAuthStorePath();
  await ensureStoreFile(storePath);
  return withAuthStoreLock(storePath, async () => {
    const latest = await loadAuthProfileFromStore();
    if (latest && !isExpired(latest)) {
      return latest;
    }
    if (!latest) {
      return profile;
    }
    try {
      const refreshed = await refreshChatGptOauthToken(latest.refresh);
      await writeChatGptAuthProfile(refreshed);
      return refreshed;
    } catch (error) {
      const fallback = await loadAuthProfileFromStore();
      if (fallback && !isExpired(fallback)) {
        return fallback;
      }
      throw error;
    }
  });
}

async function withAuthStoreLock<T>(
  storePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  await ensureStoreFile(storePath);
  const release = await lockfile.lock(storePath, LOCK_RETRY_OPTIONS);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function ensureStoreFile(storePath: string): Promise<void> {
  await mkdir(path.dirname(storePath), { recursive: true });
  try {
    await readFile(storePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      await writeFile(storePath, JSON.stringify({}, null, 2));
      return;
    }
    throw error;
  }
}

function profileFromTokenResponse(payload: {
  access_token: string;
  refresh_token: string;
  expires_in: number | string;
  id_token?: string;
}): ChatGptAuthProfile {
  const expires = Date.now() + normalizeNumber(payload.expires_in) * 1000;
  const accountId =
    extractChatGptAccountId(payload.id_token ?? "") ??
    extractChatGptAccountId(payload.access_token);
  if (!accountId) {
    throw new Error("Failed to extract chatgpt_account_id from access token.");
  }
  return {
    access: payload.access_token,
    refresh: payload.refresh_token,
    expires,
    accountId,
    idToken: payload.id_token,
  };
}

function normalizeAuthProfile(
  data: z.infer<typeof StoredAuthSchema> | z.infer<typeof EnvAuthSchema>,
): ChatGptAuthProfile {
  const access =
    "access" in data ? data.access : (data as { access?: string }).access;
  const refresh =
    "refresh" in data ? data.refresh : (data as { refresh?: string }).refresh;
  if (!access || !refresh) {
    throw new Error("ChatGPT credentials must include access and refresh.");
  }
  const expiresRaw =
    "expires" in data ? data.expires : (data as { expires?: unknown }).expires;
  const idToken =
    "id_token" in data
      ? data.id_token
      : ((data as { idToken?: string }).idToken ??
        (data as { id_token?: string }).id_token);
  const expires =
    normalizeEpochMillis(expiresRaw) ??
    extractJwtExpiry(idToken ?? access) ??
    Date.now() + 5 * 60_000;
  const accountId =
    "accountId" in data
      ? data.accountId
      : ((data as { accountId?: string }).accountId ??
        extractChatGptAccountId(idToken ?? "") ??
        extractChatGptAccountId(access));
  if (!accountId) {
    throw new Error("ChatGPT credentials missing chatgpt_account_id.");
  }
  return {
    access,
    refresh,
    expires,
    accountId,
    idToken: idToken ?? undefined,
  };
}

function normalizeEpochMillis(value: unknown): number | undefined {
  const numeric = normalizeNumber(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function extractChatGptAccountId(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  const auth = payload?.["https://api.openai.com/auth"];
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    return undefined;
  }
  const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
  if (typeof accountId !== "string" || accountId.length === 0) {
    return undefined;
  }
  return accountId;
}

function extractJwtExpiry(token: string): number | undefined {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== "number") {
    return undefined;
  }
  return exp * 1000;
}

function decodeJwtPayload(
  token: string,
): { exp?: number; [key: string]: unknown } | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload) as { exp?: number; [key: string]: unknown };
  } catch {
    return null;
  }
}

function resolveAuthStorePath(): string {
  const raw = process.env[CHATGPT_AUTH_STORE_ENV];
  if (raw && raw.trim().length > 0) {
    return expandHome(raw.trim());
  }
  return path.join(os.homedir(), ".spark", "chatgpt-auth.json");
}

function expandHome(value: string): string {
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function isExpired(profile: ChatGptAuthProfile): boolean {
  return profile.expires - TOKEN_EXPIRY_BUFFER_MS <= Date.now();
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}
