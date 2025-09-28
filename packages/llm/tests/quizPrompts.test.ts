import { describe, expect, it } from "vitest";

import {
  BASE_PROMPT_HEADER,
  buildExtensionPrompt,
  buildGenerationPrompt,
  buildSourceParts,
  normaliseQuizPayload,
} from "../src/quizPrompts";
import { QuizGenerationSchema } from "../src/schemas";

const INLINE_SAMPLE = {
  displayName: "sample.pdf",
  mimeType: "application/pdf",
  data: Buffer.from("content").toString("base64"),
};

describe("quizPrompts helpers", () => {
  it("normalises question payloads for schema validation", () => {
    const original = {
      mode: "synthesis",
      subject: "physics",
      questionCount: 0,
      quizTitle: "GCSE Physics",
      questions: [
        {
          id: "q1",
          type: "multiple_choice",
          prompt: "Pick an option",
          options: ["Option A", "Option B"],
          answer: "A",
          explanation: "Because A is correct.",
          hint: "Recall the definition.",
        },
        {
          id: "q2",
          type: "short_answer",
          prompt: "Name the particle.",
          answer: ["electron"],
          explanation: "It is an electron.",
          hint: "Think charge.",
          options: ["Should be removed"],
        },
      ],
    };

    const result = normaliseQuizPayload(structuredClone(original));
    const normalised = QuizGenerationSchema.parse(result);

    expect(normalised.questionCount).toBe(2);
    const [first, second] = normalised.questions;
    expect(first.answer).toEqual(["A"]);
    expect(second.options).toBeUndefined();

    expect(() => QuizGenerationSchema.parse(normalised)).not.toThrow();
  });

  it("rejects mismatched question counts via schema", () => {
    const invalid = {
      mode: "extraction",
      subject: "chemistry",
      questionCount: 2,
      quizTitle: "Chemistry Review",
      questions: [
        {
          id: "q1",
          type: "true_false",
          prompt: "Statement",
          answer: ["True"],
          explanation: "It is true.",
          hint: "Recall the rule.",
        },
      ],
    };

    expect(() => QuizGenerationSchema.parse(invalid as never)).toThrow(
      /questionCount/iu,
    );
  });

  it("builds inline source parts for Gemini uploads", () => {
    const parts = buildSourceParts([INLINE_SAMPLE]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({
      inlineData: {
        data: INLINE_SAMPLE.data,
        mimeType: INLINE_SAMPLE.mimeType,
      },
    });
  });

  it("produces generation prompt boilerplate with requested count", () => {
    const prompt = buildGenerationPrompt({
      questionCount: 3,
      sourceFiles: [INLINE_SAMPLE],
      subject: "biology",
    });

    expect(prompt).toContain(BASE_PROMPT_HEADER);
    expect(prompt).toContain("You must return exactly 3 questions.");
    expect(prompt).toContain("Write in UK English");
  });

  it("creates extension prompt with explicit new question count", () => {
    const prompt = buildExtensionPrompt({
      additionalQuestionCount: 4,
      subject: "maths",
      board: "AQA",
    });

    expect(prompt).toContain("Produce exactly 4 new questions.");
    expect(prompt).toContain("Exam board context (for context): AQA");
  });
});
