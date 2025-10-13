import { ZodError } from "zod";

function hasMessage(e: unknown): e is { message: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string" &&
    (e as { message: string }).message.trim().length > 0
  );
}

export function errorAsString(e: unknown): string {
  if (e === null) {
    return "null";
  }
  if (e === undefined) {
    return "undefined";
  }
  if (typeof e !== "object") {
    return JSON.stringify(e);
  }
  if (e instanceof ZodError) {
    const m: string[] = [];
    for (const i of e.issues) {
      m.push(`${i.message} at //${i.path.join("/")}`);
    }
    return m.join("; ");
  }
  if (hasMessage(e)) {
    return e.message;
  }
  if (e) {
    const constructor =
      e.constructor &&
      typeof e.constructor.name === "string" &&
      e.constructor.name.trim().length > 0
        ? e.constructor.name.trim()
        : undefined;
    const name =
      "name" in e && typeof e.name === "string" && e.name.trim().length > 0
        ? e.name.trim()
        : undefined;
    const stack =
      "stack" in e && typeof e.stack === "string" && e.stack.trim().length > 0
        ? e.stack
        : undefined;
    if (
      constructor !== undefined ||
      name !== undefined ||
      stack !== undefined
    ) {
      return `\
constructor: ${constructor}, name: ${name}, stack: ${stack}`;
    }
  }
  return JSON.stringify(e);
}

export async function responseErrorAsString(resp: Response): Promise<string> {
  if (resp.ok) {
    throw Error(`Expecting failed response URL=${resp.url}`);
  }
  const bodyText = await (async function () {
    try {
      const text = await resp.text();
      try {
        const parsed: unknown = JSON.parse(text);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return text;
      }
    } catch (e) {
      return `failed to load body: ${errorAsString(e)}`;
    }
  })();
  return `fetch(${resp.url}) failed: status=${resp.status} text="${resp.statusText}", body: ${bodyText}`;
}
