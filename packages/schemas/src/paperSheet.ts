import { z } from "zod";

const trimmedString = z.string().trim().min(1);
const trimmedMaybeEmptyString = z.string().trim();
const optionalDisplayNumber = trimmedString.optional();

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
  marks: z.number().min(0),
  prompt: trimmedString,
  options: z.array(trimmedString).min(2),
});

export type PaperSheetMcqQuestion = z.infer<typeof PaperSheetMcqQuestionSchema>;

export const PaperSheetLinesQuestionSchema = z.object({
  id: trimmedString,
  type: z.literal("lines"),
  displayNumber: optionalDisplayNumber,
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
  PaperSheetFlowQuestionSchema,
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

export const SparkSolveSheetDraftSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("draft"),
  sheet: PaperSheetDataSchema,
  references: SparkGraderWorksheetReferencesSchema.optional(),
});

export type SparkSolveSheetDraft = z.infer<typeof SparkSolveSheetDraftSchema>;

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

function normalizeLegacyFlowQuestion(
  value: Record<string, unknown>,
  questionId: string,
  displayNumber: string | undefined,
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
  const id =
    asTrimmedStringOrNull(record.id) ??
    `${options.sectionId}-${displayNumber ? slugifyId(displayNumber) : `q${options.index + 1}`}`;
  const marks = Math.max(asNumberOrNull(record.marks) ?? 1, 0);
  const prompt =
    asTrimmedStringOrNull(record.prompt) ??
    asTrimmedStringOrNull(record.promptMarkdown);

  if (!prompt) {
    return null;
  }

  switch (type) {
    case "mcq": {
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
        marks,
        prompt,
        options,
      });
      return parsed.success ? parsed.data : null;
    }
    case "fill": {
      const cloze = splitLegacyBlankPrompt(prompt);
      if (!cloze) {
        return null;
      }
      const parsed = PaperSheetClozeQuestionSchema.safeParse({
        id,
        type: "cloze",
        ...(displayNumber ? { displayNumber } : {}),
        marks,
        segments: cloze.segments,
        blanks: cloze.blanks,
      });
      return parsed.success ? parsed.data : null;
    }
    case "lines": {
      const parsed = PaperSheetLinesQuestionSchema.safeParse({
        id,
        type: "lines",
        ...(displayNumber ? { displayNumber } : {}),
        marks,
        prompt,
        lines: Math.max(asNumberOrNull(record.lines) ?? 4, 1),
        ...(record.renderMode === "markdown" ? { renderMode: "markdown" as const } : {}),
      });
      return parsed.success ? parsed.data : null;
    }
    case "calc": {
      const inputLabel = asTrimmedStringOrNull(record.inputLabel);
      const unit = typeof record.unit === "string" ? record.unit : "";
      if (inputLabel) {
        const parsed = PaperSheetCalcQuestionSchema.safeParse({
          id,
          type: "calc",
          ...(displayNumber ? { displayNumber } : {}),
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
        marks,
        prompt,
        lines: 4,
      });
      return fallback.success ? fallback.data : null;
    }
    case "flow":
      return normalizeLegacyFlowQuestion(record, id, displayNumber, marks, prompt);
    default:
      return null;
  }
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
      normalizeLegacyQuestion(question, {
        sectionId: slugifyId(id),
        index: questionIndex,
      }),
    )
    .filter((entry): entry is PaperSheetQuestion => entry !== null);

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
