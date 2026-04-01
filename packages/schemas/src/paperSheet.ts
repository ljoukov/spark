import { z } from "zod";

const trimmedString = z.string().trim().min(1);
const trimmedMaybeEmptyString = z.string().trim();
const optionalDisplayNumber = trimmedString.optional();
const optionalBadgeLabel = trimmedString.optional();

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
  displayNumber: optionalDisplayNumber,
  badgeLabel: optionalBadgeLabel,
  marks: z.number().min(0),
  prompt: trimmedMaybeEmptyString,
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
  displayNumber: optionalDisplayNumber,
  badgeLabel: optionalBadgeLabel,
  marks: z.number().min(0),
  prompt: trimmedString,
  options: z.array(trimmedString).min(2),
});

export type PaperSheetMcqQuestion = z.infer<typeof PaperSheetMcqQuestionSchema>;

export const PaperSheetLinesQuestionSchema = z.object({
  id: trimmedString,
  type: z.literal("lines"),
  displayNumber: optionalDisplayNumber,
  badgeLabel: optionalBadgeLabel,
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
  displayNumber: optionalDisplayNumber,
  badgeLabel: optionalBadgeLabel,
  marks: z.number().min(0),
  prompt: trimmedString,
  hint: z.string().optional(),
  inputLabel: trimmedString,
  unit: trimmedMaybeEmptyString,
});

export type PaperSheetCalcQuestion = z.infer<typeof PaperSheetCalcQuestionSchema>;

export const PaperSheetMatchQuestionSchema = z.object({
  id: trimmedString,
  type: z.literal("match"),
  displayNumber: optionalDisplayNumber,
  badgeLabel: optionalBadgeLabel,
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
  displayNumber: optionalDisplayNumber,
  badgeLabel: optionalBadgeLabel,
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

export const PaperSheetClozeQuestionSchema = z
  .object({
    id: trimmedString,
    type: z.literal("cloze"),
    displayNumber: optionalDisplayNumber,
    badgeLabel: optionalBadgeLabel,
    marks: z.number().min(0),
    segments: z.array(z.string()).min(2),
    blanks: z.array(PaperSheetBlankSchema).min(1),
    wordBank: z.array(trimmedString).min(1).optional(),
  })
  .superRefine((question, ctx) => {
    if (question.segments.length !== question.blanks.length + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["segments"],
        message:
          "Cloze questions need exactly one more segment than blank.",
      });
    }
  });

export type PaperSheetClozeQuestion = z.infer<
  typeof PaperSheetClozeQuestionSchema
>;

export const PaperSheetAnswerBankOptionSchema = z.object({
  id: trimmedString,
  label: trimmedString.optional(),
  text: trimmedString,
});

export type PaperSheetAnswerBankOption = z.infer<
  typeof PaperSheetAnswerBankOptionSchema
>;

export const PaperSheetAnswerBankQuestionSchema = z
  .object({
    id: trimmedString,
    type: z.literal("answer_bank"),
    displayNumber: optionalDisplayNumber,
    badgeLabel: optionalBadgeLabel,
    marks: z.number().min(0),
    segments: z.array(z.string()).min(2),
    blanks: z.array(PaperSheetBlankSchema).min(1),
    options: z.array(PaperSheetAnswerBankOptionSchema).min(1),
    allowReuse: z.boolean().optional(),
  })
  .superRefine((question, ctx) => {
    if (question.segments.length !== question.blanks.length + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["segments"],
        message:
          "Answer-bank questions need exactly one more segment than blank.",
      });
    }

    const optionIds = new Set<string>();
    for (let index = 0; index < question.options.length; index += 1) {
      const option = question.options[index];
      if (!option) {
        continue;
      }
      if (optionIds.has(option.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options", index, "id"],
          message: `Duplicate answer-bank option id "${option.id}".`,
        });
      } else {
        optionIds.add(option.id);
      }
    }

    if (
      question.allowReuse !== true &&
      question.options.length < question.blanks.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message:
          "Answer-bank questions without reuse need at least as many options as blanks.",
      });
    }
  });

export type PaperSheetAnswerBankQuestion = z.infer<
  typeof PaperSheetAnswerBankQuestionSchema
>;

export const PaperSheetFlowBoxSchema = z.object({
  id: trimmedString,
  placeholder: z.string().optional(),
  minWidth: z.number().int().min(1).optional(),
  initialValue: z.string().optional(),
  readonly: z.boolean().optional(),
});

export type PaperSheetFlowBox = z.infer<typeof PaperSheetFlowBoxSchema>;

export const PaperSheetFlowRowItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("box"),
    boxId: trimmedString,
  }),
  z.object({
    type: z.literal("operation"),
    label: trimmedString,
  }),
]);

export type PaperSheetFlowRowItem = z.infer<
  typeof PaperSheetFlowRowItemSchema
>;

export const PaperSheetFlowRowSchema = z
  .object({
    direction: z.enum(["ltr", "rtl"]),
    items: z.array(PaperSheetFlowRowItemSchema).min(1),
  })
  .superRefine((row, ctx) => {
    for (let index = 0; index < row.items.length; index += 1) {
      const item = row.items[index];
      if (!item) {
        continue;
      }
      const shouldBeBox = index % 2 === 0;
      if (shouldBeBox && item.type !== "box") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index],
          message: "Flow rows must start with a box and alternate box / operation.",
        });
      }
      if (!shouldBeBox && item.type !== "operation") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index],
          message: "Flow rows must alternate box / operation / box.",
        });
      }
    }
  });

export type PaperSheetFlowRow = z.infer<typeof PaperSheetFlowRowSchema>;

export const PaperSheetFlowConnectorSchema = z.object({
  fromBoxId: trimmedString,
  toBoxId: trimmedString,
  label: trimmedMaybeEmptyString,
  direction: z.enum(["down", "up"]),
});

export type PaperSheetFlowConnector = z.infer<
  typeof PaperSheetFlowConnectorSchema
>;

export const PaperSheetFlowQuestionSchema = z
  .object({
    id: trimmedString,
    type: z.literal("flow"),
    displayNumber: optionalDisplayNumber,
    badgeLabel: optionalBadgeLabel,
    marks: z.number().min(0),
    prompt: trimmedString,
    boxes: z.array(PaperSheetFlowBoxSchema).min(1),
    rows: z.array(PaperSheetFlowRowSchema).min(1),
    connectors: z.array(PaperSheetFlowConnectorSchema).optional(),
  })
  .superRefine((question, ctx) => {
    const boxIds = new Set(question.boxes.map((box) => box.id));
    for (let rowIndex = 0; rowIndex < question.rows.length; rowIndex += 1) {
      const row = question.rows[rowIndex];
      if (!row) {
        continue;
      }
      for (let itemIndex = 0; itemIndex < row.items.length; itemIndex += 1) {
        const item = row.items[itemIndex];
        if (!item || item.type !== "box") {
          continue;
        }
        if (!boxIds.has(item.boxId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["rows", rowIndex, "items", itemIndex, "boxId"],
            message: `Unknown flow box "${item.boxId}".`,
          });
        }
      }
    }
    for (
      let connectorIndex = 0;
      connectorIndex < (question.connectors?.length ?? 0);
      connectorIndex += 1
    ) {
      const connector = question.connectors?.[connectorIndex];
      if (!connector) {
        continue;
      }
      if (!boxIds.has(connector.fromBoxId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["connectors", connectorIndex, "fromBoxId"],
          message: `Unknown flow box "${connector.fromBoxId}".`,
        });
      }
      if (!boxIds.has(connector.toBoxId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["connectors", connectorIndex, "toBoxId"],
          message: `Unknown flow box "${connector.toBoxId}".`,
        });
      }
    }
  });

export type PaperSheetFlowQuestion = z.infer<
  typeof PaperSheetFlowQuestionSchema
>;

export const PaperSheetQuestionSchema = z.discriminatedUnion("type", [
  PaperSheetFillQuestionSchema,
  PaperSheetMcqQuestionSchema,
  PaperSheetLinesQuestionSchema,
  PaperSheetCalcQuestionSchema,
  PaperSheetMatchQuestionSchema,
  PaperSheetSpellingQuestionSchema,
  PaperSheetClozeQuestionSchema,
  PaperSheetAnswerBankQuestionSchema,
  PaperSheetFlowQuestionSchema,
]);

export type PaperSheetQuestion = z.infer<typeof PaperSheetQuestionSchema>;

export const PaperSheetQuestionGroupSchema = z.object({
  id: trimmedString,
  type: z.literal("group"),
  displayNumber: optionalDisplayNumber,
  badgeLabel: optionalBadgeLabel,
  prompt: trimmedString,
  questions: z.array(PaperSheetQuestionSchema).min(1),
});

export type PaperSheetQuestionGroup = z.infer<
  typeof PaperSheetQuestionGroupSchema
>;

export const PaperSheetQuestionEntrySchema = z.discriminatedUnion("type", [
  PaperSheetQuestionGroupSchema,
  PaperSheetFillQuestionSchema,
  PaperSheetMcqQuestionSchema,
  PaperSheetLinesQuestionSchema,
  PaperSheetCalcQuestionSchema,
  PaperSheetMatchQuestionSchema,
  PaperSheetSpellingQuestionSchema,
  PaperSheetClozeQuestionSchema,
  PaperSheetAnswerBankQuestionSchema,
  PaperSheetFlowQuestionSchema,
]);

export type PaperSheetQuestionEntry = z.infer<
  typeof PaperSheetQuestionEntrySchema
>;

export const PaperSheetContentSectionSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  theory: z.string().optional(),
  infoBox: PaperSheetInfoBoxSchema.optional(),
  questions: z.array(PaperSheetQuestionEntrySchema).optional(),
}).superRefine((section, ctx) => {
  const hasTheory =
    typeof section.theory === "string" && section.theory.trim().length > 0;
  const hasInfoBox = section.infoBox !== undefined;
  const questionCount = section.questions?.length ?? 0;
  if (!hasTheory && !hasInfoBox && questionCount === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["questions"],
      message:
        "Worksheet content sections need at least one question, theory block, or info box.",
    });
  }
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
    const entryIds = new Set<string>();

    const validateEntries = (
      entries: readonly PaperSheetQuestionEntry[] | undefined,
      path: (string | number)[],
    ): void => {
      for (let entryIndex = 0; entryIndex < (entries?.length ?? 0); entryIndex += 1) {
        const entry = entries?.[entryIndex];
        if (!entry) {
          continue;
        }
        if (entryIds.has(entry.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, entryIndex, "id"],
            message: `Duplicate worksheet question or group id "${entry.id}".`,
          });
        } else {
          entryIds.add(entry.id);
        }
        if (entry.type === "group") {
          validateEntries(entry.questions, [...path, entryIndex, "questions"]);
        }
      }
    };

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
      validateEntries(section.questions, ["sections", sectionIndex, "questions"]);
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

export const SparkSolveSheetDraftSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("draft"),
  sheet: PaperSheetDataSchema,
  references: SparkGraderWorksheetReferencesSchema.optional(),
});

export type SparkSolveSheetDraft = z.infer<typeof SparkSolveSheetDraftSchema>;

export function isPaperSheetQuestionGroup(
  entry: PaperSheetQuestionEntry,
): entry is PaperSheetQuestionGroup {
  return entry.type === "group";
}

export function visitPaperSheetQuestions(
  entries: readonly PaperSheetQuestionEntry[] | undefined,
  visitor: (question: PaperSheetQuestion, parentGroup: PaperSheetQuestionGroup | null) => void,
): void {
  const visitEntries = (
    currentEntries: readonly PaperSheetQuestionEntry[] | undefined,
    parentGroup: PaperSheetQuestionGroup | null,
  ): void => {
    for (const entry of currentEntries ?? []) {
      if (isPaperSheetQuestionGroup(entry)) {
        visitEntries(entry.questions, entry);
        continue;
      }
      visitor(entry, parentGroup);
    }
  };

  visitEntries(entries, null);
}

export function countPaperSheetQuestions(
  entries: readonly PaperSheetQuestionEntry[] | undefined,
): number {
  let count = 0;
  visitPaperSheetQuestions(entries, () => {
    count += 1;
  });
  return count;
}

export function sumPaperSheetMarks(
  entries: readonly PaperSheetQuestionEntry[] | undefined,
): number {
  let total = 0;
  visitPaperSheetQuestions(entries, (question) => {
    total += question.marks;
  });
  return total;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asTrimmedStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/u.test(value)
    ? value
    : fallback;
}

function slugifyId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized.length > 0 ? normalized : "item";
}

function splitLegacyBlankPrompt(prompt: string): {
  segments: string[];
  blanks: PaperSheetClozeQuestion["blanks"];
} | null {
  const segments = prompt.split(/_{3,}/gu);
  if (segments.length < 2) {
    return null;
  }
  return {
    segments,
    blanks: Array.from({ length: segments.length - 1 }, () => ({
      placeholder: "answer",
    })),
  };
}

function normalizeLegacyBlank(value: unknown): PaperSheetBlank | null {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value === "string") {
    const parsed = PaperSheetBlankSchema.safeParse({
      placeholder: value,
    });
    return parsed.success ? parsed.data : null;
  }
  const record = asObjectRecord(value);
  if (!record) {
    return null;
  }
  const parsed = PaperSheetBlankSchema.safeParse({
    ...(typeof record.placeholder === "string"
      ? { placeholder: record.placeholder }
      : {}),
    ...(typeof record.minWidth === "number" && Number.isInteger(record.minWidth)
      ? { minWidth: record.minWidth }
      : {}),
  });
  return parsed.success ? parsed.data : null;
}

function normalizeLegacyMcqOption(option: unknown): string | null {
  const direct = asTrimmedStringOrNull(option);
  if (direct) {
    return direct;
  }
  const record = asObjectRecord(option);
  if (!record) {
    return null;
  }
  const text =
    asTrimmedStringOrNull(record.text) ??
    asTrimmedStringOrNull(record.value) ??
    asTrimmedStringOrNull(record.label);
  if (!text) {
    return null;
  }
  const id = asTrimmedStringOrNull(record.id);
  if (!id) {
    return text;
  }
  return text.startsWith(`(${id})`) ? text : `(${id}) ${text}`;
}

function normalizeLegacyAnswerBankOption(
  option: unknown,
  index: number,
): PaperSheetAnswerBankOption | null {
  const direct = asTrimmedStringOrNull(option);
  if (direct) {
    const labeledMatch = /^\(([^)]+)\)\s*(.+)$/u.exec(direct);
    if (labeledMatch) {
      const label = labeledMatch[1]?.trim();
      const text = labeledMatch[2]?.trim();
      if (label && text) {
        const parsed = PaperSheetAnswerBankOptionSchema.safeParse({
          id: label,
          label,
          text,
        });
        return parsed.success ? parsed.data : null;
      }
    }
    const parsed = PaperSheetAnswerBankOptionSchema.safeParse({
      id: `option-${index + 1}`,
      text: direct,
    });
    return parsed.success ? parsed.data : null;
  }

  const record = asObjectRecord(option);
  if (!record) {
    return null;
  }

  const text =
    asTrimmedStringOrNull(record.text) ??
    asTrimmedStringOrNull(record.value) ??
    null;
  if (!text) {
    return null;
  }

  const label =
    asTrimmedStringOrNull(record.label) ??
    asTrimmedStringOrNull(record.optionLabel) ??
    undefined;
  const id =
    asTrimmedStringOrNull(record.id) ?? label ?? `option-${index + 1}`;
  const parsed = PaperSheetAnswerBankOptionSchema.safeParse({
    id,
    ...(label ? { label } : {}),
    text,
  });
  return parsed.success ? parsed.data : null;
}

function normalizeLegacyFlowQuestion(
  value: Record<string, unknown>,
  questionId: string,
  displayNumber: string | undefined,
  badgeLabel: string | undefined,
  marks: number,
  prompt: string,
): PaperSheetFlowQuestion | null {
  const rawBoxes = Array.isArray(value.boxes) ? value.boxes : null;
  if (!rawBoxes || rawBoxes.length === 0) {
    return null;
  }

  const boxes = rawBoxes
    .map((entry, index) => {
      const record = asObjectRecord(entry);
      if (!record) {
        return null;
      }
      const id = asTrimmedStringOrNull(record.id) ?? `box-${index + 1}`;
      const initialValue = asTrimmedStringOrNull(record.initialValue) ?? undefined;
      const placeholder = asTrimmedStringOrNull(record.placeholder) ?? undefined;
      const minWidth = asNumberOrNull(record.minWidth);
      const readonly =
        record.readonly === true || record.editable === false ? true : undefined;
      return {
        id,
        ...(placeholder ? { placeholder } : {}),
        ...(typeof minWidth === "number" && Number.isInteger(minWidth) && minWidth > 0
          ? { minWidth }
          : {}),
        ...(initialValue ? { initialValue } : {}),
        ...(readonly ? { readonly } : {}),
      };
    })
    .filter((entry): entry is PaperSheetFlowQuestion["boxes"][number] => entry !== null);

  if (boxes.length === 0) {
    return null;
  }

  const rawArrows = Array.isArray(value.arrows) ? value.arrows : [];
  const groupedBoxes = new Map<
    string,
    {
      order: number;
      boxes: Array<{ id: string; index: number }>;
    }
  >();

  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    if (!box) {
      continue;
    }
    const match = /^([a-zA-Z_]+)(\d+)$/u.exec(box.id);
    const prefix = match?.[1] ?? box.id;
    const numericIndex = match?.[2] ? Number.parseInt(match[2], 10) : index;
    const existing = groupedBoxes.get(prefix);
    if (existing) {
      existing.boxes.push({ id: box.id, index: numericIndex });
      continue;
    }
    groupedBoxes.set(prefix, {
      order: groupedBoxes.size,
      boxes: [{ id: box.id, index: numericIndex }],
    });
  }

  const arrowLabels = new Map<string, string>();
  for (const entry of rawArrows) {
    const record = asObjectRecord(entry);
    if (!record) {
      continue;
    }
    const from = asTrimmedStringOrNull(record.from);
    const to = asTrimmedStringOrNull(record.to);
    const label = asTrimmedStringOrNull(record.label);
    if (!from || !to || !label) {
      continue;
    }
    arrowLabels.set(`${from}->${to}`, label);
  }

  const rows = [...groupedBoxes.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([prefix, group]) => {
      const sorted = [...group.boxes].sort((a, b) => a.index - b.index);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const forwardLabel =
        first && last ? arrowLabels.get(`${first.id}->${last.id}`) : undefined;
      const direction: PaperSheetFlowQuestion["rows"][number]["direction"] =
        prefix.toLowerCase().includes("bottom") ||
        (forwardLabel === undefined &&
          sorted.length >= 2 &&
          arrowLabels.has(`${sorted[1]?.id ?? ""}->${sorted[0]?.id ?? ""}`))
          ? "rtl"
          : "ltr";
      const ordered = direction === "ltr" ? sorted : [...sorted].reverse();
      const items: PaperSheetFlowQuestion["rows"][number]["items"] = [];
      for (let index = 0; index < ordered.length; index += 1) {
        const box = ordered[index];
        if (!box) {
          continue;
        }
        items.push({
          type: "box",
          boxId: box.id,
        });
        if (index >= ordered.length - 1) {
          continue;
        }
        const next = ordered[index + 1];
        if (!next) {
          continue;
        }
        const label =
          arrowLabels.get(`${box.id}->${next.id}`) ??
          arrowLabels.get(`${next.id}->${box.id}`);
        if (!label) {
          continue;
        }
        items.push({
          type: "operation",
          label,
        });
      }
      return {
        direction,
        items,
      };
    })
    .filter((row) => row.items.length > 0);

  const parsed = PaperSheetFlowQuestionSchema.safeParse({
    id: questionId,
    type: "flow",
    ...(displayNumber ? { displayNumber } : {}),
    ...(badgeLabel ? { badgeLabel } : {}),
    marks,
    prompt,
    boxes,
    rows,
  });
  return parsed.success ? parsed.data : null;
}

function normalizeLegacyQuestion(
  value: unknown,
  options: {
    sectionId: string;
    index: number;
  },
): PaperSheetQuestion | null {
  const direct = PaperSheetQuestionSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const record = asObjectRecord(value);
  if (!record) {
    return null;
  }
  const type = asTrimmedStringOrNull(record.type);
  if (!type) {
    return null;
  }

  const displayNumber = asTrimmedStringOrNull(record.displayNumber) ?? undefined;
  const badgeLabel = asTrimmedStringOrNull(record.badgeLabel) ?? undefined;
  const id =
    asTrimmedStringOrNull(record.id) ??
    `${options.sectionId}-${displayNumber ? slugifyId(displayNumber) : `q${options.index + 1}`}`;
  const marks = Math.max(asNumberOrNull(record.marks) ?? 1, 0);
  const prompt =
    asTrimmedStringOrNull(record.prompt) ??
    asTrimmedStringOrNull(record.promptMarkdown);

  switch (type) {
    case "mcq": {
      if (!prompt) {
        return null;
      }
      const rawOptions = Array.isArray(record.options) ? record.options : null;
      if (!rawOptions) {
        return null;
      }
      const options = rawOptions
        .map(normalizeLegacyMcqOption)
        .filter((entry): entry is string => entry !== null);
      const parsed = PaperSheetMcqQuestionSchema.safeParse({
        id,
        type: "mcq",
        ...(displayNumber ? { displayNumber } : {}),
        ...(badgeLabel ? { badgeLabel } : {}),
        marks,
        prompt,
        options,
      });
      return parsed.success ? parsed.data : null;
    }
    case "fill": {
      const rawBlanks = Array.isArray(record.blanks) ? record.blanks : null;
      const rawPrompt =
        typeof record.prompt === "string"
          ? record.prompt
          : typeof record.promptMarkdown === "string"
            ? record.promptMarkdown
            : "";
      const rawAfter = typeof record.after === "string" ? record.after : "";
      const rawConjunction =
        typeof record.conjunction === "string" ? record.conjunction : undefined;
      if (rawBlanks && rawBlanks.length >= 1 && rawBlanks.length <= 2) {
        const blanks = rawBlanks
          .map(normalizeLegacyBlank)
          .filter((blank): blank is PaperSheetBlank => blank !== null);
        if (blanks.length === rawBlanks.length) {
          const structuredFill = PaperSheetFillQuestionSchema.safeParse({
            id,
            type: "fill",
            ...(displayNumber ? { displayNumber } : {}),
            ...(badgeLabel ? { badgeLabel } : {}),
            marks,
            prompt: rawPrompt,
            blanks,
            after: rawAfter,
            ...(rawConjunction !== undefined
              ? { conjunction: rawConjunction }
              : {}),
          });
          if (structuredFill.success) {
            return structuredFill.data;
          }
        }
      }
      if (!prompt) {
        return null;
      }
      const cloze = splitLegacyBlankPrompt(prompt);
      if (!cloze) {
        return null;
      }
      const parsed = PaperSheetClozeQuestionSchema.safeParse({
        id,
        type: "cloze",
        ...(displayNumber ? { displayNumber } : {}),
        ...(badgeLabel ? { badgeLabel } : {}),
        marks,
        segments: cloze.segments,
        blanks: cloze.blanks,
      });
      return parsed.success ? parsed.data : null;
    }
    case "answer_bank": {
      const rawOptions = Array.isArray(record.options) ? record.options : null;
      if (!rawOptions) {
        return null;
      }
      const options = rawOptions
        .map((option, index) => normalizeLegacyAnswerBankOption(option, index))
        .filter(
          (option): option is PaperSheetAnswerBankOption => option !== null,
        );
      if (options.length !== rawOptions.length) {
        return null;
      }

      const rawSegments = Array.isArray(record.segments) ? record.segments : null;
      const rawBlanks = Array.isArray(record.blanks) ? record.blanks : null;
      if (rawSegments && rawBlanks) {
        const blanks = rawBlanks
          .map(normalizeLegacyBlank)
          .filter((blank): blank is PaperSheetBlank => blank !== null);
        if (blanks.length !== rawBlanks.length) {
          return null;
        }
        const segments = rawSegments.map((segment) =>
          typeof segment === "string" ? segment : "",
        );
        const parsed = PaperSheetAnswerBankQuestionSchema.safeParse({
          id,
          type: "answer_bank",
          ...(displayNumber ? { displayNumber } : {}),
          ...(badgeLabel ? { badgeLabel } : {}),
          marks,
          segments,
          blanks,
          options,
          ...(record.allowReuse === true ? { allowReuse: true } : {}),
        });
        return parsed.success ? parsed.data : null;
      }

      if (!prompt) {
        return null;
      }
      const cloze = splitLegacyBlankPrompt(prompt);
      if (!cloze) {
        return null;
      }
      const parsed = PaperSheetAnswerBankQuestionSchema.safeParse({
        id,
        type: "answer_bank",
        ...(displayNumber ? { displayNumber } : {}),
        ...(badgeLabel ? { badgeLabel } : {}),
        marks,
        segments: cloze.segments,
        blanks: cloze.blanks,
        options,
        ...(record.allowReuse === true ? { allowReuse: true } : {}),
      });
      return parsed.success ? parsed.data : null;
    }
    case "lines": {
      if (!prompt) {
        return null;
      }
      const parsed = PaperSheetLinesQuestionSchema.safeParse({
        id,
        type: "lines",
        ...(displayNumber ? { displayNumber } : {}),
        ...(badgeLabel ? { badgeLabel } : {}),
        marks,
        prompt,
        lines: Math.max(asNumberOrNull(record.lines) ?? 4, 1),
        ...(record.renderMode === "markdown" ? { renderMode: "markdown" as const } : {}),
      });
      return parsed.success ? parsed.data : null;
    }
    case "calc": {
      if (!prompt) {
        return null;
      }
      const inputLabel = asTrimmedStringOrNull(record.inputLabel);
      const unit = typeof record.unit === "string" ? record.unit : "";
      if (inputLabel) {
        const parsed = PaperSheetCalcQuestionSchema.safeParse({
          id,
          type: "calc",
          ...(displayNumber ? { displayNumber } : {}),
          ...(badgeLabel ? { badgeLabel } : {}),
          marks,
          prompt,
          ...(asTrimmedStringOrNull(record.hint)
            ? { hint: asTrimmedStringOrNull(record.hint) }
            : {}),
          inputLabel,
          unit,
        });
        return parsed.success ? parsed.data : null;
      }
      const fallback = PaperSheetLinesQuestionSchema.safeParse({
        id,
        type: "lines",
        ...(displayNumber ? { displayNumber } : {}),
        ...(badgeLabel ? { badgeLabel } : {}),
        marks,
        prompt,
        lines: 4,
      });
      return fallback.success ? fallback.data : null;
    }
    case "flow":
      if (!prompt) {
        return null;
      }
      return normalizeLegacyFlowQuestion(
        record,
        id,
        displayNumber,
        badgeLabel,
        marks,
        prompt,
      );
    default:
      return null;
  }
}

function normalizeLegacyQuestionEntry(
  value: unknown,
  options: {
    sectionId: string;
    index: number;
  },
): PaperSheetQuestionEntry | null {
  const direct = PaperSheetQuestionEntrySchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const record = asObjectRecord(value);
  if (!record) {
    return null;
  }

  const type = asTrimmedStringOrNull(record.type);
  if (type !== "group") {
    return normalizeLegacyQuestion(value, options);
  }

  const displayNumber = asTrimmedStringOrNull(record.displayNumber) ?? undefined;
  const badgeLabel = asTrimmedStringOrNull(record.badgeLabel) ?? undefined;
  const id =
    asTrimmedStringOrNull(record.id) ??
    `${options.sectionId}-${displayNumber ? slugifyId(displayNumber) : `group-${options.index + 1}`}`;
  const prompt =
    asTrimmedStringOrNull(record.prompt) ??
    asTrimmedStringOrNull(record.promptMarkdown);
  const rawQuestions = Array.isArray(record.questions) ? record.questions : null;
  if (!prompt || !rawQuestions) {
    return null;
  }
  const questions = rawQuestions
    .map((question, questionIndex) =>
      normalizeLegacyQuestion(question, {
        sectionId: `${options.sectionId}-${slugifyId(id)}`,
        index: questionIndex,
      }),
    )
    .filter((entry): entry is PaperSheetQuestion => entry !== null);
  const parsed = PaperSheetQuestionGroupSchema.safeParse({
    id,
    type: "group",
    ...(displayNumber ? { displayNumber } : {}),
    ...(badgeLabel ? { badgeLabel } : {}),
    prompt,
    questions,
  });
  return parsed.success ? parsed.data : null;
}

function normalizeLegacySection(
  value: unknown,
  index: number,
): PaperSheetSection | null {
  const direct = PaperSheetSectionSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const record = asObjectRecord(value);
  if (!record) {
    return null;
  }

  const title =
    asTrimmedStringOrNull(record.label) ?? asTrimmedStringOrNull(record.title);
  if (!title) {
    const text = asTrimmedStringOrNull(record.text);
    if (!text) {
      return null;
    }
    const parsed = PaperSheetHookSectionSchema.safeParse({
      type: "hook",
      text,
    });
    return parsed.success ? parsed.data : null;
  }

  const titleMatch = /^([A-Z])\.\s*(.+)$/u.exec(title);
  const id = titleMatch?.[1] ?? `section-${index + 1}`;
  const label = titleMatch?.[2]?.trim() ?? title;
  const theoryParts = [
    asTrimmedStringOrNull(record.theory),
    asTrimmedStringOrNull(record.instructions),
  ].filter((entry): entry is string => entry !== null);
  const rawQuestions = Array.isArray(record.questions) ? record.questions : [];
  const questions = rawQuestions
    .map((question, questionIndex) =>
      normalizeLegacyQuestionEntry(question, {
        sectionId: slugifyId(id),
        index: questionIndex,
      }),
    )
    .filter((entry): entry is PaperSheetQuestionEntry => entry !== null);

  const parsed = PaperSheetContentSectionSchema.safeParse({
    id,
    label,
    ...(theoryParts.length > 0 ? { theory: theoryParts.join("\n\n") } : {}),
    ...(questions.length > 0 ? { questions } : {}),
  });
  return parsed.success ? parsed.data : null;
}

export function coerceSparkSolveSheetDraft(
  value: unknown,
): SparkSolveSheetDraft | null {
  const direct = SparkSolveSheetDraftSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const record = asObjectRecord(value);
  const sheet = record ? asObjectRecord(record.sheet) : null;
  const rawSections = Array.isArray(sheet?.sections) ? sheet.sections : null;
  if (!record || !sheet || !rawSections) {
    return null;
  }

  const sections = rawSections
    .map((section, index) => normalizeLegacySection(section, index))
    .filter((entry): entry is PaperSheetSection => entry !== null);
  if (sections.length !== rawSections.length || sections.length === 0) {
    return null;
  }

  const references = SparkGraderWorksheetReferencesSchema.safeParse(
    record.references,
  );
  const normalizedCandidate = {
    schemaVersion: 1 as const,
    mode: "draft" as const,
    sheet: {
      id: asTrimmedStringOrNull(sheet.id) ?? "sheet-draft",
      subject: asTrimmedStringOrNull(sheet.subject) ?? "Worksheet",
      level: asTrimmedStringOrNull(sheet.level) ?? "Mixed practice",
      title: asTrimmedStringOrNull(sheet.title) ?? "Worksheet",
      subtitle: asTrimmedStringOrNull(sheet.subtitle) ?? "Solve each question.",
      color: normalizeHexColor(sheet.color, "#36587A"),
      accent: normalizeHexColor(sheet.accent, "#4D7AA5"),
      light: normalizeHexColor(sheet.light, "#E8F2FB"),
      border: normalizeHexColor(sheet.border, "#BFD0E0"),
      sections,
    },
    ...(references.success ? { references: references.data } : {}),
  };

  const normalized = SparkSolveSheetDraftSchema.safeParse(normalizedCandidate);
  return normalized.success ? normalized.data : null;
}

export const SparkSolveSheetAnswersSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("draft_answers"),
  answers: PaperSheetAnswersSchema,
});

export type SparkSolveSheetAnswers = z.infer<
  typeof SparkSolveSheetAnswersSchema
>;

function collectSheetQuestions(
  sheet: PaperSheetData,
): Map<string, PaperSheetQuestion> {
  const questions = new Map<string, PaperSheetQuestion>();
  for (const section of sheet.sections) {
    if (!("id" in section)) {
      continue;
    }
    visitPaperSheetQuestions(section.questions, (question) => {
      questions.set(question.id, question);
    });
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

      if (question.type === "cloze") {
        const expectedKeys = question.blanks.map((_, index) => index.toString());
        for (const expectedKey of expectedKeys) {
          if (!(expectedKey in answer)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["answers", key],
              message: `Cloze question "${key}" is missing blank "${expectedKey}".`,
            });
          }
        }
        continue;
      }

      if (question.type === "answer_bank") {
        const expectedKeys = question.blanks.map((_, index) => index.toString());
        const optionIds = new Set(question.options.map((option) => option.id));
        const usedOptionIds = new Set<string>();
        for (const expectedKey of expectedKeys) {
          const selectedOptionId = answer[expectedKey];
          if (selectedOptionId === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["answers", key],
              message: `Answer-bank question "${key}" is missing blank "${expectedKey}".`,
            });
            continue;
          }
          if (!optionIds.has(selectedOptionId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["answers", key, expectedKey],
              message: `Answer-bank question "${key}" uses unknown option "${selectedOptionId}".`,
            });
            continue;
          }
          if (question.allowReuse !== true) {
            if (usedOptionIds.has(selectedOptionId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["answers", key, expectedKey],
                message: `Answer-bank question "${key}" reuses option "${selectedOptionId}" across blanks.`,
              });
            } else {
              usedOptionIds.add(selectedOptionId);
            }
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

      if (question.type === "flow") {
        for (const box of question.boxes) {
          const requiresAnswer =
            box.initialValue === undefined && box.readonly !== true;
          if (requiresAnswer && !(box.id in answer)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["answers", key],
              message: `Flow question "${key}" is missing box "${box.id}".`,
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
