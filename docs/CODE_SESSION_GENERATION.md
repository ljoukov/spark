# CODE Session Generation

## Overview

- Generate full lesson sessions from a `topic`, producing plan → coding problems → quizzes (warm-up and wrap-up), plus an introductory story.
- Every artifact uses a two-pass Generate → Grade cycle with strict schema outputs (JSON) except ideation phases (Markdown).
- The session pipeline adopts the checkpointing pattern established in `packages/llm/src/code/generateStory.ts` so work can resume mid-stage.

## Learner Assumptions

Hard code in a variable the following assumption about the student (we will later have these loaded from student profile):

- Students already know: basic Python syntax, lists, integer division `//`, modulo `%`.
- If a lesson introduces dicts, sets, or a new algorithm, the intro quiz must teach it before coding challenges reinforce it.
- Coding problems remain “easy” difficulty; constrain inputs and walkthroughs accordingly.

## Data Model

### Plan JSON

- `topic: string`
- `difficulty: "easy"`
- `assumptions: string[]` (default: `["basic Python syntax", "lists", "integer division (//)", "modulo (%)"]`)
- `story: { storyTopic: string }` topic as formulated for the story including idea for what will be covered in the lesson
- `parts: Array<{ order: 1|2|3|4|5; kind: "story"|"intro_quiz"|"coding_1"|"coding_2"|"wrap_up_quiz"; summary: string }>` — keep each summary concise (10-15 words)
- `promised_skills: string[]` (micro-skills the session promises)
- `concepts_to_teach: string[]` (new concepts, if any)
- `coding_blueprints: Array<{ id: "p1"|"p2"; title: string; idea: string; required_skills: string[]; constraints?: string[] }>`

### Quiz JSON

- `quiz_id: "intro_quiz"|"wrap_up_quiz"`
- `theory_blocks?: Array<{ id: string; title: string; content_md: string }>`
- `questions: Array<{ id: string; type: "mcq"|"multi"|"short"|"numeric"|"code_reading"; prompt: string; options?: string[]; correct: string|string[]; explanation: string; tags: string[]; covers_techniques: string[] }>`

### Coding Problem JSON

- `id: "p1"|"p2"`
- `title: string`
- `difficulty: "easy"`
- `story_callback: string`
- `statement_md: string`
- `function: { name: string; signature: string; params: Array<{ name: string; type: string }>; returns: string }`
- `constraints: string[]`
- `examples: Array<{ input: string; output: string; explanation?: string }>`
- `edge_cases: string[]`
- `hints: string[]`
- `solution_overview_md: string`
- `reference_solution_py: string`
- `tests: { public: Array<{ input: string; output: string }>; private_count: number }`

## Pipeline

1. Plan-Ideas (Markdown, ≥3 ideas)
2. Plan-Parse (Markdown → Plan JSON)
3. Plan-Grade (QA JSON)
4. Problem-Techniques (JSON list of required techniques per problem id)
5. Coding-Problem-Ideas (Markdown)
6. Coding-Problems-Generate (JSON)
7. Coding-Problems-Grade (QA JSON)
8. Independent solutioning: solve each problem from statement + examples only, validate against generated tests, persist canonical solution
9. Quiz-Ideas (Markdown coverage referencing techniques and problems)
10. Quizzes-Generate (JSON)
11. Quizzes-Grade (QA JSON)
12. Quiz Answer Grading (per student response)
13. Student Code Grading (tests first, optional LLM feedback)

## Prompt Templates

Prompts below assume structured calls via `generateSession.ts`. Substitute `{{…}}` placeholders at runtime.

### Plan-Ideas Generation

- **System**
  - Expert CS educator generating engaging beginner-friendly Python lesson ideas. Produce diverse concepts that align story, promised skills, and five-part progression. Difficulty is “easy”; assume base knowledge listed above. Call out new concepts when needed.
- **User**
  - Topic: “{{topic}}”
  - Task: Produce ≥3 lesson ideas in Markdown. Each idea includes Title, Story paragraph ending with `in todays's lesson...`, Five-Part Progression (1 story, 2 intro/quiz, 3 first coding problem, 4 second coding problem, 5 wrap up quiz), Promised Skills bullets, Concepts To Teach list, and two Coding Blueprints (one-liners with required skills). Output Markdown only, no JSON, no code fences, headings “Idea 1/2/3”.

### Plan-Parse

- **System**
  - Convert Markdown ideas into plan JSON. Enforce ordering, coverage of required skills, and difficulty.
- **User**
  - Schema: `{topic, difficulty, assumptions, storyTopic, parts[{order,kind,summary}], promised_skills[], concepts_to_teach[], coding_blueprints[{id,title,idea,required_skills[],constraints?[]}]}`.
  - Include assumptions `["basic Python syntax","lists","integer division (//)","modulo (%)"]`.
  - Parts must be exactly 1=storyTopic, 2=intro_quiz, 3=coding_1, 4=coding_2, 5=wrap_up_quiz.
  - `coding_blueprints` must have ids `p1` and `p2`.
  - Output strict JSON only.
  - Body includes the Markdown ideas block.

### Plan-Grade

- **System**
  - Rubric QA, diagnose only.
- **User**
  - Check rules: R1 parts ordered; R2 promised skills cover blueprint requirements; R3 concepts_to_teach referenced and manageable; R5 difficulty “easy”. Output `{pass:boolean, issues:string[], missing_skills:string[], suggested_edits:string[]}` JSON only.

### Problem-Techniques

- **System**
  - List concrete techniques learners must know before solving the problems.
- **User**
  - Extract techniques from coding blueprints and promised skills. Include algorithms, patterns, invariants, decomposition steps, edge cases, and data structure choices. Output `{topic, techniques:[{id,title,summary,applies_to:["p1"|"p2"],tags[]}]}`
    where ids are short tokens (t1, t2, ...), summaries mention why/when to use the technique, applies_to lists p1/p2, and tags align to promised skills/concepts.

### Quiz-Ideas

- **System**
  - Expand plan into quiz coverage ensuring primers precede practice and every required technique is taught before coding.
- **User**
  - Provide Markdown describing intro and wrap-up quiz coverage. Include theory primers when a technique or concept is not in assumptions; list question stems with types; map stems to promised skills AND technique ids. Call out which techniques are taught in theory blocks and practiced (especially in the intro quiz). Output Markdown only.

### Quizzes-Generate

- **System**
  - Produce final quizzes with concise explanations, optional theory blocks, and explicit technique coverage.
- **User**
  - Generate JSON for `intro_quiz` and `wrap_up_quiz`. Each uses 4 questions; include varied types. Intro quiz must teach every technique required for p1/p2 before coding with at least one question per technique. Add theory blocks before first use when techniques/concepts are new. Each question includes `covers_techniques` (ids from the techniques list), `tags` (skills/concepts/techniques), concise explanations, and optional theory blocks. Output strict JSON only.

### Quizzes-Grade

- **System**
  - QA quizzes for coverage, theory, clarity, and technique readiness.
- **User**
  - Ensure all required skills covered, theory blocks present when needed, answers unambiguous, explanations correct, and every technique appears in the intro quiz (via `covers_techniques`). Output `{pass:boolean, issues:string[], uncovered_skills:string[], missing_theory_for_concepts:string[], missing_techniques:string[]}` JSON only.

### Quiz Answer Grading

- **System**
  - Grade individual answers (exact match for objective types; semantic check for short answers).
- **User**
  - Input `question` JSON and `Student Answer`. Output `{score:0|0.5|1, correct:boolean, feedback:string}`.

### Coding Problem Ideas

- **System**
  - Generate two easy ideas aligned with promised skills, story, and the listed techniques.
- **User**
  - Markdown output summarizing each problem: Title, One-line Pitch, Story alignment, Required Skills, Any New Concept, Example I/O. No advanced structures unless declared; stay within the supplied techniques for each problem id.

### Coding Problems-Generate

- **System**
  - Produce full beginner-friendly specs with reference solutions and tests.
- **User**
  - Generate JSON objects (ids `p1`, `p2`) matching the schema above. Include story callback, constraints, 2–3 total examples (≥1 per problem), public tests (3–5 each) and private test count (3–8). Solutions must be simple Python 3 and rely only on the provided techniques (no new advanced techniques). Output strict JSON only.

### Coding Problems-Grade

- **System**
  - QA problems for alignment, clarity, and difficulty.
- **User**
  - Check each problem is “easy”, specs precise, skills aligned, reference solutions correct. Output `{pass:boolean, issues:string[], too_hard_reasons:string[], misaligned_skills:string[]}` JSON only.

### Student Code Grading (Optional Feedback)

- Primary grading: automated tests. Optional LLM feedback:
  - **System**: Beginner-friendly reviewer giving short, constructive feedback without revealing private tests.
  - **User**: Provide problem (without reference solution), public tests, student code, public test results. Output `{summary:string, likely_bug:string, suggestions:string[]}`.

## Checkpointing Strategy

- Adopt the staged checkpoint pipeline from `generateStory.ts`.
- Stage order for session generation: `plan_ideas` → `plan` → `plan_grade` → `problem_techniques` → `problem_ideas` → `problems` → `problems_grade` → `quiz_ideas` → `quizzes` → `quizzes_grade`. Story generation retains its own stages (`idea`, `origins_capsule`, `prose`, `prose-revision`, `segmentation`, `segmentation_correction`, `images`, `narration`).
- `generateSession.ts` accepts `checkpointDir`; stage files live at `<checkpointDir>/<stage>.json`.
- For Markdown outputs, store JSON payloads with `{ topic, markdown: string }`. All checkpoints include `topic` for validation.
- Reading a checkpoint:
  - Parse JSON, ensure `topic` matches, validate with zod schema (`safeParse`). If mismatch, ignore and regenerate.
- Writing a checkpoint:
  - `JSON.stringify(payload, null, 2)` for readability. Include `topic`.
- Cache + invalidation:
  - Maintain in-memory caches per stage.
  - `invalidateAfter(stage)` clears downstream caches, deletes downstream checkpoint files, mirroring `StoryGenerationPipeline`.
- Logging:
  - Log restores (`[session/checkpoint] restored '<stage>' from <path>`) and writes (`[session/checkpoint] wrote '<stage>' to <path>`).
- Attempts and retries:
  - For brittle stages (e.g., plan ideas), allow limited retries (`attempt-01-of-03`), logging attempt IDs and nesting debug directories if `debugRootDir` provided.
- Determinism:
  - Thread `seed`, `topic`, `difficulty`, and `assumptions` through prompts to minimise drift.
- Storage paths:
  - When storing paths (future expansion), normalise to forward slashes and strip leading slashes (see `normaliseStoragePath` in `generateStory.ts`).

## Integration Notes (`generateSession.ts`)

- Accept options: `topic`, optional `seed`, `checkpointDir`, `debugRootDir`, `progress` reporter, question count overrides.
- Sequence:
  - `ensurePlanIdeas` → `ensurePlan` → `ensurePlanGrade`.
  - `ensureProblemTechniques` → `ensureProblemIdeas` → `ensureProblems` → `ensureProblemsGrade`.
  - `ensureQuizIdeas` → `ensureQuizzes` → `ensureQuizzesGrade` (quizzes generated after problems so the intro quiz teaches the techniques needed).
  - For the story PlanItem, call `generateStory` with matching `checkpointDir` / `debugRootDir`.
- On QA failure, iterate by regenerating the minimal failing stage (e.g., select next plan idea, adjust quiz coverage).
- Filter disallowed topics before prompting; otherwise constrain outputs to CS education.

## Consistency Rules

- Story must hint onto problems and quizes which will be in the lesson; quizzes and problems reference the story promise and promised skills. This does NOT have to be super strict, it is ok to hint in the story at one of the aspects, select the most interesting or intribguing or most classical or famous one.
- Every `coding_blueprints[*].required_skills` appears across the two quizzes.
- Intro quiz must teach every problem-solving technique needed for p1/p2 (via `covers_techniques`) with theory blocks if a technique or concept is new.
- Story generation uses lesson context (promised skills, techniques, problem hooks) to foreshadow the key trick and hand off to the warm-up quiz; it must not introduce new advanced concepts.
- Maintain “easy” difficulty by constraining inputs, providing primers, and keeping solutions straightforward.
- Ideation prompts (plan/quiz/problem ideas) return Markdown only; final artifacts and checkpoints must be strict JSON.
- Update `docs/SPEC.md` when UI/UX flows change (e.g., progression structure) to keep the source of truth synchronized.
