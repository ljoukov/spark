import { getGoogleAccessToken } from "./googleAccessToken";

const STORAGE_READ_SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";
const STORAGE_WRITE_SCOPE =
  "https://www.googleapis.com/auth/devstorage.read_write";

const DEFAULT_TIMEOUT_MS = 20_000;

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const handle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(handle),
  };
}

function encodeObjectName(value: string): string {
  // GCS expects the full object name encoded as a single path segment.
  return encodeURIComponent(value);
}

export async function downloadStorageObject(options: {
  serviceAccountJson: string;
  bucketName: string;
  objectName: string;
  timeoutMs?: number;
}): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const { accessToken } = await getGoogleAccessToken({
    serviceAccountJson: options.serviceAccountJson,
    scopes: [STORAGE_READ_SCOPE],
  });

  const { signal, cleanup } = createTimeoutSignal(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const url = `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(
      options.bucketName,
    )}/o/${encodeObjectName(options.objectName)}?alt=media`;
    const resp = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        `Storage download failed (${resp.status}): ${text.slice(0, 500)}`,
      );
    }
    const contentType = resp.headers.get("content-type");
    return { bytes: new Uint8Array(await resp.arrayBuffer()), contentType };
  } finally {
    cleanup();
  }
}

export async function uploadStorageObject(options: {
  serviceAccountJson: string;
  bucketName: string;
  objectName: string;
  contentType: string;
  data: Uint8Array;
  onlyIfMissing?: boolean;
  timeoutMs?: number;
}): Promise<void> {
  const { accessToken } = await getGoogleAccessToken({
    serviceAccountJson: options.serviceAccountJson,
    scopes: [STORAGE_WRITE_SCOPE],
  });

  const { signal, cleanup } = createTimeoutSignal(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const url = new URL(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(
        options.bucketName,
      )}/o`,
    );
    url.searchParams.set("uploadType", "media");
    url.searchParams.set("name", options.objectName);
    if (options.onlyIfMissing) {
      // Only create if missing. If it already exists, treat as success for content-addressed keys.
      url.searchParams.set("ifGenerationMatch", "0");
    }

    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": options.contentType,
      },
      body: Uint8Array.from(options.data),
      signal,
    });

    if (resp.status === 412 && options.onlyIfMissing) {
      // Already exists.
      return;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        `Storage upload failed (${resp.status}): ${text.slice(0, 500)}`,
      );
    }
  } finally {
    cleanup();
  }
}
