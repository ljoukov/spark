import { afterEach, describe, expect, it, vi } from "vitest";

function clearChatGptEnv(): void {
  delete process.env.CHATGPT_AUTH_JSON_B64;
  delete process.env.CHATGPT_AUTH_JSON;
  delete process.env.CHATGPT_ACCESS;
  delete process.env.CHATGPT_REFRESH;
  delete process.env.CHATGPT_EXPIRES;
  delete process.env.CHATGPT_ACCOUNT_ID;
  delete process.env.CHATGPT_ID_TOKEN;
  delete process.env.CHATGPT_ACCESS_TOKEN;
  delete process.env.CHATGPT_REFRESH_TOKEN;
  delete process.env.CHATGPT_EXPIRES_AT;
}

afterEach(() => {
  clearChatGptEnv();
  vi.resetModules();
});

describe("ChatGPT auth", () => {
  it("loads credentials from CHATGPT_AUTH_JSON_B64", async () => {
    const payload = {
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
      accountId: "acct_test",
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    process.env.CHATGPT_AUTH_JSON_B64 = encoded;

    const { getChatGptAuthProfile } = await import("../src/utils/chatgpt-auth");
    const profile = await getChatGptAuthProfile();
    expect(profile).toMatchObject({
      access: payload.access,
      refresh: payload.refresh,
      accountId: payload.accountId,
    });
    expect(profile.expires).toBe(payload.expires);
  });

  it("loads credentials from CHATGPT_AUTH_JSON", async () => {
    const payload = {
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
      accountId: "acct_test",
    };
    process.env.CHATGPT_AUTH_JSON = JSON.stringify(payload);

    const { getChatGptAuthProfile } = await import("../src/utils/chatgpt-auth");
    const profile = await getChatGptAuthProfile();
    expect(profile).toMatchObject({
      access: payload.access,
      refresh: payload.refresh,
      accountId: payload.accountId,
    });
    expect(profile.expires).toBe(payload.expires);
  });

  it("throws a helpful error when credentials are missing", async () => {
    const { getChatGptAuthProfile } = await import("../src/utils/chatgpt-auth");
    await expect(getChatGptAuthProfile()).rejects.toThrow(
      "CHATGPT_AUTH_JSON_B64",
    );
  });
});
