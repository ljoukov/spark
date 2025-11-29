import { Type, type Schema } from "@google/genai";
import { z } from "zod";

export const ASSUMPTIONS = [
  "basic Python syntax",
  "lists",
  "integer division (//)",
  "modulo (%)",
] as const;

export const MAX_PLAN_ATTEMPTS = 3;
export const MAX_PLAN_GRADE_RETRIES = 2;

export const PLAN_LIMITS = {
  topic: 120,
  assumption: 80,
  story: {
    storyTopic: 120,
    protagonist: 120,
    anchorEvent: 160,
    anchorYear: 12,
    anchorPlace: 120,
    stakes: 200,
    analogySeed: 180,
    modernTieIn: 120,
    visualMotif: 160,
    namingNote: 160,
  },
  partSummary: 160,
  promisedSkill: 80,
  concept: 120,
  blueprintTitle: 120,
  blueprintIdea: 600,
  blueprintSkill: 80,
  blueprintConstraint: 160,
} as const;

const PlanPartSchema = z.object({
  order: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  kind: z.enum(["story", "intro_quiz", "coding_1", "coding_2", "wrap_up_quiz"]),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(PLAN_LIMITS.partSummary)
    .superRefine((value, ctx) => {
      const words = value.split(/\s+/).filter((part) => part.length > 0);
      if (words.length > 15) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "summary must be 15 words or fewer",
        });
      }
    }),
});

const CodingBlueprintSchema = z.object({
  id: z.enum(["p1", "p2"]),
  title: z.string().trim().min(1).max(PLAN_LIMITS.blueprintTitle),
  idea: z.string().trim().min(1).max(PLAN_LIMITS.blueprintIdea),
  required_skills: z
    .array(z.string().trim().min(1).max(PLAN_LIMITS.blueprintSkill))
    .min(1),
  constraints: z
    .array(z.string().trim().min(1).max(PLAN_LIMITS.blueprintConstraint))
    .optional(),
});

export const SessionPlanSchema = z
  .object({
    topic: z.string().trim().min(1).max(PLAN_LIMITS.topic),
    difficulty: z.enum(["easy", "medium", "hard"]),
    assumptions: z.array(z.string().trim().min(1).max(PLAN_LIMITS.assumption)),
    story: z.object({
      storyTopic: z.string().trim().min(1).max(PLAN_LIMITS.story.storyTopic),
      protagonist: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.protagonist)
        .optional(),
      anchor_event: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.anchorEvent)
        .optional(),
      anchor_year: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.anchorYear)
        .optional(),
      anchor_place: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.anchorPlace)
        .optional(),
      stakes: z.string().trim().min(1).max(PLAN_LIMITS.story.stakes).optional(),
      analogy_seed: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.analogySeed)
        .optional(),
      modern_tie_in: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.modernTieIn)
        .optional(),
      visual_motif: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.visualMotif)
        .optional(),
      naming_note: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.namingNote)
        .optional(),
    }),
    parts: z.array(PlanPartSchema).length(5),
    promised_skills: z
      .array(z.string().trim().min(1).max(PLAN_LIMITS.promisedSkill))
      .min(1),
    concepts_to_teach: z.array(
      z.string().trim().min(1).max(PLAN_LIMITS.concept),
    ),
    coding_blueprints: z.array(CodingBlueprintSchema).length(2),
  })
  .superRefine((data, ctx) => {
    const requiredIds = new Set(["p1", "p2"]);
    for (const blueprint of data.coding_blueprints) {
      requiredIds.delete(blueprint.id);
    }
    if (requiredIds.size > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `coding_blueprints missing ids: ${Array.from(requiredIds).join(", ")}`,
      });
    }
    const expectedKinds = [
      "story",
      "intro_quiz",
      "coding_1",
      "coding_2",
      "wrap_up_quiz",
    ];
    data.parts.forEach((part, index) => {
      const expectedOrder = index + 1;
      if (part.order !== expectedOrder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parts[${index}] order expected ${expectedOrder} but received ${part.order}`,
        });
      }
      if (part.kind !== expectedKinds[index]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parts[${index}] kind expected ${expectedKinds[index]} but received ${part.kind}`,
        });
      }
    });
  });

export type SessionPlan = z.infer<typeof SessionPlanSchema>;

const PlanGradeSchemaBase = z.object({
  pass: z.boolean(),
  issues: z.array(z.string().trim()).default([]),
  missing_skills: z.array(z.string().trim()).default([]),
  suggested_edits: z.array(z.string().trim()).default([]),
});

export const PlanGradeSchema = PlanGradeSchemaBase;
export type PlanGrade = z.infer<typeof PlanGradeSchema>;

export function buildPlanIdeasUserPrompt(topic: string, seed?: number): string {
  return [
    `Topic: "${topic}"`,
    `Seed: ${seed ?? "none"}`,
    "",
    "Task: Produce at least 3 distinct lesson ideas in Markdown.",
    "Each idea must include:",
    "- Title line",
    "- Story paragraph ending with `in todays's lesson...` that is historically grounded (no fictional worlds).",
    "- Historical Hook bullets: protagonist (name + role), specific event with year/place, and the stakes.",
    "- Analogy Seed: a one-sentence functional analogy that maps to the concept’s core behaviour.",
    "- Modern Tie-in Domain: one noun phrase to reserve for the ending pivot (keep it aligned to the lesson).",
    "- Visual Motif: one physical, period-appropriate object/scene to reuse in illustrations (no neon/abstract).",
    "- Naming Note (optional): why the concept/name stuck, if relevant and safe to include.",
    "- Five-Part Progression with numbered list (1 story, 2 intro/quiz, 3 first coding problem, 4 second coding problem, 5 wrap up quiz)",
    "- Promised Skills bullet list",
    "- Concepts To Teach list (may be empty)",
    "- Two Coding Blueprints with required skills; blueprint 2 must add at least one new concept/skill or pattern beyond blueprint 1 (not just bigger inputs or a light reskin)",
    "- Note any common pitfalls/limitations (preconditions, one-way theorems, false positives) that must be surfaced in quizzes",
    "- Call out any randomness or probabilistic steps and how to make them reproducible (fixed seeds, deterministic base sets) so grading and reference solutions are stable",
    "- Only include concepts that appear in the parts summaries or coding blueprint logic; drop anything unused (no stray 'Boolean flags' unless the blueprint explicitly uses a flag).",
    "- Promised Skills must cover every skill the coding blueprints need; avoid adding skills that are not used.",
    "",
    "Use clear labels for each idea (e.g., Historical Hook, Analogy Seed, Modern Tie-in Domain, Visual Motif, Naming Note) so they can be parsed into the plan.",
  ].join("\n");
}

export function buildPlanParseUserPrompt(markdown: string): string {
  return [
    "Schema: {topic, difficulty, assumptions, story{storyTopic, protagonist?, anchor_event?, anchor_year?, anchor_place?, stakes?, analogy_seed?, modern_tie_in?, visual_motif?, naming_note?}, parts[{order,kind,summary}], promised_skills[], concepts_to_teach[], coding_blueprints[{id,title,idea,required_skills[],constraints?[]}]}",
    `Include relevant assumptions from ${JSON.stringify(ASSUMPTIONS)}`,
    'Set "difficulty" to "easy", "medium", or "hard".',
    "Keep story.* strings compact: <=120 chars (stakes<=200, analogy_seed<=180, visual_motif<=15 words and <=160 chars).",
    "visual_motif must be one concrete object/scene only—no art styles, palettes, resolution tokens, or repeated adjectives.",
    "Parts must be exactly 1=story, 2=intro_quiz, 3=coding_1, 4=coding_2, 5=wrap_up_quiz.",
    "Each parts.summary must be crisp (10-15 words max) and focused on the learner task for that step.",
    "coding_blueprints must have ids p1 and p2.",
    "Promised skills must include every item listed under coding_blueprints.required_skills; add missing skills instead of changing the blueprint requirements.",
    "Concepts_to_teach must be actually used in the parts summaries or coding_blueprints (logic, constraints, or required_skills). Drop any concept from the Markdown that is not used; never invent new ones.",
    "Populate story.* fields from the historical hook (protagonist, anchor event/year/place, stakes, analogy seed, modern tie-in domain, visual motif, naming note when present).",
    "Keep story fields concise, historical, and free of fictional settings.",
    "Output strict JSON only—no analysis, no Markdown, no prose. Start with '{' and end with '}'.",
    "",
    "Markdown ideas:",
    markdown,
  ].join("\n");
}

export function buildPlanEditUserPrompt(
  plan: SessionPlan,
  grade: PlanGrade,
): string {
  return [
    "The following session plan received a failing grade.",
    "Please revise the plan to address the reported issues.",
    "Keep each part summary concise (no more than 15 words).",
    "Promised skills must cover every coding_blueprints.required_skills entry; add the missing skills rather than removing blueprint requirements.",
    "Remove any concepts_to_teach entries that are not used in parts or coding_blueprints; do not invent new concepts.",
    "Output JSON only (no Markdown or commentary).",
    "",
    "Grading Report:",
    `Pass: ${grade.pass}`,
    `Issues: ${grade.issues.join("; ")}`,
    `Missing Skills: ${grade.missing_skills.join("; ")}`,
    `Suggested Edits: ${grade.suggested_edits.join("; ")}`,
    "",
    "Current Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Return the fully corrected SessionPlan JSON.",
  ].join("\n");
}

export function buildPlanGradeUserPrompt(plan: SessionPlan): string {
  return [
    "Check rules:",
    "R1 parts ordered;",
    "R2 promised skills cover blueprint requirements;",
    "R3 concepts_to_teach referenced and manageable;",
    "R4 each parts.summary is concise (<=15 words) and specific;",
    "Output {pass:boolean, issues:string[], missing_skills:string[], suggested_edits:string[]} JSON only.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
  ].join("\n");
}

export const PLAN_PART_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["order", "kind", "summary"],
  propertyOrdering: ["order", "kind", "summary"],
  properties: {
    order: { type: Type.NUMBER, minimum: 1, maximum: 5 },
    kind: {
      type: Type.STRING,
      enum: ["story", "intro_quiz", "coding_1", "coding_2", "wrap_up_quiz"],
    },
    summary: {
      type: Type.STRING,
      minLength: "1",
      maxLength: String(PLAN_LIMITS.partSummary),
    },
  },
};

export const CODING_BLUEPRINT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["id", "title", "idea", "required_skills"],
  propertyOrdering: ["id", "title", "idea", "required_skills", "constraints"],
  properties: {
    id: { type: Type.STRING, enum: ["p1", "p2"] },
    title: {
      type: Type.STRING,
      minLength: "1",
      maxLength: String(PLAN_LIMITS.blueprintTitle),
    },
    idea: {
      type: Type.STRING,
      minLength: "1",
      maxLength: String(PLAN_LIMITS.blueprintIdea),
    },
    required_skills: {
      type: Type.ARRAY,
      minItems: "1",
      items: {
        type: Type.STRING,
        minLength: "1",
        maxLength: String(PLAN_LIMITS.blueprintSkill),
      },
    },
    constraints: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        minLength: "1",
        maxLength: String(PLAN_LIMITS.blueprintConstraint),
      },
    },
  },
};

export const PLAN_PARSE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "topic",
    "difficulty",
    "assumptions",
    "story",
    "parts",
    "promised_skills",
    "concepts_to_teach",
    "coding_blueprints",
  ],
  properties: {
    topic: {
      type: Type.STRING,
      minLength: "1",
      maxLength: String(PLAN_LIMITS.topic),
    },
    difficulty: { type: Type.STRING, enum: ["easy", "medium", "hard"] },
    assumptions: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        minLength: "1",
        maxLength: String(PLAN_LIMITS.assumption),
      },
    },
    story: {
      type: Type.OBJECT,
      required: ["storyTopic"],
      properties: {
        storyTopic: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.storyTopic),
        },
        protagonist: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.protagonist),
        },
        anchor_event: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.anchorEvent),
        },
        anchor_year: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.anchorYear),
        },
        anchor_place: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.anchorPlace),
        },
        stakes: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.stakes),
        },
        analogy_seed: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.analogySeed),
        },
        modern_tie_in: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.modernTieIn),
        },
        visual_motif: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.visualMotif),
        },
        naming_note: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.namingNote),
        },
      },
    },
    parts: {
      type: Type.ARRAY,
      minItems: "5",
      maxItems: "5",
      items: {
        ...PLAN_PART_RESPONSE_SCHEMA,
      },
    },
    promised_skills: {
      type: Type.ARRAY,
      minItems: "1",
      items: {
        type: Type.STRING,
        minLength: "1",
        maxLength: String(PLAN_LIMITS.promisedSkill),
      },
    },
    concepts_to_teach: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        maxLength: String(PLAN_LIMITS.concept),
      },
    },
    coding_blueprints: {
      type: Type.ARRAY,
      minItems: "2",
      maxItems: "2",
      items: {
        ...CODING_BLUEPRINT_RESPONSE_SCHEMA,
      },
    },
  },
};

export const PLAN_GRADE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["pass", "issues", "missing_skills", "suggested_edits"],
  properties: {
    pass: { type: Type.BOOLEAN },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    missing_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggested_edits: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};
