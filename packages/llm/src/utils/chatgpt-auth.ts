import { z } from "zod";

import { loadLocalEnv } from "./env";

const CHATGPT_AUTH_JSON_ENV = "CHATGPT_AUTH_JSON";
const CHATGPT_AUTH_JSON_B64_ENV = "CHATGPT_AUTH_JSON_B64";

const CHATGPT_ACCESS_ENV = "CHATGPT_ACCESS";
const CHATGPT_REFRESH_ENV = "CHATGPT_REFRESH";
const CHATGPT_EXPIRES_ENV = "CHATGPT_EXPIRES";

const CHATGPT_ACCOUNT_ID_ENV = "CHATGPT_ACCOUNT_ID";
const CHATGPT_ID_TOKEN_ENV = "CHATGPT_ID_TOKEN";
const CHATGPT_ACCESS_TOKEN_ENV = "CHATGPT_ACCESS_TOKEN";
const CHATGPT_REFRESH_TOKEN_ENV = "CHATGPT_REFRESH_TOKEN";
const CHATGPT_EXPIRES_AT_ENV = "CHATGPT_EXPIRES_AT";

const CHATGPT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CHATGPT_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CHATGPT_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";

const TOKEN_EXPIRY_BUFFER_MS = 30_000;

export type ChatGptAuthProfile = {
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
  readonly accountId: string;
  readonly idToken?: string;
};

const AuthInputSchema = z
  .object({
    access: z.string().min(1).optional(),
    access_token: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
    refresh: z.string().min(1).optional(),
    refresh_token: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    expires: z.union([z.number(), z.string()]).optional(),
    expires_at: z.union([z.number(), z.string()]).optional(),
    expiresAt: z.union([z.number(), z.string()]).optional(),
    accountId: z.string().min(1).optional(),
    account_id: z.string().min(1).optional(),
    id_token: z.string().optional(),
    idToken: z.string().optional(),
  })
  .loose();

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

export function encodeChatGptAuthJson(profile: ChatGptAuthProfile): string {
  const payload = {
    access: profile.access,
    refresh: profile.refresh,
    expires: profile.expires,
    accountId: profile.accountId,
    ...(profile.idToken ? { id_token: profile.idToken } : {}),
  };
  return JSON.stringify(payload);
}

export function encodeChatGptAuthJsonB64(profile: ChatGptAuthProfile): string {
  return Buffer.from(encodeChatGptAuthJson(profile)).toString("base64url");
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

export async function getChatGptAuthProfile(): Promise<ChatGptAuthProfile> {
  if (cachedProfile && !isExpired(cachedProfile)) {
    return cachedProfile;
  }
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      const baseProfile = cachedProfile ?? loadAuthProfileFromEnv();
      const profile = isExpired(baseProfile)
        ? await refreshChatGptOauthToken(baseProfile.refresh)
        : baseProfile;
      cachedProfile = profile;
      return profile;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
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
  data: z.infer<typeof AuthInputSchema>,
): ChatGptAuthProfile {
  const access =
    data.access ?? data.access_token ?? data.accessToken ?? undefined;
  const refresh =
    data.refresh ?? data.refresh_token ?? data.refreshToken ?? undefined;
  if (!access || !refresh) {
    throw new Error("ChatGPT credentials must include access and refresh.");
  }
  const expiresRaw =
    data.expires ?? data.expires_at ?? data.expiresAt;
  const idToken =
    data.idToken ?? data.id_token ?? undefined;
  const expires =
    normalizeEpochMillis(expiresRaw) ??
    extractJwtExpiry(idToken ?? access) ??
    Date.now() + 5 * 60_000;
  const accountId =
    data.accountId ??
    data.account_id ??
    extractChatGptAccountId(idToken ?? "") ??
    extractChatGptAccountId(access);
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

function loadAuthProfileFromEnv(): ChatGptAuthProfile {
  loadLocalEnv();

  const rawJsonB64 = process.env[CHATGPT_AUTH_JSON_B64_ENV]?.trim();
  if (rawJsonB64) {
    let decoded: string;
    try {
      decoded = Buffer.from(rawJsonB64, "base64url").toString("utf8");
    } catch (error) {
      throw new Error(
        `Invalid ${CHATGPT_AUTH_JSON_B64_ENV}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return parseAuthJson(decoded, CHATGPT_AUTH_JSON_B64_ENV);
  }

  const rawJson = process.env[CHATGPT_AUTH_JSON_ENV]?.trim();
  if (rawJson) {
    return parseAuthJson(rawJson, CHATGPT_AUTH_JSON_ENV);
  }

  const access =
    process.env[CHATGPT_ACCESS_TOKEN_ENV]?.trim() ??
    process.env[CHATGPT_ACCESS_ENV]?.trim();
  const refresh =
    process.env[CHATGPT_REFRESH_TOKEN_ENV]?.trim() ??
    process.env[CHATGPT_REFRESH_ENV]?.trim();
  const expiresRaw =
    process.env[CHATGPT_EXPIRES_AT_ENV]?.trim() ??
    process.env[CHATGPT_EXPIRES_ENV]?.trim();
  const accountId = process.env[CHATGPT_ACCOUNT_ID_ENV]?.trim();
  const idToken =
    process.env[CHATGPT_ID_TOKEN_ENV]?.trim() ??
    process.env.CHATGPT_ID_TOKEN?.trim();

  if (!access && !refresh && !expiresRaw && !accountId && !idToken) {
    throw new Error(
      `Missing ChatGPT OAuth credentials. Set ${CHATGPT_AUTH_JSON_B64_ENV} (recommended) or ${CHATGPT_AUTH_JSON_ENV}.`,
    );
  }

  const parsed = AuthInputSchema.safeParse({
    access,
    refresh,
    expires: expiresRaw,
    accountId: accountId || undefined,
    idToken: idToken || undefined,
  });
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("\n");
    throw new Error(`Invalid ChatGPT env credentials: ${message}`);
  }
  return normalizeAuthProfile(parsed.data);
}

function isExpired(profile: ChatGptAuthProfile): boolean {
  return profile.expires - TOKEN_EXPIRY_BUFFER_MS <= Date.now();
}

function parseAuthJson(raw: string, label: string): ChatGptAuthProfile {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid ${label}: expected JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const parsed = AuthInputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("\n");
    throw new Error(`Invalid ${label}: ${message}`);
  }
  return normalizeAuthProfile(parsed.data);
}
