import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import readline from "node:readline";
import { URL } from "node:url";

import {
  encodeChatGptAuthJsonB64,
  exchangeChatGptOauthCode,
} from "@spark/llm/utils/chatgpt-auth";

import { ensureEvalEnvLoaded } from "../utils/paths";

ensureEvalEnvLoaded();

const CHATGPT_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CHATGPT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CHATGPT_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";

async function main(): Promise<void> {
  const { verifier, challenge, state } = createChatGptPkce();
  const authorizeUrl = buildChatGptAuthorizeUrl({ challenge, state });
  process.stdout.write("Open this URL to authorize ChatGPT OAuth:\n");
  process.stdout.write(`${authorizeUrl}\n\n`);

  let code: string | undefined;
  try {
    const result = await startChatGptOauthCallbackServer({
      expectedState: state,
    });
    code = result.code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `OAuth callback server failed (${message}). Paste the redirect URL or code:\n`,
    );
    const manual = await prompt("Redirect URL or code: ");
    const parsed = parseChatGptOauthRedirect(manual, state);
    code = parsed.code;
  }

  if (!code) {
    throw new Error("No OAuth code provided.");
  }

  const profile = await exchangeChatGptOauthCode({ code, verifier });
  const encoded = encodeChatGptAuthJsonB64(profile);
  process.stdout.write("\nSet this environment variable on your server:\n\n");
  process.stdout.write(`CHATGPT_AUTH_JSON_B64=${encoded}\n\n`);
  process.stdout.write(
    "The token payload is base64url-encoded JSON (access/refresh/expires/accountId).\n",
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function createChatGptPkce(): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = toBase64Url(randomBytes(64));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  const state = toBase64Url(randomBytes(32));
  return { verifier, challenge, state };
}

function buildChatGptAuthorizeUrl({
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

function parseChatGptOauthRedirect(
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

async function startChatGptOauthCallbackServer(options: {
  expectedState: string;
  redirectUri?: string;
  timeoutMs?: number;
}): Promise<{ code: string; state?: string }> {
  const redirectUri = options.redirectUri ?? CHATGPT_OAUTH_REDIRECT_URI;
  const url = new URL(redirectUri);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("OAuth redirect URI must be localhost for callback server.");
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

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}
