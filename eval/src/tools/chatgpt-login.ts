import readline from "node:readline";

import {
  buildChatGptAuthorizeUrl,
  createChatGptPkce,
  exchangeChatGptOauthCode,
  parseChatGptOauthRedirect,
  startChatGptOauthCallbackServer,
  writeChatGptAuthProfile,
} from "@spark/llm/utils/chatgpt-auth";

import { ensureEvalEnvLoaded } from "../utils/paths";

ensureEvalEnvLoaded();

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
  await writeChatGptAuthProfile(profile);
  process.stdout.write("ChatGPT OAuth credentials stored.\n");
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
