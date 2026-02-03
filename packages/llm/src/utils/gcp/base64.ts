const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function hasNodeBuffer(): boolean {
  return typeof (globalThis as unknown as { Buffer?: unknown }).Buffer === "function";
}

function getNodeBuffer(): typeof Buffer | null {
  if (!hasNodeBuffer()) {
    return null;
  }
  return (globalThis as unknown as { Buffer: typeof Buffer }).Buffer;
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
  const trimmed = base64.trim();
  if (trimmed.length === 0) {
    return new Uint8Array();
  }

  const NodeBuffer = getNodeBuffer();
  if (NodeBuffer) {
    return Uint8Array.from(NodeBuffer.from(trimmed, "base64"));
  }

  if (typeof atob !== "function") {
    throw new Error("base64 decoding requires Buffer or atob().");
  }

  const binary = atob(trimmed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  const NodeBuffer = getNodeBuffer();
  if (NodeBuffer) {
    return NodeBuffer.from(bytes).toString("base64");
  }

  // Avoid constructing a huge binary string in memory; encode directly.
  const chunks: string[] = [];
  let chunk = "";
  const flush = (): void => {
    if (chunk.length > 0) {
      chunks.push(chunk);
      chunk = "";
    }
  };

  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk += BASE64_ALPHABET[(triple >> 18) & 63];
    chunk += BASE64_ALPHABET[(triple >> 12) & 63];
    chunk += BASE64_ALPHABET[(triple >> 6) & 63];
    chunk += BASE64_ALPHABET[triple & 63];
    if (chunk.length >= 32_768) {
      flush();
    }
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const triple = bytes[i] << 16;
    chunk += BASE64_ALPHABET[(triple >> 18) & 63];
    chunk += BASE64_ALPHABET[(triple >> 12) & 63];
    chunk += "==";
  } else if (remaining === 2) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8);
    chunk += BASE64_ALPHABET[(triple >> 18) & 63];
    chunk += BASE64_ALPHABET[(triple >> 12) & 63];
    chunk += BASE64_ALPHABET[(triple >> 6) & 63];
    chunk += "=";
  }

  flush();
  return chunks.join("");
}

export function encodeBytesToBase64Url(bytes: Uint8Array): string {
  return encodeBytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

