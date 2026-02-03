import { z } from "zod";
import { decodeBase64ToBytes, encodeBytesToBase64Url } from "./base64";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const ServiceAccountSchema = z
  .object({
    project_id: z.string().trim().min(1),
    client_email: z.string().trim().min(1),
    private_key: z.string().trim().min(1),
    token_uri: z.string().trim().min(1).optional(),
  })
  .transform(({ project_id, client_email, private_key, token_uri }) => ({
    projectId: project_id,
    clientEmail: client_email,
    privateKey: private_key.replace(/\\n/g, "\n"),
    tokenUri: token_uri,
  }));

export type GoogleServiceAccount = z.infer<typeof ServiceAccountSchema>;

export function parseGoogleServiceAccountJson(raw: string): GoogleServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${(error as Error).message ?? String(error)}`,
    );
  }
  return ServiceAccountSchema.parse(parsed);
}

function base64UrlEncodeJson(value: unknown): string {
  return encodeBytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8DerBytes(pem: string): Uint8Array {
  const trimmed = pem.trim();
  const normalized = trimmed
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return decodeBase64ToBytes(normalized);
}

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
  scopeKey: string;
};

let cached: TokenCache | null = null;

export async function getGoogleAccessToken(options: {
  serviceAccountJson: string;
  scopes: string[];
}): Promise<{ accessToken: string; projectId: string }> {
  const sa = parseGoogleServiceAccountJson(options.serviceAccountJson);
  const scopeKey = options.scopes.slice().sort().join(" ");

  // Refresh 60s early to avoid edge timing issues.
  if (cached && cached.scopeKey === scopeKey && Date.now() < cached.expiresAtMs - 60_000) {
    return { accessToken: cached.accessToken, projectId: sa.projectId };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + 60 * 50; // ~50 minutes

  const header = { alg: "RS256", typ: "JWT" } as const;
  const payload = {
    iss: sa.clientEmail,
    scope: scopeKey,
    aud: sa.tokenUri ?? GOOGLE_TOKEN_ENDPOINT,
    iat: nowSeconds,
    exp: expSeconds,
  } as const;

  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const keyBytes = pemToPkcs8DerBytes(sa.privateKey);
  const keyData = Uint8Array.from(keyBytes).buffer;
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) {
    throw new Error("WebCrypto is not available; cannot mint Google access tokens.");
  }

  const privateKey = await cryptoApi.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoApi.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${encodeBytesToBase64Url(new Uint8Array(signature))}`;

  const body = new URLSearchParams();
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  body.set("assertion", jwt);

  const resp = await fetch(sa.tokenUri ?? GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Google OAuth token exchange failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }

  const json = (await resp.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string" || json.access_token.trim().length === 0) {
    throw new Error("Google OAuth token exchange returned an empty access_token.");
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const expiresAtMs = Date.now() + expiresIn * 1000;

  cached = {
    accessToken: json.access_token,
    expiresAtMs,
    scopeKey,
  };

  return { accessToken: json.access_token, projectId: sa.projectId };
}

