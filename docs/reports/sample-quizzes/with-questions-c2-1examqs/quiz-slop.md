# Sample 4: C2.1ExamQs.pdf (extraction) — Base Quiz Slop Detection

**Model risk label:** slop
**Weighted risk:** 0.550 (threshold 0.55)
**Model confidence:** 0.90 (LLM flagged slop)
**Annoyance rating:** 4/5

## Top fixes

- Incorporate the missing 'Figure 1' and 'Figure 2' so that questions 2, 3, and 5 are answerable.

## Axis scores

- **Density** — score 0.0
  - The text is concise and information-rich, with no filler language. It is direct and suitable for its purpose as a quiz.
- **Relevance** — score 1.0
  - The title includes "Chemical Reactions," but only one of six questions addresses this, making the title slightly misleading. The focus is on states of matter.
  - Spans:
    - [26, 65) “States of Matter and Chemical Reactions”
- **Factuality** — score 4.0
  - The text is unusable as a standalone quiz. Three of the six questions refer to "Figure 1" and "Figure 2," which are not provided.
  - Spans:
    - [574, 588) “Figure 1 shows”
    - [933, 954) “Referring to Figure 1”
    - [1530, 1544) “Figure 2 shows”
- **Bias** — score 0.0
  - The text is an objective set of science questions and answers, showing no bias or unjustified subjectivity.
- **Structure** — score 2.0
  - The quiz follows a rigid, repetitive template for each question (Topic, Difficulty, Skill focus, etc.), which is functional but highly formulaic.
  - Spans:
    - [472, 590) “Topic: Chemical reactions and equations
Difficulty: intermediate
Skill focus: Application of knowledge, recall of state symbols”
    - [789, 910) “Topic: States of matter and changes of state
Difficulty: intermediate
Skill focus: Data analysis, graph interpretation”
- **Coherence** — score 4.0
  - The logical flow is completely broken. The reader is repeatedly asked to analyze figures that are missing, making half of the quiz incomprehensible and unsolvable.
  - Spans:
    - [570, 728) “Q2: Figure 1 shows the melting points and boiling points of four substances, A, B, C and D. Which substance is liquid over the greatest temperature range?”
    - [1526, 1750) “Q5: Figure 2 shows apparatus used to determine the melting and boiling points of substance B. Explain why this apparatus could not be used to determine the boiling point of substance B.”
- **Tone** — score 0.0
  - The tone is formal, clear, and perfectly suited for a GCSE-level educational assessment. It is neither too simple nor overly complex.

## Auto signals

- tokens: 683
- sentences: 46
- words: 683
- info_entropy_mean: 7.0114
- info_entropy_stddev: 1.6164
- idea_density: 8.3478
- repetition_compression_ratio: 0.291
- templates_per_token: 0.4275
- subj_lexicon_ratio: 0
- avg_sentence_len: 14.8478
- flesch_reading_ease: 57.25
- fk_grade: 8.96
- gunning_fog: 12.15

## Prompt

```
You are a meticulous copy editor. Judge the quality of the given text — not whether it is AI-written.
Work in three passes: (1) skim and summarise the purpose/audience; (2) extract minimal spans proving issues; (3) score each axis 0-4 with ≤25 word rationale, then produce JSON.
General guidance: focus on reader value, consider context, and code the single most significant issue per span. Prefer precise spans over long quotes.
Rubric:
- Density — flag filler or low-information wording. 0=clean, 4=pervasive filler.
- Relevance — stays on task; penalise tangents. 0=on-task, 4=mostly irrelevant.
- Factuality — accuracy and hallucinations. 0=correct, 4=core fabrications.
- Bias — unjustified subjectivity or missing POV. 0=balanced, 4=pervasive skew.
- Structure — repetition or templated phrasing. 0=varied, 4=formulaic skeleton.
- Coherence — logical flow. 0=flows, 4=incoherent or contradictory.
- Tone — fluency, verbosity, complexity. 0=natural, 4=burdens comprehension.
Scoring scale:
- 0 — no issue observed.
- 1 — slight issue; isolated.
- 2 — recurring issue in local spans.
- 3 — major issue across sections.
- 4 — severe issue dominating the text.
Domain weighting guidance:
- News: emphasise Density, Relevance, Tone, Coherence, Bias.
- QA: emphasise Factuality and Structure; Density/Relevance secondary.
- Other: average of the two profiles.
When quoting spans include char_start and char_end indices from the TEXT block (0-indexed, inclusive/exclusive).
For each axis include an auto_signals array of {"name":<metric>,"value":<number>} entries (max 4) using the most relevant metrics from AUTO_SIGNALS.
After scoring compute domain-weighted risk = Σ((score/4)×weight). Use threshold 0.55 to set overall_slop.label (1=slop,0=clean). Confidence should reflect certainty in that label.
Return JSON only, matching the schema.
DOMAIN: qa
CONTEXT: This quiz covers key concepts in GCSE Chemistry, focusing on states of matter, changes of state, interpretation of melting and boiling point data from graphs, experimental techniques for determining these points, and the particle model of gases. It includes 3 multiple-choice questions and 3 short-answer questions, providing a balanced assessment of recall, application, and analytical skills. The quiz aligns with AQA GCSE Triple Science Chemistry specifications.
TEXT: <<<Quiz title: GCSE Chemistry: States of Matter and Chemical Reactions
Summary: This quiz covers key concepts in GCSE Chemistry, focusing on states of matter, changes of state, interpretation of melting and boiling point data from graphs, experimental techniques for determining these points, and the particle model of gases. It includes 3 multiple-choice questions and 3 short-answer questions, providing a balanced assessment of recall, application, and analytical skills. The quiz aligns with AQA GCSE Triple Science Chemistry specifications.
Mode: extraction
Subject: chemistry
Board: AQA
Question count: 6

Q1: Lithium reacts with water to produce lithium hydroxide solution and hydrogen. Use the correct state symbols to complete the chemical equation: 2Li(s) + 2H2O(l) → 2LiOH(__) + H2(__)
Topic: Chemical reactions and equations
Difficulty: intermediate
Skill focus: Application of knowledge, recall of state symbols
Answer: aq, g
Explanation: Lithium hydroxide solution is an aqueous solution, denoted by 'aq'. Hydrogen is a gas, denoted by 'g'.
Source reference: Page 1, Question 1(a)

Q2: Figure 1 shows the melting points and boiling points of four substances, A, B, C and D. Which substance is liquid over the greatest temperature range?
Topic: States of matter and changes of state
Difficulty: intermediate
Skill focus: Data analysis, graph interpretation
Answer: C
Options:
- A. A
- B. B
- C. C
- D. D
Explanation: Substance C has a melting point of approximately 10°C and a boiling point of approximately 200°C, giving it a liquid range of 190°C (200 - 10), which is the largest among the given substances.
Source reference: Page 2, Question 1(b), Figure 1

Q3: Referring to Figure 1, which two substances are gases at 50 °C?
Topic: States of matter and changes of state
Difficulty: intermediate
Skill focus: Data analysis, graph interpretation
Answer: A and D
Options:
- A. A and B
- B. B and C
- C. C and D
- D. A and D
Explanation: At 50°C, substance A (boiling point ~0°C) and substance D (boiling point ~-160°C) would both have boiled and therefore be in a gaseous state.
Source reference: Page 3, Question 1(c), Figure 1

Q4: Substance E has a melting point of -50 °C and a boiling point of +120 °C. What is the state of substance E at 0 °C?
Topic: States of matter and changes of state
Difficulty: foundation
Skill focus: Application of knowledge
Answer: Liquid
Options:
- A. Solid
- B. Liquid
- C. Gas
- D. Plasma
Explanation: At 0°C, substance E is above its melting point (-50°C) and below its boiling point (120°C), meaning it is in a liquid state.
Source reference: Page 3, Question 1(d)

Q5: Figure 2 shows apparatus used to determine the melting and boiling points of substance B. Explain why this apparatus could not be used to determine the boiling point of substance B.
Topic: Experimental techniques, heating methods
Difficulty: higher
Skill focus: Analysis, explanation, evaluation of experimental design
Answer: The apparatus uses a water bath, which can only heat substances up to 100°C. Substance B has a boiling point of approximately 190°C, which is higher than the maximum temperature achievable with a water bath.
Explanation: A water bath is limited to heating substances up to 100°C, its own boiling point. Since substance B's boiling point is 190°C (from Figure 1), a water bath cannot provide sufficient heat to reach this temperature.
Source reference: Page 4, Question 1(e), Figure 1 and Figure 2

Q6: A student shakes a tube containing small balls to model the movement of particles in a gas. Which of the following is a characteristic of this model that accurately represents gas particles?
Topic: Particle model, states of matter
Difficulty: foundation
Skill focus: Recall, understanding models
Answer: The balls are far apart from each other.
Options:
- A. The balls move slowly.
- B. The balls are far apart from each other.
- C. The balls are different colours.
- D. The balls move in fixed positions.
Explanation: In a gas, particles are far apart from each other and move randomly. The model effectively demonstrates the large separation between particles.
Source reference: Page 5, Question 2(a)
>>>
AUTO_SIGNALS:
- tokens: 683
- sentences: 46
- words: 683
- info_entropy_mean: 7.0114
- info_entropy_stddev: 1.6164
- idea_density: 8.3478
- repetition_compression_ratio: 0.291
- templates_per_token: 0.4275
- subj_lexicon_ratio: 0
- avg_sentence_len: 14.8478
- flesch_reading_ease: 57.25
- fk_grade: 8.96
- gunning_fog: 12.15
REQUEST_ID: with-questions-c2-1examqs-quiz-slop
RETURN: {"overall_slop":{"label":0|1,"confidence":0-1},"domain":"news|qa|other","annoyance":1-5,"axes":[...],"top_fixes":["..."]}
```
