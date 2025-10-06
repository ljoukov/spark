import { z } from "zod";
import { loadLocalEnv } from "./env";

const testUserIdRegex = /^(test-(admin|free|paid)-[A-Za-z0-9]{16})$/;

const testUserSchema = z.union([
  z.undefined(),
  z.string().regex(testUserIdRegex),
]);

function shouldUseTestUser(): boolean {
  const raw = process.env.FORCE_TEST_USER;
  if (raw === undefined) {
    return false;
  }
  return raw.toLowerCase() !== "false";
}

let resolved = false;
let cachedTestUserId: string | undefined;

function resolveTestUserId(): string | undefined {
  if (resolved) {
    return cachedTestUserId;
  }

  resolved = true;
  loadLocalEnv();

  if (!shouldUseTestUser()) {
    cachedTestUserId = undefined;
    return cachedTestUserId;
  }

  const id = testUserSchema.parse(process.env.TEST_USER);
  if (id !== undefined) {
    console.log("testUserId: running as test user");
  }
  cachedTestUserId = id;
  return cachedTestUserId;
}

export function isTestUser(): boolean {
  return resolveTestUserId() !== undefined;
}

export function isTestUserAdmin(): boolean {
  const id = resolveTestUserId();
  return id !== undefined && id.startsWith("test-admin-");
}

export function getTestUserId(): string {
  const id = resolveTestUserId();
  if (id === undefined) {
    console.error("No test user ID set");
    throw new Error("No test user ID set");
  }
  return id;
}
