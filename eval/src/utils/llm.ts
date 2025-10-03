import { Buffer } from "node:buffer";

import type { Part } from "@google/genai";

export function estimateUploadBytes(parts: readonly Part[]): number {
  return parts.reduce((total, part) => {
    let increment = 0;
    if (typeof part.text === "string") {
      increment += Buffer.byteLength(part.text, "utf8");
    }
    const inlineData = part.inlineData?.data;
    if (inlineData) {
      try {
        increment += Buffer.from(inlineData, "base64").byteLength;
      } catch {
        increment += inlineData.length;
      }
    }
    const fileUri = part.fileData?.fileUri;
    if (fileUri) {
      increment += Buffer.byteLength(fileUri, "utf8");
    }
    return total + increment;
  }, 0);
}

export function sanitisePartForLogging(part: Part): unknown {
  if (!part || typeof part !== "object") {
    return part;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(part)) {
    if (key === "inlineData" && value && typeof value === "object") {
      const inlineRecord = value as Record<string, unknown>;
      const mimeType = inlineRecord.mimeType;
      const displayName = inlineRecord.displayName;
      const rawData = inlineRecord.data;
      let omittedBytes: number | undefined;
      if (typeof rawData === "string") {
        try {
          omittedBytes = Buffer.from(rawData, "base64").byteLength;
        } catch {
          omittedBytes = rawData.length;
        }
      }
      const sanitisedInline: Record<string, unknown> = {
        data:
          omittedBytes !== undefined
            ? `[omitted:${omittedBytes}b]`
            : "[omitted]",
      };
      if (typeof mimeType === "string") {
        sanitisedInline.mimeType = mimeType;
      }
      if (typeof displayName === "string") {
        sanitisedInline.displayName = displayName;
      }
      if (omittedBytes !== undefined) {
        sanitisedInline.omittedBytes = omittedBytes;
      }
      result[key] = sanitisedInline;
      continue;
    }
    result[key] = value as unknown;
  }
  return result;
}
