# Sample 1: Y8Lesson-Health-BloodDonations.pdf (synthesis) — Base Quiz

**Quiz title:** GCSE Biology: Blood, Organ and Stem Cell Donation
**Summary:** This quiz assesses understanding of blood, organ, and stem cell donation, covering reasons for donation, processes, and the law in England, with a mix of question types aligned with the OCR GCSE Biology specification. Coverage gaps: The quiz does not cover the specific biological mechanisms of tissue matching or rejection, nor detailed ethical considerations from different faith perspectives, as these were not detailed in the source material.

## Metadata

- Mode: synthesis
- Subject: biology
- Exam board: OCR
- Question count: 6
- Generated at: 2025-09-25T07:18:49.612Z
- Model: gemini-2.5-pro (temperature 0.20)
- Source: Y8Lesson-Health-BloodDonations.pdf (data/samples/no-questions/Y8Lesson-Health-BloodDonations.pdf)

## Questions

### 1. One organ donor can save or transform the lives of up to how many people?

- Type: numeric
- Topic: Organ Donation
- Difficulty: foundation
- Skill focus: Recall factual information
- Source reference: Page 11
- Answer: 9

> The information on page 11 states that 'One organ donor can save and transform up to nine lives and many more by donating tissue.'

### 2. Which of the following conditions would most likely require a stem cell donation?

- Type: multiple_choice
- Topic: Stem Cell Donation
- Difficulty: intermediate
- Skill focus: Apply knowledge to a specific context
- Source reference: Page 5
- Answer: Blood cancer
- Options:
  - A. Blood loss from surgery
  - B. A birth defect affecting the heart
  - C. Blood cancer
  - D. An organ damaged by injury

> Page 5 identifies that 'Someone with blood cancer or a blood disorder' might need a stem cell donation.

### 3. True or False: Under the 'opt-out' organ donation law in England, the family of a potential donor is not consulted if the deceased had not registered a decision.

- Type: true_false
- Topic: Organ Donation Law
- Difficulty: intermediate
- Skill focus: Interpret legal and ethical guidelines
- Source reference: Page 13
- Answer: False

> This is false. Page 13 clarifies that even with the opt-out system, 'families will still be consulted around organ donation and their faiths, beliefs and culture will continue to be respected.'

### 4. Stem cell donation can be carried out in two ways. Name both methods.

- Type: short_answer
- Topic: Stem Cell Donation
- Difficulty: foundation
- Skill focus: Recall a process
- Source reference: Page 10
- Answer: Through the bloodstream and via a bone marrow donation procedure.

> Page 10 outlines the two methods of stem cell donation: 'through the bloodstream (90% of donors)' and 'bone marrow donation procedure (10% of donors)'.

### 5. What is the minimum age to register as a blood donor and the minimum age to give blood for the first time, respectively?

- Type: multiple_choice
- Topic: Blood Donation
- Difficulty: intermediate
- Skill focus: Extract specific data from a diagram
- Source reference: Page 8
- Answer: 16 and 17
- Options:
  - A. 16 and 16
  - B. 16 and 17
  - C. 17 and 17
  - D. 17 and 18

> Page 8 shows that individuals can 'Register online from 16+' (step 1), but 'Registered donors book an appointment' to donate 'from 17+' (step 2).

### 6. A single blood donation can be split into component parts to help multiple patients. How many adults can one donation help?

- Type: numeric
- Topic: Blood Donation
- Difficulty: foundation
- Skill focus: Extract data from text
- Source reference: Page 8
- Answer: 3

> According to the diagram on page 8, a donor's blood is split into component parts, 'so each donation can help 3 adults or 6 infants.'

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
