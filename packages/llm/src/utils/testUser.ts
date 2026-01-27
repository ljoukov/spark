import path from "node:path";
import { z } from "zod";
import { loadEnvFromFile, loadLocalEnv } from "./env";

export type TestUserCredentials = {
  email: string;
  userId: string;
  password: string;
};

const testUserEnvSchema = z.string().trim().min(1);

const testUserCredentialsSchema = z
  .string()
  .trim()
  .min(1)
  .transform((raw, ctx) => {
    const parts = raw.split("/");
    if (parts.length !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "TEST_USER_EMAIL_ID_PASSWORD must be email/userId/password.",
      });
      return z.NEVER;
    }
    const [emailRaw, userIdRaw, passwordRaw] = parts;
    const email = emailRaw?.trim() ?? "";
    const userId = userIdRaw?.trim() ?? "";
    const password = passwordRaw ?? "";

    const emailParsed = z.string().email().safeParse(email);
    if (!emailParsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TEST_USER_EMAIL_ID_PASSWORD has an invalid email.",
      });
      return z.NEVER;
    }
    if (!userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TEST_USER_EMAIL_ID_PASSWORD missing userId.",
      });
      return z.NEVER;
    }
    if (!password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TEST_USER_EMAIL_ID_PASSWORD missing password.",
      });
      return z.NEVER;
    }

    return {
      email: emailParsed.data.toLowerCase(),
      userId,
      password,
    } satisfies TestUserCredentials;
  });

let envLoaded = false;
let resolved = false;
let cachedTestUser: TestUserCredentials | null = null;

function loadTestUserEnv(): void {
  if (envLoaded) {
    return;
  }
  loadLocalEnv();
  if (!process.env.TEST_USER_EMAIL_ID_PASSWORD) {
    let current = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      const candidate = current.endsWith(`${path.sep}web`)
        ? path.join(current, ".env.local")
        : path.join(current, "web", ".env.local");
      loadEnvFromFile(candidate);
      if (process.env.TEST_USER_EMAIL_ID_PASSWORD) {
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  envLoaded = true;
}

function resolveTestUserCredentials(): TestUserCredentials | null {
  if (resolved) {
    return cachedTestUser;
  }
  resolved = true;
  loadTestUserEnv();
  const raw = process.env.TEST_USER_EMAIL_ID_PASSWORD;
  if (!raw || !raw.trim()) {
    cachedTestUser = null;
    return cachedTestUser;
  }
  const parsed = testUserCredentialsSchema.safeParse(testUserEnvSchema.parse(raw));
  if (!parsed.success) {
    console.error("Invalid TEST_USER_EMAIL_ID_PASSWORD", parsed.error.flatten());
    throw new Error("Invalid TEST_USER_EMAIL_ID_PASSWORD");
  }
  cachedTestUser = parsed.data;
  return cachedTestUser;
}

export const testUser = resolveTestUserCredentials();
export const hasTestUser = testUser !== null;
export const testUserEmail = testUser?.email ?? null;
export const testUserId = testUser?.userId ?? null;
export const testUserPassword = testUser?.password ?? null;

export function getTestUserCredentials(): TestUserCredentials {
  const resolvedCreds = resolveTestUserCredentials();
  if (!resolvedCreds) {
    throw new Error("TEST_USER_EMAIL_ID_PASSWORD is not configured");
  }
  return resolvedCreds;
}

export function getTestUserId(): string {
  return getTestUserCredentials().userId;
}
