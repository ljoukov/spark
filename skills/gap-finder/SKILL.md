---
name: gap-finder
description: Use when turning newly graded low-score worksheet questions into concise, deduplicated Spark practice gaps.
---

# Gap Finder

Use this skill to convert graded worksheet weaknesses into short practice-gap cards. A gap is not a dashboard, scorecard, generic feedback summary, encouragement, or a broad list of strengths and weaknesses. It is a focused practice problem with a short learning flow.

## Inputs

- `gaps/input/new-runs.json`
- `gaps/input/existing-gaps.json`
- staged worksheet reports under `gaps/input/reports/`
- weak-question candidates with source question text, student answer, grading note, awarded marks, total marks, subject, and paper metadata

## Gap Types

- `knowledge_gap`: the student is missing a clear fact, definition, process, sequence, rule, equation, or basic conceptual link. Use this when the next learning step is to learn or retrieve the idea.
- `misconception`: the student likely holds a wrong mental model or has confused two related ideas. Use this when the answer suggests a common false belief or concept conflict that needs correcting.
- `oversight`: the student likely knew the content but lost marks through exam technique, missing units, incomplete calculation, weak comparison wording, not using the command word, or a careless transcription/calculation mistake.

## Selection Rules

- Prefer questions with 0 marks, 1 out of 4 marks, or half-or-less marks on multi-mark questions.
- Treat 2 out of 3 marks as usually okay. Create a gap only when the grader note identifies a serious misconception or a high-leverage missing idea.
- Create only the most useful gaps. It is valid to create zero gaps from a weak question if it duplicates an existing gap or is too vague.
- Omit duplicate gaps, including repeated submissions of the same paper. Use existing gaps and stable `dedupeKey` values to avoid repetition.
- If the original problem is too broad for one card, split it into 1 to 3 small focused gaps.
- Do not create a gap from a mark loss that is only administrative, unreadable, or impossible to practice without the original source.
- Do not create a gap from a paper-level grade, prize, medal, or boundary outcome alone. Gaps must come from question-level weaknesses.

## Card Wording

- `cardQuestion` must be one short sentence, or at most two short sentences.
- Make the card self-contained. Include enough context from the source sheet that the student can solve it without seeing the original paper.
- Prefer a tighter formulation when the original prompt is long, but preserve exact key terms, units, quantities, and command-word requirements.
- For calculation gaps, include the values and units needed for the practice step.
- For source-based gaps, include the minimum source detail needed to practise the skill; do not refer vaguely to "the figure above" unless the generated card will also include the necessary context.
- `title` should name the concept or exam skill, not the paper or question number.
- `shortRationale` should say why this gap exists in one concise sentence.

## Learning Flow

- Each gap must contain a short slide chain that leads the student toward a GCSE model answer.
- Use 3 to 12 steps.
- Prefer `free_text` steps. Use `multiple_choice` rarely, only when the options are substantial and useful.
- Make every `free_text` prompt a small reasoning check. The expected answer should be short and markable.
- Every step may include `label`: a catchy 2 to 4 word student-facing tag specific to the concept being practised, such as `Water potential`, `Osmosis move`, `Guard-cell shape`, `Percent conversion`, or `Command word`.
- Never use generic labels such as `Step`, `Slide`, `Stepping stone`, or internal planning labels.
- End the chain with one `model_answer` step and one `memory_chain` step.
- The `model_answer` step should combine the preceding answers into a GCSE model answer.
- The `memory_chain` step should be very short, for example: `glucose up -> water potential down -> water enters -> turgid -> stoma opens`.

## Output Contract

Return JSON only.

The top-level JSON must be an object with one key:

```json
{
  "gaps": []
}
```

Each gap object must use exactly these keys:

- `sourceCandidateId`
- `type`
- `title`
- `cardQuestion`
- `shortRationale`
- `dedupeKey`
- `severity`
- `steps`

Use `sourceCandidateId` values exactly as provided.

`severity` is an integer from 1 to 5. Use 5 only for repeated or foundational gaps that will block many later questions; use 1 for minor technique lapses.

Each step object must use `kind` plus the fields needed by that kind:

- `free_text`: `prompt`, `expectedAnswer`, `modelAnswer`, `markScheme`, optional `gradingPrompt`, optional `maxMarks`, optional `placeholder`, optional `label`.
- `multiple_choice`: `prompt`, `options`, `correctOptionId`, `explanation`, optional `label`.
- `model_answer`: `prompt`, `body`, optional `label`.
- `memory_chain`: `prompt`, `body`, optional `label`.

Do not use keys such as `slides`, `learningSteps`, `category`, `gapType`, `question`, `answerChain`, or `dashboard`.

## Quality Gate

Before returning gaps:

- Check that every new gap is deduped against existing gaps and against the other new gaps.
- Check that every gap is useful without opening the original worksheet.
- Check that every free-text step has a short expected answer and a mark scheme that matches it.
- Check that every chain ends with both `model_answer` and `memory_chain`.
- Check that no step reveals the final model answer before the learner has done useful retrieval or reasoning.
- Check that the output is parseable JSON and uses only the allowed fields.
