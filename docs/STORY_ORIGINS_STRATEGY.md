# Story Narrative Reliability Strategy

This document captures the topic-agnostic guardrails we will implement in the story generation pipeline. The goal is to reduce catastrophic factual errors while keeping the narrative clear and memorable for 12–16 year old learners.

## Objectives

- **Stability for young learners:** Prefer classical, widely taught attribution and wording that aligns with mainstream curricula. When historians uncover new nuances, we can introduce them later in follow-on lessons once the broader consensus is established.
- **Topic-agnostic tooling:** The same safeguards must work across all CS concepts; no hard-coded references to specific people or algorithms.
- **Low cognitive load:** Limit the number of named figures and avoid turning the story into a dense history recap. Neutral hedges (“… and others”) are preferable to long enumerations.
- **Reliable prompts & validation:** Ensure prompts and validators collaborate so the model cannot silently misattribute origins, names, or modern applications.

## Strategy Summary

| #   | Strategy                            | Purpose                                                                      |
| --- | ----------------------------------- | ---------------------------------------------------------------------------- |
| 1   | **Origins Capsule**                 | Insert a validated two-sentence historical anchor before drafting the story. |
| 2   | **Naming & Exclusivity Guardrails** | Push neutral naming and non-exclusive language in the narrative prompts.     |
| 3   | **Modern Tie-in Policy**            | Keep modern connections hedged and honest, with pre-approved templates.      |
| 5   | **Structured Validator Feedback**   | Return normalized blockers that the editor must fix explicitly.              |

## Strategy 1 — Origins Capsule

### Why

Origins and naming disputes triggered factual failures in the logs. A small, high-confidence factual core helps every stage stay aligned without hard-coding a specific topic.

### Implementation Outline

1. **New micro-stage:** `generateOriginsCapsule(topic, research)` outputs two sentences.
2. **Prompt (topic-agnostic):**
   - Role: “Write a 2-sentence Origins Capsule for {topic}.”
   - Policy: Prefer classical, widely taught attribution; use hedges for low-confidence claims; avoid lists and coinage assertions.
   - Sentence structure:
     1. Classical anchor with neutral verb (“described”, “published”, “popularized”) + approximate timing + “now known as …”.
     2. Nuance sentence acknowledging parallel/earlier work via hedges (“independently developed”, “… and others”, “later published”).
   - ≤ 40 words, no citations, no absolutes unless high confidence.
3. **Validation:** Run the factual checker on the capsule. On failure, retry with heavier hedging or drop questionable names.
4. **Downstream usage:** Pass the frozen capsule text into Prompt 2 (Narrative Weaver) and Prompt 3 (Editor’s Cut). They may paraphrase lightly, but names, titles, and timing semantics must remain.

### Notes

- This micro-stage must be topic-agnostic, using only research metadata the pipeline already gathers.
- Prefer “classical” or “widely taught” anchors to keep stories memorable; we will add nuance only when it is widely accepted.

## Strategy 2 — Naming & Exclusivity Guardrails

### Prompt 2 (Narrative Weaver) Updates

- Add explicit guardrails:
  - Use neutral naming phrases: “now known as”, “often called”, “widely referred to as”.
  - Do **not** claim a person “coined”, “named”, or “formalized” the term unless the capsule marked the claim as high-confidence and mainstream.
  - Avoid “first/sole” origin claims; prefer “credited to”, “among early contributors”, or “… and others”.
  - Include the Origins Capsule in the first half of the story. Light paraphrasing is OK, but do not change factual semantics.
- Memorability reminder: limit to one named figure or institution unless more are essential and high-confidence.

### Prompt 3 (Editor’s Cut) Updates

- Reaffirm the same guardrails and require the editor to protect the capsule facts.
- If a draft contains exclusive or coinage claims, the editor must replace them with neutral wording.
- Keep the story crisp and focused—hedges replace long name lists.

## Strategy 3 — Modern Tie-in Policy

### Prompt 2 Additions

- Modern tie-in must appear only in the final paragraph.
- Provide pre-approved hedged templates; the model must pick one:
  1. “Today, related algorithms and heuristics in {application domain} build on this idea; the exact choice depends on costs, constraints, and data. You’ll learn the details here and practice them in short challenges.”
  2. “You’ll spot echoes of this idea in modern {application domain} tools. They adapt it with weights and heuristics when real-world factors matter. In this lesson you’ll learn the core and master it in programming challenges.”
  3. “This idea sits under the hood of many systems, often in adapted forms. We’ll cover the essentials now, and you’ll apply them in the challenges that follow.”
- These templates emphasize adaptation, not one-to-one implementation.

### Prompt 3 Enforcement

- If the draft asserts “Technology X uses Algorithm Y” directly, the editor must switch to one of the templates.

### Validator Behavior

- Treat the absence of hedging as a blocking `modernTieInOverclaim`.
- Accept any of the approved templates without further scrutiny.

## Strategy 5 — Structured Validator Feedback

### Fact-Check Prompt Adjustments

- Update instructions:
  - We protect young learners by sticking with classical, widely taught anchors. When prose uses neutral hedges (“… and others”) and avoids exclusivity, do **not** fail the story for omitting additional names.
  - Fail only on catastrophic issues: wrong names/titles/dates, misattributed naming, sole-origin claims, overclaimed modern ties.
- Require each issue to start with `Tag: <taxonomy>` where taxonomy ∈ { namingAttribution, exclusivityClaim, modernTieInOverclaim, datePrecision, wrongEntity, other }.

### Parsing & Feedback

- Map tags to a normalized blockers object, e.g.:
  ```json
  {
    "namingAttribution": true,
    "exclusivityClaim": false,
    "modernTieInOverclaim": true,
    "datePrecision": "recommend-hedge",
    "wrongEntity": false
  }
  ```
- Build direct remediation messages:
  - `namingAttribution`: “Replace ‘coined/named/formalized by’ with neutral ‘now known as / widely called’ phrasing.”
  - `exclusivityClaim`: “Remove exclusive ‘first/sole’ claims; use ‘credited among’ or hedged wording.”
  - `modernTieInOverclaim`: “Switch the ending to one of the hedged modern-connection templates.”
  - `datePrecision`: “Use an approximate era (‘late 19xx’) unless high confidence.”
  - `wrongEntity`: “Correct names/titles/institutions to mainstream textbook versions.”

### Prompt 3 Fix Checklist

- Require the editor to output a `fixChecklist` indicating each blocker was resolved. Either extend the JSON schema or add a plain-text section after the JSON. Example:
  ```json
  "fixChecklist": {
    "namingAttribution": true,
    "exclusivityClaim": true,
    "modernTieInOverclaim": true,
    "datePrecision": "hedged",
    "wrongEntity": true
  }
  ```
- Editor must not mark a fix as true unless the revised story visibly addresses it.

## Acceptance Criteria (Functional)

- Origins Capsule passes fact-check and shows up (with consistent semantics) in the story.
- Stories use neutral naming and non-exclusive phrasing by default.
- Modern connections use hedged templates; direct overclaims are blocked.
- Validator supplies structured blockers; the editor’s fixChecklist reflects actual revisions.
- Stories remain memorable: typically a single named figure, classical anchor intact.
- Neutral generalizations (e.g., “… and others”) no longer trigger unnecessary failures.

## Additional Notes

- Update `docs/SPEC.md` after implementation to reference this strategy.

## Out of Scope

- Allow the capsule generator to return confidence metadata, enabling dynamic decisions about when to name additional contributors.
