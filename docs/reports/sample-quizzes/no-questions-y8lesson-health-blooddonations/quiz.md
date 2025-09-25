# Sample 1: Y8Lesson-Health-BloodDonations.pdf (synthesis) — Base Quiz

**Quiz title:** GCSE Biology: Blood, Organ, and Stem Cell Donation
**Summary:** This quiz assesses understanding of blood, organ, and stem cell donation, covering reasons, processes, and the law in England, with multiple choice, short answer, true/false, and numeric questions aligned with the OCR specification. Coverage gaps: The quiz does not assess the specific considerations involved in an individual's choice to donate or not to donate, as the source material presents these as discussion points rather than factual content.

## Metadata

- Mode: synthesis
- Subject: biology
- Exam board: OCR
- Question count: 6
- Generated at: 2025-09-25T22:23:51.126Z
- Model: gemini-2.5-pro (temperature 0.20)
- Source: Y8Lesson-Health-BloodDonations.pdf (data/samples/no-questions/Y8Lesson-Health-BloodDonations.pdf)

## Questions

### 1. How many new blood donors are needed every day in England to meet demand?

- Type: numeric
- Topic: Blood Donation
- Difficulty: foundation
- Skill focus: Recall factual data
- Source reference: Page 6
- Answer: 400

> The material states on the 'Why are donations important?' slide that 'Nearly 400 new blood donors are needed every day in England to meet demand.'

### 2. Which of the following is a primary reason a person might need a stem cell donation?

- Type: multiple_choice
- Topic: Stem Cell Donation
- Difficulty: intermediate
- Skill focus: Differentiate between donation types
- Source reference: Page 5
- Answer: Blood cancer or a blood disorder
- Options:
  - A. Blood loss from an accident
  - B. A birth defect affecting an organ
  - C. Blood cancer or a blood disorder
  - D. Organ damage from an injury

> The slide 'Who might need each type of donation?' specifies that stem cell donations are for 'Someone with blood cancer or a blood disorder.'

### 3. True or false: Under the organ donation law in England introduced in 2020, the family of a potential donor is no longer consulted about the decision.

- Type: true_false
- Topic: Organ Donation Law
- Difficulty: intermediate
- Skill focus: Understand legal frameworks
- Source reference: Page 13
- Answer: False

> The material explicitly states that 'families will still be consulted around organ donation and their faiths, beliefs and culture will continue to be respected.'

### 4. State the two methods by which stem cells can be donated.

- Type: short_answer
- Topic: Stem Cell Donation
- Difficulty: foundation
- Skill focus: Recall procedural steps
- Source reference: Page 10
- Answer: Through the bloodstream and through a bone marrow donation procedure.

> The presentation slide on the stem cell donation process lists two ways: 'through the bloodstream (90% of donors)' and 'bone marrow donation procedure (10% of donors)'.

### 5. According to the NHS information provided, a single blood donation can be split into component parts to help a specific number of adults. What is this number?

- Type: numeric
- Topic: Blood Donation
- Difficulty: foundation
- Skill focus: Extract data from a diagram
- Source reference: Page 8
- Answer: 3

> The infographic on being a blood donor states that 'each donation can help 3 adults or 6 infants.'

### 6. According to the information provided, what is the first action a person should take if they wish to become an organ donor, and what subsequent action is also recommended?

- Type: short_answer
- Topic: Organ Donation Process
- Difficulty: intermediate
- Skill focus: Recall procedural steps
- Source reference: Page 11
- Answer: They should register their decision on the NHS Organ Donation Register. They should also share their decision with their family or loved ones.

> Step 1 in the process for being an organ donor is to 'Register the decision to donate organs and/or tissue after death on the NHS Organ Donation Register. Share the decision with family/loved ones.'

## Prompt

```
You are Spark's GCSE Triple Science quiz builder. Work strictly from the supplied study material.
The material does not contain explicit questions. Synthesize rigorous GCSE questions.
Mix short_answer, multiple_choice, true_false, and numeric items.
Ground every answer and explanation directly in the supplied notes.
Always write in UK English and reference the specification where relevant.
You must return exactly 6 questions.
Prioritise coverage breadth over repetition. If the source has more material than fits, select items so every key theme is still assessed.
Summaries and field values must never claim coverage that the questions do not provide; explicitly note any unavoidable omissions.
Return JSON that matches the provided schema. Field guidance:
- quizTitle: Concise, exam-style title for the quiz.
- summary: Two sentences. Sentence one states the scope, question types, and syllabus link. Sentence two must begin with "Coverage gaps:" and either say "none – full coverage achieved." or list the specific missing topics/processes.
- mode: Set to the provided mode value.
- subject: Copy the provided subject exactly.
- board: Copy the provided exam board exactly.
- syllabusAlignment: Brief note (<120 chars) naming the GCSE Triple Science topic or module.
- questionCount: Must equal the number of questions returned.
- questions: Array of question objects defined below.
Each question object must include:
- id: Match the original question identifier when present (e.g., "Q1a"). Otherwise use sequential IDs ("Q1", "Q2", ...).
- prompt: Clean exam-ready wording that still mirrors the source task.
- answer: Correct, concise answer text.
- explanation: One to two sentences justifying the answer with source evidence.
- type: One of multiple_choice, short_answer, true_false, or numeric.
- options: Only for multiple_choice. Provide exactly four answer texts without prefixing letters—the system adds labels.
- topic: Short topic label (e.g., "Atomic structure").
- difficulty: Use foundation, intermediate, or higher.
- skillFocus: Action-oriented description of the assessed skill (e.g., "Interpret data", "Explain process").
- sourceReference: Precise citation (page, question number, or caption) so humans can trace the origin. Do not fabricate references.
- Always correct typographical or scientific errors from the source (e.g., prefer the standard UK spelling "phosphorus" even if the source writes "phosphorous").
- Keep prompts, requested counts, and answers aligned. If a question asks for a specific number of items, return exactly that many in the answer after choosing the most representative examples, or adjust the prompt text so the count and answer match.
- Tighten ambiguous wording when needed so the scientific term is explicit (e.g., say "relative atomic mass" rather than the vague "relative mass").
Subject focus: biology.
Exam board context: OCR.
Include concise sourceReference entries when you can identify page numbers, prompts or captions.
If the material lacks enough detail for a requirement, explain the limitation in the summary.
Verify that ids and sourceReference values align with the original numbering before returning the JSON.
```
