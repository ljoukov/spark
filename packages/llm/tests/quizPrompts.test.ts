import { describe, expect, it } from "vitest";

import {
  BASE_PROMPT_HEADER,
  buildExtensionPrompt,
  buildGenerationPrompt,
  buildSourceParts,
  normaliseQuizPayload,
} from "../src/quiz/prompts";
import { QuizGenerationSchema } from "../src/quiz/schemas";

const INLINE_SAMPLE = {
  displayName: "sample.pdf",
  mimeType: "application/pdf",
  data: Buffer.from("content").toString("base64"),
};

describe("quiz prompts helpers", () => {
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
    expect(first.review).toEqual({
      status: "approved",
      notes: "Self-check passed.",
    });
    expect(second.review).toEqual({
      status: "approved",
      notes: "Self-check passed.",
    });

    expect(() => QuizGenerationSchema.parse(normalised)).not.toThrow();
  });

  it("drops unapproved items and trims to the requested count", () => {
    const payload = {
      mode: "synthesis",
      subject: "mathematics",
      questionCount: 5,
      quizTitle: "Maths Check",
      questions: [
        {
          id: "q1",
          type: "short_answer",
          prompt: "State the gradient.",
          answer: ["2"],
          explanation: "Gradient is 2.",
          hint: "Differentiate.",
          review: { status: "approved", notes: "All checks pass." },
        },
        {
          id: "q2",
          type: "short_answer",
          prompt: "Name the shape.",
          answer: ["triangle"],
          explanation: "It is a triangle.",
          hint: "Count the sides.",
          review: { status: "unapproved", notes: "Scope mismatch." },
        },
        {
          id: "q3",
          type: "short_answer",
          prompt: "State the value of pi.",
          answer: ["3.14"],
          explanation: "Pi is approximately 3.14.",
          hint: "Circle ratio.",
          review: { status: "approved", notes: "All checks pass." },
        },
        {
          id: "q4",
          type: "short_answer",
          prompt: "Give one factor of 12.",
          answer: ["3"],
          explanation: "3 × 4 = 12.",
          hint: "Think multiples.",
          review: { status: "approved", notes: "All checks pass." },
        },
        {
          id: "q5",
          type: "short_answer",
          prompt: "Solve x + 1 = 2.",
          answer: ["1"],
          explanation: "Subtract 1 from both sides.",
          hint: "Inverse operations.",
          review: { status: "approved", notes: "All checks pass." },
        },
      ],
    };

    const result = normaliseQuizPayload(structuredClone(payload), 3);
    const normalised = QuizGenerationSchema.parse(result);

    expect(normalised.questionCount).toBe(3);
    expect(normalised.questions).toHaveLength(3);
    for (const question of normalised.questions) {
      expect(question.review?.status).toBe("approved");
    }
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
    expect(prompt).toContain("draft 5 candidates (target 3 + 2)");
    expect(prompt).toContain('review.status ("approved" or "unapproved")');
    expect(prompt).toContain("Write in UK English");
  });

  it("creates extension prompt with explicit new question count", () => {
    const prompt = buildExtensionPrompt({
      additionalQuestionCount: 4,
      subject: "maths",
      board: "AQA",
    });

    expect(prompt).toContain("Draft 6 candidates");
    expect(prompt).toContain('review.status ("approved" or "unapproved")');
    expect(prompt).toContain("Exam board context (for context): AQA");
  });
});
