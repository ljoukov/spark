import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { errorAsString } from "../utils/error";
import {
  listFirestoreDocuments,
  patchFirestoreDocument,
  queryFirestoreDocuments,
  setFirestoreDocument,
} from "../utils/gcp/firestoreRest";
import {
  downloadStorageObject,
  uploadStorageObject,
} from "../utils/gcp/storageRest";
import { normalizeStorageObjectName } from "./workspaceFileStore";

export const SHARED_PDF_KNOWLEDGE_BASE_COLLECTION_PATH =
  "sharedPdfKnowledgeBase";
export const SHARED_PDF_STORAGE_PREFIX = "spark/shared/";

const SHARED_PDF_FETCH_MAX_BYTES = 80 * 1024 * 1024;
const SHARED_PDF_FETCH_TIMEOUT_MS = 25_000;

const optionalTrimmedString = z.string().trim().min(1).optional();

export const SharedPdfKnowledgeBaseEntrySchema = z.object({
  id: z.string().trim().min(1),
  originalUrl: optionalTrimmedString,
  finalUrl: optionalTrimmedString,
  urlKey: optionalTrimmedString,
  finalUrlKey: optionalTrimmedString,
  filename: z.string().trim().min(1),
  descriptionMarkdown: z.string().trim().min(1),
  storagePath: z
    .string()
    .trim()
    .min(1)
    .refine((value) => isAllowedSharedPdfStoragePath(value), {
      message: `Shared PDF storage paths must start with ${SHARED_PDF_STORAGE_PREFIX}.`,
    }),
  contentType: z.string().trim().min(1).default("application/pdf"),
  sizeBytes: z.number().int().min(1),
  sha256: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  lastUsedAt: optionalTrimmedString,
});

export type SharedPdfKnowledgeBaseEntry = z.infer<
  typeof SharedPdfKnowledgeBaseEntrySchema
>;

export type SharedPdfCacheStatus = "hit" | "deduped" | "created";

function documentIdFromPath(documentPath: string): string {
  const parts = documentPath.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? documentPath;
}

function parseEntry(options: {
  documentPath: string;
  data: Record<string, unknown>;
}): SharedPdfKnowledgeBaseEntry | null {
  const parsed = SharedPdfKnowledgeBaseEntrySchema.safeParse({
    ...options.data,
    id:
      typeof options.data.id === "string" && options.data.id.trim().length > 0
        ? options.data.id
        : documentIdFromPath(options.documentPath),
  });
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export function normalizeSharedPdfUrlForKey(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Shared PDF knowledge base supports only http/https URLs (got "${parsed.protocol}").`,
    );
  }
  parsed.hash = "";
  return parsed.toString();
}

export function sharedPdfUrlKey(rawUrl: string): string {
  return createHash("sha256")
    .update(normalizeSharedPdfUrlForKey(rawUrl))
    .digest("hex");
}

export function isAllowedSharedPdfStoragePath(storagePath: string): boolean {
  const objectName = normalizeStorageObjectName(storagePath);
  return (
    objectName.startsWith(SHARED_PDF_STORAGE_PREFIX) &&
    objectName.toLowerCase().endsWith(".pdf")
  );
}

function safeKnowledgeBaseFilename(entry: SharedPdfKnowledgeBaseEntry): string {
  const base = entry.filename
    .replace(/\.pdf$/iu, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  const safeBase = base.length > 0 ? base : "document";
  return `${entry.id}-${safeBase}.md`;
}

function inferFilename(options: {
  url: string;
  contentDisposition?: string | null;
  fallbackId: string;
}): string {
  const disposition = options.contentDisposition ?? "";
  const utf8Match = /filename\*=UTF-8''([^;]+)/iu.exec(disposition);
  if (utf8Match?.[1]) {
    const decoded = decodeURIComponent(utf8Match[1]).trim();
    if (decoded.length > 0) {
      return decoded.toLowerCase().endsWith(".pdf")
        ? decoded
        : `${decoded}.pdf`;
    }
  }
  const quotedMatch = /filename="([^"]+)"/iu.exec(disposition);
  if (quotedMatch?.[1]) {
    const filename = quotedMatch[1].trim();
    if (filename.length > 0) {
      return filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename}.pdf`;
    }
  }
  const unquotedMatch = /filename=([^;]+)/iu.exec(disposition);
  if (unquotedMatch?.[1]) {
    const filename = unquotedMatch[1].trim();
    if (filename.length > 0) {
      return filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename}.pdf`;
    }
  }
  try {
    const parsed = new URL(options.url);
    const lastSegment = decodeURIComponent(
      parsed.pathname.split("/").filter(Boolean).at(-1) ?? "",
    ).trim();
    if (lastSegment.length > 0) {
      return lastSegment.toLowerCase().endsWith(".pdf")
        ? lastSegment
        : `${lastSegment}.pdf`;
    }
  } catch {
    // Fall through to deterministic fallback.
  }
  return `${options.fallbackId}.pdf`;
}

async function readResponseBytesWithLimit(options: {
  response: Response;
  maxBytes: number;
}): Promise<Uint8Array> {
  if (!options.response.ok) {
    const text = await options.response.text().catch(() => "");
    throw new Error(
      `PDF fetch failed (${options.response.status}): ${text.slice(0, 500)}`,
    );
  }

  const contentLength = options.response.headers.get("content-length");
  if (contentLength) {
    const size = Number(contentLength);
    if (Number.isFinite(size) && size > options.maxBytes) {
      throw new Error(
        `PDF fetch exceeded ${options.maxBytes.toString()} bytes before download (${contentLength}).`,
      );
    }
  }

  const reader = options.response.body?.getReader();
  if (!reader) {
    const arrayBuffer = await options.response.arrayBuffer();
    if (arrayBuffer.byteLength > options.maxBytes) {
      throw new Error(
        `PDF fetch exceeded ${options.maxBytes.toString()} bytes.`,
      );
    }
    return new Uint8Array(arrayBuffer);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    total += next.value.byteLength;
    if (total > options.maxBytes) {
      throw new Error(
        `PDF fetch exceeded ${options.maxBytes.toString()} bytes.`,
      );
    }
    chunks.push(next.value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function fetchPdfBytesFromPublicUrl(options: {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<{
  bytes: Buffer;
  finalUrl: string;
  contentType: string;
  filename: string;
}> {
  const normalizedUrl = normalizeSharedPdfUrlForKey(options.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? SHARED_PDF_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(normalizedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const bytes = await readResponseBytesWithLimit({
    response,
    maxBytes: options.maxBytes ?? SHARED_PDF_FETCH_MAX_BYTES,
  });
  const hasPdfHeader =
    Buffer.from(bytes).subarray(0, 5).toString("utf8") === "%PDF-";
  const rawContentType = response.headers.get("content-type");
  const contentType = rawContentType
    ? (rawContentType.split(";")[0]?.trim().toLowerCase() ??
      "application/octet-stream")
    : "application/octet-stream";
  if (!hasPdfHeader) {
    throw new Error(
      `Expected PDF bytes from "${response.url || normalizedUrl}" but received ${contentType}.`,
    );
  }
  const fallbackId = randomUUID();
  return {
    bytes: Buffer.from(bytes),
    finalUrl: normalizeSharedPdfUrlForKey(response.url || normalizedUrl),
    contentType:
      contentType === "application/pdf" ? contentType : "application/pdf",
    filename: inferFilename({
      url: response.url || normalizedUrl,
      contentDisposition: response.headers.get("content-disposition"),
      fallbackId,
    }),
  };
}

async function findFirstEntryByField(options: {
  serviceAccountJson: string;
  fieldPath: "urlKey" | "finalUrlKey" | "sha256";
  value: string;
}): Promise<SharedPdfKnowledgeBaseEntry | null> {
  const docs = await queryFirestoreDocuments({
    serviceAccountJson: options.serviceAccountJson,
    collectionPath: SHARED_PDF_KNOWLEDGE_BASE_COLLECTION_PATH,
    where: {
      fieldPath: options.fieldPath,
      op: "EQUAL",
      value: options.value,
    },
    limit: 1,
  });
  for (const doc of docs) {
    const parsed = parseEntry(doc);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

export async function findSharedPdfKnowledgeBaseByUrl(options: {
  serviceAccountJson: string;
  url: string;
}): Promise<SharedPdfKnowledgeBaseEntry | null> {
  const key = sharedPdfUrlKey(options.url);
  const byOriginal = await findFirstEntryByField({
    serviceAccountJson: options.serviceAccountJson,
    fieldPath: "urlKey",
    value: key,
  });
  if (byOriginal) {
    return byOriginal;
  }
  return await findFirstEntryByField({
    serviceAccountJson: options.serviceAccountJson,
    fieldPath: "finalUrlKey",
    value: key,
  });
}

export async function listSharedPdfKnowledgeBase(options: {
  serviceAccountJson: string;
  limit?: number;
}): Promise<SharedPdfKnowledgeBaseEntry[]> {
  const docs = await listFirestoreDocuments({
    serviceAccountJson: options.serviceAccountJson,
    collectionPath: SHARED_PDF_KNOWLEDGE_BASE_COLLECTION_PATH,
    limit: options.limit ?? 100,
    orderBy: "updatedAt desc",
  });
  const entries: SharedPdfKnowledgeBaseEntry[] = [];
  for (const doc of docs) {
    const parsed = parseEntry(doc);
    if (parsed) {
      entries.push(parsed);
    }
  }
  return entries;
}

async function touchSharedPdfEntry(options: {
  serviceAccountJson: string;
  entry: SharedPdfKnowledgeBaseEntry;
  now: Date;
}): Promise<void> {
  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: `${SHARED_PDF_KNOWLEDGE_BASE_COLLECTION_PATH}/${options.entry.id}`,
    updates: {
      updatedAt: options.now,
      lastUsedAt: options.now,
    },
  });
}

export async function cacheSharedPdfFromUrl(options: {
  serviceAccountJson: string;
  bucketName: string;
  url: string;
  descriptionMarkdown: string;
  filename?: string;
  now?: Date;
}): Promise<{
  status: SharedPdfCacheStatus;
  entry: SharedPdfKnowledgeBaseEntry;
}> {
  const now = options.now ?? new Date();
  const existingByUrl = await findSharedPdfKnowledgeBaseByUrl({
    serviceAccountJson: options.serviceAccountJson,
    url: options.url,
  });
  if (existingByUrl) {
    await touchSharedPdfEntry({
      serviceAccountJson: options.serviceAccountJson,
      entry: existingByUrl,
      now,
    });
    return { status: "hit", entry: existingByUrl };
  }

  const fetched = await fetchPdfBytesFromPublicUrl({ url: options.url });
  const sha256 = createHash("sha256").update(fetched.bytes).digest("hex");
  const existingByHash = await findFirstEntryByField({
    serviceAccountJson: options.serviceAccountJson,
    fieldPath: "sha256",
    value: sha256,
  });
  if (existingByHash) {
    await touchSharedPdfEntry({
      serviceAccountJson: options.serviceAccountJson,
      entry: existingByHash,
      now,
    });
    return { status: "deduped", entry: existingByHash };
  }

  const id = randomUUID();
  const storagePath = `${SHARED_PDF_STORAGE_PREFIX}${id}.pdf`;
  const normalizedOriginalUrl = normalizeSharedPdfUrlForKey(options.url);
  const normalizedFinalUrl = normalizeSharedPdfUrlForKey(fetched.finalUrl);
  const filename =
    typeof options.filename === "string" && options.filename.trim().length > 0
      ? options.filename.trim()
      : fetched.filename;
  const descriptionMarkdown = options.descriptionMarkdown.trim();
  const entry: SharedPdfKnowledgeBaseEntry = {
    id,
    originalUrl: normalizedOriginalUrl,
    finalUrl: normalizedFinalUrl,
    urlKey: sharedPdfUrlKey(normalizedOriginalUrl),
    finalUrlKey: sharedPdfUrlKey(normalizedFinalUrl),
    filename,
    descriptionMarkdown,
    storagePath,
    contentType: "application/pdf",
    sizeBytes: fetched.bytes.byteLength,
    sha256,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastUsedAt: now.toISOString(),
  };

  await uploadStorageObject({
    serviceAccountJson: options.serviceAccountJson,
    bucketName: options.bucketName,
    objectName: storagePath,
    contentType: "application/pdf",
    data: Uint8Array.from(fetched.bytes),
    onlyIfMissing: true,
  });
  await setFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: `${SHARED_PDF_KNOWLEDGE_BASE_COLLECTION_PATH}/${id}`,
    data: entry,
  });
  return { status: "created", entry };
}

function resolveWorkspaceOutputPath(options: {
  rootDir: string;
  outputPath: string;
}): string {
  if (path.isAbsolute(options.outputPath)) {
    throw new Error(`Absolute paths are not allowed: "${options.outputPath}".`);
  }
  const rawParts = options.outputPath.split(/[/\\]+/u);
  if (rawParts.some((part) => part === "..")) {
    throw new Error(
      `Path traversal ("..") is not allowed: "${options.outputPath}".`,
    );
  }
  const resolved = path.resolve(options.rootDir, options.outputPath);
  const relative = path.relative(options.rootDir, resolved);
  if (
    relative.length === 0 ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path "${options.outputPath}" is outside workspace.`);
  }
  return resolved;
}

export async function downloadSharedPdfToWorkspace(options: {
  serviceAccountJson: string;
  bucketName: string;
  rootDir: string;
  storagePath: string;
  outputPath: string;
}): Promise<{
  outputPath: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
}> {
  const objectName = normalizeStorageObjectName(options.storagePath);
  if (!isAllowedSharedPdfStoragePath(objectName)) {
    throw new Error(
      `Refusing to download non-shared PDF path "${options.storagePath}".`,
    );
  }
  const downloaded = await downloadStorageObject({
    serviceAccountJson: options.serviceAccountJson,
    bucketName: options.bucketName,
    objectName,
  });
  const hasPdfHeader =
    Buffer.from(downloaded.bytes).subarray(0, 5).toString("utf8") === "%PDF-";
  if (!hasPdfHeader) {
    throw new Error(
      `Shared storage path "${objectName}" did not contain PDF bytes.`,
    );
  }
  const resolved = resolveWorkspaceOutputPath({
    rootDir: options.rootDir,
    outputPath: options.outputPath,
  });
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, Buffer.from(downloaded.bytes));
  return {
    outputPath: options.outputPath,
    storagePath: objectName,
    contentType: downloaded.contentType ?? "application/pdf",
    sizeBytes: downloaded.bytes.byteLength,
  };
}

function formatKnowledgeBaseEntry(entry: SharedPdfKnowledgeBaseEntry): string {
  const lines = [
    "---",
    `id: ${entry.id}`,
    `storagePath: ${entry.storagePath}`,
    `filename: ${entry.filename}`,
    ...(entry.originalUrl ? [`originalUrl: ${entry.originalUrl}`] : []),
    ...(entry.finalUrl ? [`finalUrl: ${entry.finalUrl}`] : []),
    `sizeBytes: ${entry.sizeBytes.toString()}`,
    `sha256: ${entry.sha256}`,
    `updatedAt: ${entry.updatedAt}`,
    "---",
    "",
    entry.descriptionMarkdown.trim(),
    "",
  ];
  return lines.join("\n");
}

export async function writeSharedPdfKnowledgeBaseEntryFile(options: {
  rootDir: string;
  entry: SharedPdfKnowledgeBaseEntry;
}): Promise<string> {
  const knowledgeBaseDir = path.join(options.rootDir, "knowledge-base");
  await mkdir(knowledgeBaseDir, { recursive: true });
  const filePath = path.posix.join(
    "knowledge-base",
    safeKnowledgeBaseFilename(options.entry),
  );
  await writeFile(
    path.join(options.rootDir, filePath),
    formatKnowledgeBaseEntry(options.entry),
    "utf8",
  );
  return filePath;
}

export async function writeKnowledgeBaseWorkspaceFiles(options: {
  serviceAccountJson: string;
  rootDir: string;
  limit?: number;
}): Promise<{
  entries: SharedPdfKnowledgeBaseEntry[];
  files: string[];
}> {
  const knowledgeBaseDir = path.join(options.rootDir, "knowledge-base");
  await mkdir(knowledgeBaseDir, { recursive: true });
  let entries: SharedPdfKnowledgeBaseEntry[] = [];
  let loadError: string | null = null;
  try {
    entries = await listSharedPdfKnowledgeBase({
      serviceAccountJson: options.serviceAccountJson,
      limit: options.limit ?? 100,
    });
  } catch (error) {
    loadError = errorAsString(error);
  }

  const files: string[] = [];
  for (const entry of entries) {
    files.push(
      await writeSharedPdfKnowledgeBaseEntryFile({
        rootDir: options.rootDir,
        entry,
      }),
    );
  }

  const indexLines = [
    "# Shared PDF Knowledge Base",
    "",
    "This directory is generated from Firestore at agent startup.",
    "Use `kb_search_pdfs` first, then `kb_download_pdf` for a matching `storagePath`. Use `kb_cache_pdf_from_url` only after you have found and classified a new official PDF URL.",
    "",
  ];
  if (loadError) {
    indexLines.push(`Load error: ${loadError}`, "");
  } else if (entries.length === 0) {
    indexLines.push("No shared PDFs are cached yet.", "");
  } else {
    for (const entry of entries) {
      const firstDescriptionLine =
        entry.descriptionMarkdown
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? entry.filename;
      indexLines.push(
        `- ${firstDescriptionLine} (${entry.filename})`,
        `  - id: ${entry.id}`,
        `  - storagePath: ${entry.storagePath}`,
        ...(entry.originalUrl ? [`  - originalUrl: ${entry.originalUrl}`] : []),
        "",
      );
    }
  }
  await writeFile(
    path.join(knowledgeBaseDir, "index.md"),
    indexLines.join("\n"),
    "utf8",
  );
  return { entries, files };
}

export function searchSharedPdfKnowledgeBaseEntries(options: {
  entries: readonly SharedPdfKnowledgeBaseEntry[];
  query?: string;
  limit?: number;
}): SharedPdfKnowledgeBaseEntry[] {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
  const rawQuery = options.query?.trim().toLowerCase() ?? "";
  if (rawQuery.length === 0) {
    return options.entries.slice(0, limit);
  }
  const tokens = rawQuery.split(/\s+/u).filter((token) => token.length > 0);
  const scored = options.entries
    .map((entry) => {
      const haystack = [
        entry.filename,
        entry.descriptionMarkdown,
        entry.originalUrl ?? "",
        entry.finalUrl ?? "",
        entry.storagePath,
      ]
        .join("\n")
        .toLowerCase();
      const score = tokens.reduce(
        (sum, token) => sum + (haystack.includes(token) ? 1 : 0),
        0,
      );
      return { entry, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((result) => result.entry);
}
