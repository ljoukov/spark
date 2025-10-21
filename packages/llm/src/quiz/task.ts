import { z } from "zod";

// Server-side task schema (not for browser). Lives in @spark/llm.
export const GenerateQuizTaskSchema = z.object({
  userId: z.string().min(1),
  quizId: z.string().min(1),
});

export const TaskSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("generateQuiz"),
    generateQuiz: GenerateQuizTaskSchema,
  }),
]);

export type GenerateQuizTask = z.infer<typeof GenerateQuizTaskSchema>;
export type Task = z.infer<typeof TaskSchema>;

