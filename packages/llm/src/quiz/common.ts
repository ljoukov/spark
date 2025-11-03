import type { QuizFeedback } from "@spark/schemas";

export interface InlineSourceFile {
  readonly displayName: string;
  readonly mimeType: string;
  readonly data: string;
}

export interface SparkQuizSourceFile {
  readonly filename: string;
  readonly mimeType?: string;
  readonly data: Buffer;
}

export function toInlineSourceFiles(
  sources: ReadonlyArray<SparkQuizSourceFile>,
): InlineSourceFile[] {
  if (sources.length === 0) {
    throw new Error("At least one source file is required to generate a quiz");
  }
  return sources.map((source, index) => {
    const mimeType =
      source.mimeType && source.mimeType.trim().length > 0
        ? source.mimeType
        : "application/pdf";
    const filename =
      source.filename && source.filename.trim().length > 0
        ? source.filename.trim()
        : `upload-${index + 1}.pdf`;
    return {
      displayName: filename,
      mimeType,
      data: source.data.toString("base64"),
    };
  });
}

export function normaliseStringList(
  values: readonly string[] | undefined,
): string[] {
  if (!values) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function buildCorrectFeedback(explanation: string): QuizFeedback {
  const trimmed = explanation.trim();
  if (trimmed.length === 0) {
    return { message: "Correct! Keep going.", tone: "success" };
  }
  if (trimmed.length <= 200) {
    return { message: trimmed, tone: "success" };
  }
  return {
    message: `${trimmed.slice(0, 180)}…`,
    tone: "success",
  };
}

export function coerceQuestionId(
  proposedId: string,
  index: number,
  seen: Set<string>,
): string {
  const fallback = `Q${index + 1}`;
  const trimmed = proposedId.trim();
  const baseId = trimmed.length > 0 ? trimmed : fallback;
  if (!seen.has(baseId)) {
    seen.add(baseId);
    return baseId;
  }
  let counter = 2;
  while (seen.has(`${baseId}-${counter}`)) {
    counter += 1;
  }
  const nextId = `${baseId}-${counter}`;
  seen.add(nextId);
  return nextId;
}
