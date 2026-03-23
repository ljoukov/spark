import { z } from "zod";

const trimmedString = z.string().trim().min(1);

export const PaperSheetHookSectionSchema = z.object({
  type: z.literal("hook"),
  text: trimmedString,
});

export type PaperSheetHookSection = z.infer<
  typeof PaperSheetHookSectionSchema
>;

export const PaperSheetInfoBoxSchema = z.object({
  icon: trimmedString,
  title: trimmedString,
  text: trimmedString,
});

export type PaperSheetInfoBox = z.infer<typeof PaperSheetInfoBoxSchema>;

export const PaperSheetBlankSchema = z.object({
  placeholder: z.string().optional(),
  minWidth: z.number().int().min(1).optional(),
});

export type PaperSheetBlank = z.infer<typeof PaperSheetBlankSchema>;

export const PaperSheetFillQuestionSchema = z.object({
  id: trimmedString,
  type: z.literal("fill"),
  marks: z.number().min(0),
  prompt: trimmedString,
  blanks: z.union([
    z.tuple([PaperSheetBlankSchema]),
    z.tuple([PaperSheetBlankSchema, PaperSheetBlankSchema]),
  ]),
  after: z.string(),
  conjunction: z.string().optional(),
});

export type PaperSheetFillQuestion = z.infer<
  typeof PaperSheetFillQuestionSchema
>;

export const PaperSheetMcqQuestionSchema = z.object({
  id: trimmedString,
  type: z.literal("mcq"),
  marks: z.number().min(0),
  prompt: trimmedString,
  options: z.array(trimmedString).min(2),
});

export type PaperSheetMcqQuestion = z.infer<typeof PaperSheetMcqQuestionSchema>;

export const PaperSheetLinesQuestionSchema = z.object({
  id: trimmedString,
  type: z.literal("lines"),
  marks: z.number().min(0),
  prompt: trimmedString,
  lines: z.number().int().min(1),
  renderMode: z.enum(["plain", "markdown"]).optional(),
});

export type PaperSheetLinesQuestion = z.infer<
  typeof PaperSheetLinesQuestionSchema
>;

export const PaperSheetCalcQuestionSchema = z.object({
  id: trimmedString,
  type: z.literal("calc"),
  marks: z.number().min(0),
  prompt: trimmedString,
  hint: z.string().optional(),
  inputLabel: trimmedString,
  unit: trimmedString,
});

export type PaperSheetCalcQuestion = z.infer<typeof PaperSheetCalcQuestionSchema>;

export const PaperSheetMatchQuestionSchema = z.object({
  id: trimmedString,
  type: z.literal("match"),
  marks: z.number().min(0),
  prompt: trimmedString,
  pairs: z
    .array(
      z.object({
        term: trimmedString,
        match: trimmedString,
      }),
    )
    .min(1),
});

export type PaperSheetMatchQuestion = z.infer<
  typeof PaperSheetMatchQuestionSchema
>;

export const PaperSheetSpellingQuestionSchema = z.object({
  id: trimmedString,
  type: z.literal("spelling"),
  marks: z.number().min(0),
  prompt: trimmedString,
  words: z
    .array(
      z.object({
        wrong: trimmedString,
      }),
    )
    .min(1),
});

export type PaperSheetSpellingQuestion = z.infer<
  typeof PaperSheetSpellingQuestionSchema
>;

export const PaperSheetQuestionSchema = z.discriminatedUnion("type", [
  PaperSheetFillQuestionSchema,
  PaperSheetMcqQuestionSchema,
  PaperSheetLinesQuestionSchema,
  PaperSheetCalcQuestionSchema,
  PaperSheetMatchQuestionSchema,
  PaperSheetSpellingQuestionSchema,
]);

export type PaperSheetQuestion = z.infer<typeof PaperSheetQuestionSchema>;

export const PaperSheetContentSectionSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  theory: z.string().optional(),
  infoBox: PaperSheetInfoBoxSchema.optional(),
  questions: z.array(PaperSheetQuestionSchema).optional(),
});

export type PaperSheetContentSection = z.infer<
  typeof PaperSheetContentSectionSchema
>;

export const PaperSheetSectionSchema = z.union([
  PaperSheetHookSectionSchema,
  PaperSheetContentSectionSchema,
]);

export type PaperSheetSection = z.infer<typeof PaperSheetSectionSchema>;

export const PaperSheetDataSchema = z
  .object({
    id: trimmedString,
    subject: trimmedString,
    level: trimmedString,
    title: trimmedString,
    subtitle: trimmedString,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    light: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    border: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    sections: z.array(PaperSheetSectionSchema).min(1),
  })
  .superRefine((sheet, ctx) => {
    const sectionIds = new Set<string>();
    const questionIds = new Set<string>();

    for (let sectionIndex = 0; sectionIndex < sheet.sections.length; sectionIndex += 1) {
      const section = sheet.sections[sectionIndex];
      if (!("id" in section)) {
        continue;
      }

      if (sectionIds.has(section.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", sectionIndex, "id"],
          message: `Duplicate worksheet section id "${section.id}".`,
        });
      } else {
        sectionIds.add(section.id);
      }

      for (
        let questionIndex = 0;
        questionIndex < (section.questions?.length ?? 0);
        questionIndex += 1
      ) {
        const question = section.questions?.[questionIndex];
        if (!question) {
          continue;
        }
        if (questionIds.has(question.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sections", sectionIndex, "questions", questionIndex, "id"],
            message: `Duplicate worksheet question id "${question.id}".`,
          });
          continue;
        }
        questionIds.add(question.id);
      }
    }
  });

export type PaperSheetData = z.infer<typeof PaperSheetDataSchema>;

export const PaperSheetAnswersSchema = z.record(
  trimmedString,
  z.union([z.string(), z.record(trimmedString, z.string())]),
);

export type PaperSheetAnswers = z.infer<typeof PaperSheetAnswersSchema>;

export const PaperSheetScoreSchema = z.object({
  got: z.number().min(0),
  total: z.number().min(0),
});

export type PaperSheetScore = z.infer<typeof PaperSheetScoreSchema>;

export const PaperSheetQuestionReviewStatusSchema = z.enum([
  "correct",
  "incorrect",
  "teacher-review",
]);

export type PaperSheetQuestionReviewStatus = z.infer<
  typeof PaperSheetQuestionReviewStatusSchema
>;

export const PaperSheetQuestionReviewSchema = z.object({
  status: PaperSheetQuestionReviewStatusSchema,
  label: trimmedString.optional(),
  statusLabel: trimmedString.optional(),
  note: trimmedString,
  replyPlaceholder: trimmedString.optional(),
  followUp: trimmedString.optional(),
});

export type PaperSheetQuestionReview = z.infer<
  typeof PaperSheetQuestionReviewSchema
>;

export const PaperSheetReviewSchema = z.object({
  score: PaperSheetScoreSchema,
  objectiveQuestionCount: z.number().int().min(0).optional(),
  teacherReviewMarks: z.number().min(0).optional(),
  teacherReviewQuestionCount: z.number().int().min(0).optional(),
  label: trimmedString,
  message: trimmedString,
  note: trimmedString,
  questions: z.record(trimmedString, PaperSheetQuestionReviewSchema),
});

export type PaperSheetReview = z.infer<typeof PaperSheetReviewSchema>;

export const PaperSheetFeedbackAttachmentSchema = z.object({
  id: trimmedString,
  filename: trimmedString,
  contentType: trimmedString,
  sizeBytes: z.number().int().min(1),
  filePath: trimmedString.optional(),
  url: trimmedString.optional(),
});

export type PaperSheetFeedbackAttachment = z.infer<
  typeof PaperSheetFeedbackAttachmentSchema
>;

export const PaperSheetFeedbackTurnSchema = z
  .object({
    id: trimmedString,
    speaker: z.enum(["student", "tutor"]),
    text: z.string().trim(),
    attachments: z.array(PaperSheetFeedbackAttachmentSchema).optional(),
  })
  .superRefine((turn, ctx) => {
    if (turn.text.length > 0) {
      return;
    }
    if ((turn.attachments?.length ?? 0) > 0) {
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["text"],
      message: "Feedback turns need text or at least one attachment.",
    });
  });

export type PaperSheetFeedbackTurn = z.infer<
  typeof PaperSheetFeedbackTurnSchema
>;

export const PaperSheetFeedbackThreadSchema = z.object({
  status: z.enum(["open", "responding", "resolved"]),
  turns: z.array(PaperSheetFeedbackTurnSchema),
});

export type PaperSheetFeedbackThread = z.infer<
  typeof PaperSheetFeedbackThreadSchema
>;

export const SparkGraderWorksheetReferencesSchema = z.object({
  problemMarkdown: z.string().optional(),
  officialProblemMarkdown: z.string().optional(),
  officialSolutionMarkdown: z.string().optional(),
  studentTranscriptMarkdown: z.string().optional(),
  gradingMarkdown: z.string().optional(),
  overallFeedbackMarkdown: z.string().optional(),
  paperUrl: trimmedString.optional(),
  markSchemeUrl: trimmedString.optional(),
});

export type SparkGraderWorksheetReferences = z.infer<
  typeof SparkGraderWorksheetReferencesSchema
>;

function collectSheetQuestions(
  sheet: PaperSheetData,
): Map<string, PaperSheetQuestion> {
  const questions = new Map<string, PaperSheetQuestion>();
  for (const section of sheet.sections) {
    if (!("id" in section)) {
      continue;
    }
    for (const question of section.questions ?? []) {
      questions.set(question.id, question);
    }
  }
  return questions;
}

export const SparkGraderWorksheetReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    sheet: PaperSheetDataSchema,
    answers: PaperSheetAnswersSchema,
    review: PaperSheetReviewSchema,
    references: SparkGraderWorksheetReferencesSchema.optional(),
  })
  .superRefine((report, ctx) => {
    const questions = collectSheetQuestions(report.sheet);
    const questionIds = [...questions.keys()];
    const totalMarks = [...questions.values()].reduce(
      (sum, question) => sum + question.marks,
      0,
    );

    if (report.review.score.total !== totalMarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["review", "score", "total"],
        message: `Worksheet review total must equal total sheet marks (${totalMarks.toString()}).`,
      });
    }

    for (const questionId of questionIds) {
      if (!(questionId in report.review.questions)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["review", "questions"],
          message: `Missing review entry for question "${questionId}".`,
        });
      }
      if (!(questionId in report.answers)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answers"],
          message: `Missing student answer entry for question "${questionId}".`,
        });
      }
    }

    for (const key of Object.keys(report.review.questions)) {
      if (!questions.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["review", "questions", key],
          message: `Review entry "${key}" does not match any worksheet question.`,
        });
      }
    }

    for (const [key, answer] of Object.entries(report.answers)) {
      const question = questions.get(key);
      if (!question) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answers", key],
          message: `Answer entry "${key}" does not match any worksheet question.`,
        });
        continue;
      }

      if (
        question.type === "mcq" ||
        question.type === "lines" ||
        question.type === "calc"
      ) {
        if (typeof answer !== "string") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["answers", key],
            message: `Question "${key}" expects a string answer.`,
          });
        }
        continue;
      }

      if (typeof answer === "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answers", key],
          message: `Question "${key}" expects an object answer.`,
        });
        continue;
      }

      if (question.type === "fill") {
        const expectedKeys = question.blanks.map((_, index) => index.toString());
        for (const expectedKey of expectedKeys) {
          if (!(expectedKey in answer)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["answers", key],
              message: `Fill question "${key}" is missing blank "${expectedKey}".`,
            });
          }
        }
        continue;
      }

      if (question.type === "match") {
        for (const pair of question.pairs) {
          if (!(pair.term in answer)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["answers", key],
              message: `Match question "${key}" is missing a student answer for "${pair.term}".`,
            });
          }
        }
        continue;
      }

      for (let index = 0; index < question.words.length; index += 1) {
        const indexKey = index.toString();
        if (!(indexKey in answer)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["answers", key],
            message: `Spelling question "${key}" is missing word "${indexKey}".`,
          });
        }
      }
    }
  });

export type SparkGraderWorksheetReport = z.infer<
  typeof SparkGraderWorksheetReportSchema
>;
