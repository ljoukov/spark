import { z } from "zod";
import { encodeBytesToBase64 } from "./base64";
import { getGoogleAccessToken } from "./googleAccessToken";
import { getFirebaseAdminFirestore, getFirebaseAdminFirestoreModule } from "../firebaseAdmin";
import { isNodeRuntime } from "../runtime";
import type { DocumentData, Query } from "firebase-admin/firestore";

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { bytesValue: string }
  | { timestampValue: string }
  | { mapValue: { fields: Record<string, FirestoreValue> } }
  | { arrayValue: { values: FirestoreValue[] } };

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
};

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null) {
    return { nullValue: null };
  }
  if (value === undefined) {
    // Firestore doesn't support explicit "undefined" values; callers should omit.
    return { nullValue: null };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (value instanceof Uint8Array) {
    return { bytesValue: encodeBytesToBase64(value) };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value
          .filter((v) => v !== undefined)
          .map((v) => toFirestoreValue(v)),
      },
    };
  }
  if (typeof value === "object" && value !== null) {
    const fields: Record<string, FirestoreValue> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) {
        continue;
      }
      fields[key] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }

  // Avoid default "[object Object]" stringification.
  if (typeof value === "bigint") {
    return { integerValue: value.toString() };
  }
  if (typeof value === "symbol") {
    return { stringValue: value.toString() };
  }
  if (typeof value === "function") {
    return { stringValue: value.toString() };
  }
  if (typeof value === "object") {
    // Should be unreachable because objects were handled earlier, but keep this
    // branch to avoid implicit "[object Object]" stringification.
    return { stringValue: JSON.stringify(value) };
  }
  return { stringValue: String(value as string | number | boolean) };
}

function fromFirestoreValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) {
    return null;
  }
  if ("booleanValue" in value) {
    return value.booleanValue;
  }
  if ("integerValue" in value) {
    const n = Number(value.integerValue);
    return Number.isNaN(n) ? value.integerValue : n;
  }
  if ("doubleValue" in value) {
    return value.doubleValue;
  }
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("bytesValue" in value) {
    return value.bytesValue;
  }
  if ("timestampValue" in value) {
    return value.timestampValue;
  }
  if ("arrayValue" in value) {
    const values = value.arrayValue?.values ?? [];
    return values.map((entry) => fromFirestoreValue(entry));
  }
  if ("mapValue" in value) {
    const out: Record<string, unknown> = {};
    const fields = value.mapValue?.fields ?? {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function documentFieldsFromData(
  data: Record<string, unknown>,
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue;
    }
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

const FirestoreDocumentPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith("/"), {
    message: "Firestore document path must be relative.",
  })
  .refine((value) => value.split("/").filter(Boolean).length % 2 === 0, {
    message: "Firestore document path must have an even number of segments.",
  });

const FirestoreCollectionPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith("/"), {
    message: "Firestore collection path must be relative.",
  })
  .refine((value) => value.split("/").filter(Boolean).length % 2 === 1, {
    message: "Firestore collection path must have an odd number of segments.",
  });

function firestoreDocUrl(projectId: string, documentPath: string): string {
  const normalizedPath = FirestoreDocumentPathSchema.parse(documentPath);
  const encoded = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encoded}`;
}

function firestoreDocName(projectId: string, documentPath: string): string {
  const normalizedPath = FirestoreDocumentPathSchema.parse(documentPath);
  return `projects/${projectId}/databases/(default)/documents/${normalizedPath}`;
}

function decodeDocumentName(docName: string): string {
  const marker = "/documents/";
  const idx = docName.indexOf(marker);
  if (idx < 0) {
    return docName;
  }
  return docName.slice(idx + marker.length);
}

export async function getFirestoreDocument(options: {
  serviceAccountJson: string;
  documentPath: string;
}): Promise<{
  exists: boolean;
  data: Record<string, unknown> | null;
  updateTime?: string;
  createTime?: string;
}> {
  if (isNodeRuntime()) {
    const firestore = await getFirebaseAdminFirestore({
      serviceAccountJson: options.serviceAccountJson,
    });
    const snapshot = await firestore.doc(options.documentPath).get();
    if (!snapshot.exists) {
      return { exists: false, data: null };
    }
    return {
      exists: true,
      data: (snapshot.data() ?? null) as Record<string, unknown> | null,
    };
  }

  const { accessToken, projectId } = await getGoogleAccessToken({
    serviceAccountJson: options.serviceAccountJson,
    scopes: [FIRESTORE_SCOPE],
  });

  const resp = await fetch(firestoreDocUrl(projectId, options.documentPath), {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (resp.status === 404) {
    return { exists: false, data: null };
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Firestore GET failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }

  const doc = (await resp.json()) as FirestoreDocument;
  const fields = doc.fields ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return {
    exists: true,
    data: out,
    updateTime: doc.updateTime,
    createTime: doc.createTime,
  };
}

export async function setFirestoreDocument(options: {
  serviceAccountJson: string;
  documentPath: string;
  data: Record<string, unknown>;
}): Promise<void> {
  if (isNodeRuntime()) {
    const firestore = await getFirebaseAdminFirestore({
      serviceAccountJson: options.serviceAccountJson,
    });
    await firestore.doc(options.documentPath).set(options.data);
    return;
  }

  const { accessToken, projectId } = await getGoogleAccessToken({
    serviceAccountJson: options.serviceAccountJson,
    scopes: [FIRESTORE_SCOPE],
  });

  const fields = documentFieldsFromData(options.data);
  const resp = await fetch(firestoreDocUrl(projectId, options.documentPath), {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Firestore PATCH failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }
}

function splitFieldPath(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) {
    return [];
  }
  const segments: string[] = [];
  let current = "";
  let inBackticks = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "`") {
      inBackticks = !inBackticks;
      continue;
    }
    if (!inBackticks && ch === ".") {
      if (current.length > 0) {
        segments.push(current);
        current = "";
      }
      continue;
    }
    if (ch === "\\" && inBackticks && trimmed[i + 1] === "`") {
      current += "`";
      i += 1;
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

function escapeFieldPathSegment(segment: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(segment)) {
    return segment;
  }
  const escaped = segment.replace(/`/g, "\\`");
  return `\`${escaped}\``;
}

function normalizeFieldPath(path: string): string {
  const segments = splitFieldPath(path);
  if (segments.length === 0) {
    return "";
  }
  return segments.map((segment) => escapeFieldPathSegment(segment)).join(".");
}

function buildNestedObjectFromFieldPaths(
  entries: Array<{ path: string; value: unknown }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    const segments = splitFieldPath(entry.path);
    if (segments.length === 0) {
      continue;
    }
    let cursor: Record<string, unknown> = out;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLeaf = i === segments.length - 1;
      if (isLeaf) {
        cursor[segment] = entry.value;
        continue;
      }
      const existing = cursor[segment];
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        cursor = existing as Record<string, unknown>;
        continue;
      }
      const next: Record<string, unknown> = {};
      cursor[segment] = next;
      cursor = next;
    }
  }
  return out;
}

function dedupeFieldPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const normalized = normalizeFieldPath(path);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export async function patchFirestoreDocument(options: {
  serviceAccountJson: string;
  documentPath: string;
  updates: Record<string, unknown>;
  deletes?: string[];
}): Promise<void> {
  if (isNodeRuntime()) {
    const firestore = await getFirebaseAdminFirestore({
      serviceAccountJson: options.serviceAccountJson,
    });
    const { FieldValue } = await getFirebaseAdminFirestoreModule();

    const updates: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(options.updates)) {
      if (value === undefined) {
        continue;
      }
      const trimmed = path.trim();
      if (!trimmed) {
        continue;
      }
      updates[trimmed] = value;
    }
    for (const path of options.deletes ?? []) {
      const trimmed = path.trim();
      if (!trimmed) {
        continue;
      }
      updates[trimmed] = FieldValue.delete();
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    try {
      await firestore.doc(options.documentPath).update(updates);
    } catch (error) {
      const code = (error as { code?: unknown } | undefined)?.code;
      const message = error instanceof Error ? error.message : String(error);
      const looksNotFound =
        code === 5 ||
        code === "not-found" ||
        message.includes("No document to update") ||
        message.includes("NOT_FOUND");
      if (!looksNotFound) {
        throw error;
      }
      const nested = buildNestedObjectFromFieldPaths(
        Object.entries(updates).map(([path, value]) => ({ path, value })),
      );
      await firestore.doc(options.documentPath).set(nested, { merge: true });
      return;
    }
    return;
  }

  const { accessToken, projectId } = await getGoogleAccessToken({
    serviceAccountJson: options.serviceAccountJson,
    scopes: [FIRESTORE_SCOPE],
  });

  const updateEntries = Object.entries(options.updates)
    .filter(([, value]) => value !== undefined)
    .map(([path, value]) => ({ path, value }));
  const nested = buildNestedObjectFromFieldPaths(updateEntries);
  const fields = documentFieldsFromData(nested);

  const fieldPaths = dedupeFieldPaths([
    ...updateEntries.map((entry) => entry.path),
    ...(options.deletes ?? []),
  ]);

  const url = new URL(firestoreDocUrl(projectId, options.documentPath));
  for (const fieldPath of fieldPaths) {
    url.searchParams.append("updateMask.fieldPaths", fieldPath);
  }

  const resp = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Firestore PATCH failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }
}

export async function listFirestoreDocuments(options: {
  serviceAccountJson: string;
  collectionPath: string;
  limit?: number;
  orderBy?: string;
}): Promise<Array<{ documentPath: string; data: Record<string, unknown> }>> {
  if (isNodeRuntime()) {
    const firestore = await getFirebaseAdminFirestore({
      serviceAccountJson: options.serviceAccountJson,
    });
    let query: Query<DocumentData> = firestore.collection(options.collectionPath);

    if (options.orderBy) {
      const parts = options.orderBy.trim().split(/\s+/u).filter(Boolean);
      const field = parts[0];
      const direction = parts[1]?.toLowerCase() === "desc" ? "desc" : "asc";
      if (field) {
        query = query.orderBy(field, direction);
      }
    }
    if (options.limit !== undefined) {
      query = query.limit(options.limit);
    }

    const snap = await query.get();
    const out: Array<{ documentPath: string; data: Record<string, unknown> }> = [];
    for (const doc of snap.docs) {
      out.push({ documentPath: doc.ref.path, data: doc.data() as Record<string, unknown> });
    }
    return out;
  }

  const { accessToken, projectId } = await getGoogleAccessToken({
    serviceAccountJson: options.serviceAccountJson,
    scopes: [FIRESTORE_SCOPE],
  });

  const normalizedPath = FirestoreCollectionPathSchema.parse(options.collectionPath);
  const encoded = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encoded}`,
  );
  if (options.limit !== undefined) {
    url.searchParams.set("pageSize", String(options.limit));
  }
  if (options.orderBy) {
    url.searchParams.set("orderBy", options.orderBy);
  }

  const resp = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Firestore list failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }

  const json = (await resp.json()) as { documents?: FirestoreDocument[] };
  const docs = json.documents ?? [];
  const out: Array<{ documentPath: string; data: Record<string, unknown> }> = [];
  for (const doc of docs) {
    const fields = doc.fields ?? {};
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      data[k] = fromFirestoreValue(v);
    }
    out.push({ documentPath: decodeDocumentName(doc.name), data });
  }
  return out;
}

type CommitWrite =
  | {
      type: "patch";
      documentPath: string;
      updates: Record<string, unknown>;
      deletes?: string[];
      precondition?: { exists?: boolean };
    }
  | {
      type: "set";
      documentPath: string;
      data: Record<string, unknown>;
      precondition?: { exists?: boolean };
    };

export async function commitFirestoreWrites(options: {
  serviceAccountJson: string;
  writes: CommitWrite[];
}): Promise<void> {
  if (isNodeRuntime()) {
    const firestore = await getFirebaseAdminFirestore({
      serviceAccountJson: options.serviceAccountJson,
    });
    const { FieldValue } = await getFirebaseAdminFirestoreModule();

    const batch = firestore.batch();

    for (const write of options.writes) {
      const docRef = firestore.doc(write.documentPath);

      if (write.type === "set") {
        if (write.precondition?.exists === false) {
          batch.create(docRef, write.data);
          continue;
        }

        if (write.precondition?.exists === true) {
          // Firestore doesn't expose an "exists: true" precondition for set().
          // update() fails if missing, so approximate by updating all provided fields.
          batch.update(docRef, write.data);
          continue;
        }

        batch.set(docRef, write.data);
        continue;
      }

      const updates: Record<string, unknown> = {};
      for (const [path, value] of Object.entries(write.updates)) {
        if (value === undefined) {
          continue;
        }
        const trimmed = path.trim();
        if (!trimmed) {
          continue;
        }
        updates[trimmed] = value;
      }
      for (const path of write.deletes ?? []) {
        const trimmed = path.trim();
        if (!trimmed) {
          continue;
        }
        updates[trimmed] = FieldValue.delete();
      }

      if (Object.keys(updates).length === 0) {
        continue;
      }

      batch.update(docRef, updates);
    }

    await batch.commit();
    return;
  }

  const { accessToken, projectId } = await getGoogleAccessToken({
    serviceAccountJson: options.serviceAccountJson,
    scopes: [FIRESTORE_SCOPE],
  });

  const writes = options.writes.map((write) => {
    if (write.type === "set") {
      const fields = documentFieldsFromData(write.data);
      const out: Record<string, unknown> = {
        update: {
          name: firestoreDocName(projectId, write.documentPath),
          fields,
        },
      };
      if (write.precondition?.exists !== undefined) {
        out.currentDocument = { exists: write.precondition.exists };
      }
      return out;
    }

    const updateEntries = Object.entries(write.updates)
      .filter(([, value]) => value !== undefined)
      .map(([path, value]) => ({ path, value }));
    const nested = buildNestedObjectFromFieldPaths(updateEntries);
    const fields = documentFieldsFromData(nested);
    const fieldPaths = dedupeFieldPaths([
      ...updateEntries.map((entry) => entry.path),
      ...(write.deletes ?? []),
    ]);

    const out: Record<string, unknown> = {
      update: {
        name: firestoreDocName(projectId, write.documentPath),
        fields,
      },
      updateMask: {
        fieldPaths,
      },
    };
    if (write.precondition?.exists !== undefined) {
      out.currentDocument = { exists: write.precondition.exists };
    }
    return out;
  });

  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ writes }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Firestore commit failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }
}

export async function deleteFirestoreDocument(options: {
  serviceAccountJson: string;
  documentPath: string;
}): Promise<void> {
  if (isNodeRuntime()) {
    const firestore = await getFirebaseAdminFirestore({
      serviceAccountJson: options.serviceAccountJson,
    });
    await firestore.doc(options.documentPath).delete();
    return;
  }

  const { accessToken, projectId } = await getGoogleAccessToken({
    serviceAccountJson: options.serviceAccountJson,
    scopes: [FIRESTORE_SCOPE],
  });

  const resp = await fetch(firestoreDocUrl(projectId, options.documentPath), {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (resp.status === 404) {
    return;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Firestore DELETE failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }
}
