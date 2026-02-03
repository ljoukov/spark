import { parseGoogleServiceAccountJson } from "@spark/llm/utils/gcp/googleAccessToken";

export function requireServiceAccountJson(): string {
  const value = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!value || value.trim().length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  }
  return value;
}

export function resolveFirebaseStorageBucketName(serviceAccountJson: string): string {
  const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
  return `${serviceAccount.projectId}.firebasestorage.app`;
}

