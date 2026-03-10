import { FieldValue } from "@ljoukov/firebase-admin-cloudflare/firestore";

type FirestoreRecord = Record<string, unknown>;

function splitFirestoreFieldPath(path: string): string[] {
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

function buildNestedObjectFromFieldPaths(
  entries: Array<{ path: string; value: unknown }>,
): FirestoreRecord {
  const out: FirestoreRecord = {};

  for (const entry of entries) {
    const segments = splitFirestoreFieldPath(entry.path);
    if (segments.length === 0) {
      continue;
    }

    let cursor: FirestoreRecord = out;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i]!;
      const isLeaf = i === segments.length - 1;
      if (isLeaf) {
        cursor[segment] = entry.value;
        continue;
      }

      const existing = cursor[segment];
      if (
        existing &&
        typeof existing === "object" &&
        !Array.isArray(existing)
      ) {
        cursor = existing as FirestoreRecord;
        continue;
      }

      const next: FirestoreRecord = {};
      cursor[segment] = next;
      cursor = next;
    }
  }

  return out;
}

export function buildFirestoreMergeData(options: {
  updates: Record<string, unknown>;
  deletes?: string[];
}): FirestoreRecord {
  const entries: Array<{ path: string; value: unknown }> = [];

  for (const [path, value] of Object.entries(options.updates)) {
    if (value === undefined) {
      continue;
    }
    entries.push({ path, value });
  }

  for (const path of options.deletes ?? []) {
    entries.push({ path, value: FieldValue.delete() });
  }

  return buildNestedObjectFromFieldPaths(entries);
}
