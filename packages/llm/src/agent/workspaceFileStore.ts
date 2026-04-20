import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type SparkAgentWorkspaceFile,
} from "@spark/schemas";

import { patchFirestoreDocument } from "../utils/gcp/firestoreRest";
import { uploadStorageObject } from "../utils/gcp/storageRest";

export function encodeWorkspaceFileId(filePath: string): string {
  return encodeURIComponent(filePath);
}

export function decodeWorkspaceFileId(fileId: string): string {
  try {
    return decodeURIComponent(fileId);
  } catch {
    return fileId;
  }
}

export function docIdFromFirestoreDocumentPath(documentPath: string): string {
  const parts = documentPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? documentPath;
}

export function resolveWorkspaceFilePathFromFirestoreDocument(options: {
  documentPath: string;
  storedPath: unknown;
}): string {
  if (typeof options.storedPath === "string") {
    const trimmed = options.storedPath.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return decodeWorkspaceFileId(
    docIdFromFirestoreDocumentPath(options.documentPath),
  );
}

export function buildWorkspaceFilesCollectionPath(options: {
  userId: string;
  workspaceId: string;
}): string {
  return `users/${options.userId}/workspace/${options.workspaceId}/files`;
}

export function buildWorkspaceFileDocPath(options: {
  userId: string;
  workspaceId: string;
  filePath: string;
}): string {
  return `${buildWorkspaceFilesCollectionPath({
    userId: options.userId,
    workspaceId: options.workspaceId,
  })}/${encodeWorkspaceFileId(options.filePath)}`;
}

export function resolveWorkspacePathContentType(
  filePath: string,
): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") {
    return "text/markdown";
  }
  if (ext === ".json") {
    return "application/json";
  }
  if (ext === ".txt") {
    return "text/plain";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".pdf") {
    return "application/pdf";
  }
  return undefined;
}

export function isBinaryWorkspaceContentType(
  contentType: string | undefined,
): boolean {
  if (typeof contentType !== "string" || contentType.trim().length === 0) {
    return false;
  }
  const normalized = contentType.trim().toLowerCase();
  if (normalized.startsWith("image/")) {
    return true;
  }
  if (normalized === "application/pdf") {
    return true;
  }
  return false;
}

function normalizeContentType(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeStorageObjectName(storagePath: string): string {
  return storagePath.replace(/^\/+/u, "");
}

export function isAllowedWorkspaceStoragePath(
  userId: string,
  objectName: string,
): boolean {
  if (objectName.startsWith(`spark/uploads/${userId}/`)) {
    return true;
  }
  if (objectName.startsWith(`spark/${userId}/`)) {
    return true;
  }
  return false;
}

export function resolveStorageLinkFromWorkspaceFile(
  file: SparkAgentWorkspaceFile,
): { storagePath: string; contentType: string } | null {
  if (file.type !== "storage_link") {
    return null;
  }
  return {
    storagePath: file.storagePath,
    contentType: file.contentType,
  };
}

export async function upsertWorkspaceTextFileDoc(options: {
  serviceAccountJson: string;
  userId: string;
  workspaceId: string;
  filePath: string;
  content: string;
  contentType?: string;
  createdAt: Date;
  updatedAt: Date;
}): Promise<void> {
  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: buildWorkspaceFileDocPath({
      userId: options.userId,
      workspaceId: options.workspaceId,
      filePath: options.filePath,
    }),
    updates: {
      path: options.filePath,
      content: options.content,
      ...(options.contentType ? { contentType: options.contentType } : {}),
      sizeBytes: Buffer.byteLength(options.content, "utf8"),
      createdAt: options.createdAt,
      updatedAt: options.updatedAt,
    },
    deletes: ["type", "storagePath", "id", "filename", "pageCount"],
  });
}

export async function upsertWorkspaceStorageLinkFileDoc(options: {
  serviceAccountJson: string;
  userId: string;
  workspaceId: string;
  filePath: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}): Promise<void> {
  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: buildWorkspaceFileDocPath({
      userId: options.userId,
      workspaceId: options.workspaceId,
      filePath: options.filePath,
    }),
    updates: {
      path: options.filePath,
      type: "storage_link",
      storagePath: options.storagePath,
      contentType: normalizeContentType(options.contentType),
      sizeBytes: options.sizeBytes,
      createdAt: options.createdAt,
      updatedAt: options.updatedAt,
    },
    deletes: ["content", "id", "filename", "pageCount"],
  });
}

export async function persistWorkspaceFileFromLocalFs(options: {
  serviceAccountJson: string;
  userId: string;
  workspaceId: string;
  filePath: string;
  absoluteFilePath: string;
  bucketName: string;
  createdAt: Date;
  updatedAt: Date;
}): Promise<{ sizeBytes: number; contentType?: string; storagePath?: string }> {
  const contentType = resolveWorkspacePathContentType(options.filePath);
  if (isBinaryWorkspaceContentType(contentType)) {
    const bytes = await readFile(options.absoluteFilePath);
    const normalizedContentType =
      typeof contentType === "string" && contentType.trim().length > 0
        ? normalizeContentType(contentType)
        : "application/octet-stream";
    const linkId = createHash("md5").update(bytes).digest("hex");
    const storagePath = `spark/uploads/${options.userId}/${linkId}`;
    await uploadStorageObject({
      serviceAccountJson: options.serviceAccountJson,
      bucketName: options.bucketName,
      objectName: storagePath,
      contentType: normalizedContentType,
      data: Uint8Array.from(bytes),
      onlyIfMissing: true,
    });
    await upsertWorkspaceStorageLinkFileDoc({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId: options.workspaceId,
      filePath: options.filePath,
      storagePath,
      contentType: normalizedContentType,
      sizeBytes: bytes.byteLength,
      createdAt: options.createdAt,
      updatedAt: options.updatedAt,
    });
    return {
      sizeBytes: bytes.byteLength,
      contentType: normalizedContentType,
      storagePath,
    };
  }

  const content = await readFile(options.absoluteFilePath, { encoding: "utf8" });
  await upsertWorkspaceTextFileDoc({
    serviceAccountJson: options.serviceAccountJson,
    userId: options.userId,
    workspaceId: options.workspaceId,
    filePath: options.filePath,
    content,
    ...(contentType ? { contentType } : {}),
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
  });
  return {
    sizeBytes: Buffer.byteLength(content, "utf8"),
    ...(contentType ? { contentType } : {}),
  };
}
