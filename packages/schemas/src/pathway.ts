import { z } from "zod";
import { FirestoreTimestampSchema } from "./firestore";

const trimmedString = z.string().trim().min(1);

export const SparkLearningCountrySchema = z.enum([
  "UK",
  "USA",
  "Canada",
  "Australia",
  "Singapore",
]);

export const SparkPathwayQualificationSchema = z.enum(["gcse"]);
export const SparkPathwayProgrammeSchema = z.enum(["gcse_triple_science"]);
export const SparkPathwayExamBoardSchema = z.enum(["aqa"]);
export const SparkPathwaySubjectSchema = z.enum([
  "biology",
  "chemistry",
  "physics",
]);

export type SparkLearningCountry = z.infer<typeof SparkLearningCountrySchema>;
export type SparkPathwayQualification = z.infer<
  typeof SparkPathwayQualificationSchema
>;
export type SparkPathwayProgramme = z.infer<typeof SparkPathwayProgrammeSchema>;
export type SparkPathwayExamBoard = z.infer<typeof SparkPathwayExamBoardSchema>;
export type SparkPathwaySubject = z.infer<typeof SparkPathwaySubjectSchema>;

export const SparkLearnerBirthYearSchema = z
  .number()
  .int()
  .min(1900)
  .max(new Date().getFullYear());

export type SparkLearnerBirthYear = z.infer<typeof SparkLearnerBirthYearSchema>;

export const SparkLearningSubjectTargetSchema = z
  .object({
    country: SparkLearningCountrySchema,
    schoolStage: trimmedString.max(40),
    subject: trimmedString.max(80),
    subjectLabel: trimmedString.max(120).optional(),
    qualification: trimmedString.max(80).optional(),
    course: trimmedString.max(120).optional(),
    board: trimmedString.max(120).optional(),
    notes: z.string().trim().max(240).optional(),
  })
  .strict();

export type SparkLearningSubjectTarget = z.infer<
  typeof SparkLearningSubjectTargetSchema
>;

export const SparkLearningProfileSelectionSchema = z
  .object({
    country: SparkLearningCountrySchema,
    schoolStage: trimmedString.max(40),
    qualification: SparkPathwayQualificationSchema,
    programme: SparkPathwayProgrammeSchema,
    subject: SparkPathwaySubjectSchema,
    examBoard: SparkPathwayExamBoardSchema,
  })
  .strict();

export type SparkLearningProfileSelection = z.infer<
  typeof SparkLearningProfileSelectionSchema
>;

export const SparkLearningProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    selection: SparkLearningProfileSelectionSchema,
    birthYear: SparkLearnerBirthYearSchema.optional(),
    activePathwayId: trimmedString.optional(),
    createdAt: FirestoreTimestampSchema,
    updatedAt: FirestoreTimestampSchema,
  })
  .strict();

export type SparkLearningProfile = z.infer<typeof SparkLearningProfileSchema>;

export const SparkPathwaySourceDocumentSchema = z
  .object({
    id: trimmedString,
    title: trimmedString,
    publisher: trimmedString,
    qualificationCode: trimmedString,
    sourceUrl: z.string().url(),
    pageUrl: z.string().url(),
    localCachePath: trimmedString.optional(),
    textCachePath: trimmedString.optional(),
    checkedAt: trimmedString.optional(),
  })
  .strict();

export type SparkPathwaySourceDocument = z.infer<
  typeof SparkPathwaySourceDocumentSchema
>;

export const SparkPathwayUnitSchema = z
  .object({
    id: trimmedString,
    title: trimmedString,
    summary: trimmedString.max(800),
    specRefs: z.array(trimmedString).default([]),
    learningGoals: z.array(trimmedString.max(220)).min(1).max(8),
    keyTerms: z.array(trimmedString.max(80)).max(12).default([]),
    checkpointPrompts: z.array(trimmedString.max(240)).min(1).max(6),
    practiceIdeas: z.array(trimmedString.max(240)).min(1).max(6),
    estimatedStudyHours: z.number().int().min(1).max(40),
  })
  .strict();

export type SparkPathwayUnit = z.infer<typeof SparkPathwayUnitSchema>;

export const SparkPathwayWorksheetRunSchema = z
  .object({
    runId: trimmedString,
    unitId: trimmedString,
    title: trimmedString.max(160),
    href: trimmedString,
    createdAt: FirestoreTimestampSchema,
  })
  .strict();

export type SparkPathwayWorksheetRun = z.infer<
  typeof SparkPathwayWorksheetRunSchema
>;

export const SparkPathwayDocumentSchema = z
  .object({
    id: trimmedString,
    schemaVersion: z.literal(1),
    status: z.enum(["ready", "failed"]),
    selection: SparkLearningProfileSelectionSchema,
    title: trimmedString,
    subtitle: trimmedString,
    overview: trimmedString.max(1800),
    units: z.array(SparkPathwayUnitSchema).min(1).max(16),
    sourceDocuments: z.array(SparkPathwaySourceDocumentSchema).min(1),
    worksheetRuns: z.array(SparkPathwayWorksheetRunSchema).default([]),
    modelId: trimmedString.optional(),
    generationNotes: trimmedString.max(1000).optional(),
    error: trimmedString.max(1000).optional(),
    createdAt: FirestoreTimestampSchema,
    updatedAt: FirestoreTimestampSchema,
    generatedAt: FirestoreTimestampSchema,
  })
  .strict();

export type SparkPathwayDocument = z.infer<typeof SparkPathwayDocumentSchema>;
