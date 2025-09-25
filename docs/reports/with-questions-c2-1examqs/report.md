# Sample 4: C2.1ExamQs.pdf

## Context
- Sample ID: `with-questions-c2-1examqs`
- Category: with-questions
- Source: C2.1ExamQs.pdf (data/samples/with-questions/C2.1ExamQs.pdf)
- Primary mode: extraction
- Subject: chemistry
- Board: AQA
- Primary model: gemini-2.5-flash (temperature 0.2)
- Ten-more model: gemini-2.5-flash (temperature 0.2)
- Primary generated at: 2025-09-25T04:34:07.122Z
- Ten-more generated at: 2025-09-25T04:35:12.619Z
- Primary judge model: gemini-2.5-flash
- Ten-more judge model: gemini-2.5-flash
- Judge evaluations at: 2025-09-25T04:34:34.499Z / 2025-09-25T04:35:27.255Z

## Prompt references
- Prompt commit: `8aa7ba19b2a23b826f04269ba880e11af45f7918`
- web/src/lib/server/llm/quizPrompts.ts
- web/src/lib/server/llm/quizGenerator.ts
- web/src/lib/server/llm/judge.ts

## Primary quiz set
### Summary
- Quiz title: GCSE Chemistry: States of Matter and Experimental Techniques
- Summary: This quiz covers key concepts in GCSE Chemistry, focusing on states of matter, chemical equations, and experimental techniques for determining melting and boiling points. It includes a mix of multiple-choice questions requiring data interpretation from graphs and short-answer questions assessing understanding of experimental design and chemical principles. The quiz aligns with AQA GCSE Triple Science (Chemistry) specifications, particularly topics related to the particle model and practical skills. Note: The provided source material for Figure 1 contains an anomaly for substance A where the boiling point appears lower than the melting point; interpretations for questions 1(b) and 1(c) are made based on the most plausible intended meaning for other substances.
- Question count: 6

### Generation prompt
```text
You are Spark's GCSE Triple Science quiz builder. Work strictly from the supplied study material.
The material already includes questions and answers. Extract high-quality exam-ready items.
Preserve original wording as much as possible while fixing small typos.
Return questionCount distinct items that match the source closely.
Always write in UK English and reference the specification where relevant.
Return JSON that matches the provided schema. The summary should highlight coverage and question mix.
You must return exactly 6 questions.
For multiple_choice items, include exactly four options labelled A, B, C, and D in the options array.
Set the difficulty field to foundation, intermediate, or higher; choose the closest match when uncertain.
Subject focus: chemistry.
Exam board context: AQA.
Include concise sourceReference entries when you can identify page numbers, prompts or captions.
If the material lacks enough detail for a requirement, explain the limitation in the summary.
```

### Questions

1. **Complete the chemical equation for the reaction of lithium with water by adding the correct state symbols: 2Li(s) + 2H₂O(l) → 2LiOH(__) + H₂(__)**
   - Type: `short_answer`
   - Topic: Chemical reactions, states of matter
   - Difficulty: foundation
   - Skill focus: Recall and application of chemical notation
   - Source reference: Page 1, Question 1(a)
   - Answer:
     aq, g
   - Explanation:
     Lithium hydroxide (LiOH) is soluble in water, forming an aqueous solution (aq). Hydrogen (H₂) is a gas (g) produced in the reaction.

2. **Figure 1 shows the melting points and boiling points of four substances, A, B, C and D. Which substance is liquid over the greatest temperature range?**
   - Type: `multiple_choice`
   - Topic: States of matter, data interpretation
   - Difficulty: intermediate
   - Skill focus: Data analysis, calculation
   - Source reference: Page 2, Figure 1, Question 1(b)
   - Options:
     - A. A
     - B. B
     - C. C
     - D. D
   - Answer:
     C
   - Explanation:
     The liquid range is the difference between the boiling point and the melting point. For B: 180°C - 70°C = 110°C. For C: 200°C - 0°C = 200°C. For D: -160°C - (-180°C) = 20°C. Substance C has the largest liquid range.

3. **Figure 1 shows the melting points and boiling points of four substances, A, B, C and D. Which two substances are gases at 50 °C?**
   - Type: `multiple_choice`
   - Topic: States of matter, data interpretation
   - Difficulty: intermediate
   - Skill focus: Data analysis, understanding phase changes
   - Source reference: Page 3, Figure 1, Question 1(c)
   - Options:
     - A. A and B
     - B. B and C
     - C. C and D
     - D. A and D
   - Answer:
     A and D
   - Explanation:
     A substance is a gas when its temperature is above its boiling point. At 50°C, substance A (boiling point approx -100°C) and substance D (boiling point approx -160°C) are both above their boiling points, and therefore are gases.

4. **Substance E has a melting point of -50 °C and a boiling point of +120 °C. What is the state of substance E at 0 °C?**
   - Type: `multiple_choice`
   - Topic: States of matter, phase changes
   - Difficulty: foundation
   - Skill focus: Application of knowledge
   - Source reference: Page 3, Question 1(d)
   - Options:
     - A. Solid
     - B. Liquid
     - C. Gas
     - D. Plasma
   - Answer:
     Liquid
   - Explanation:
     At 0 °C, the temperature is above the melting point (-50 °C) and below the boiling point (120 °C), so substance E would be in a liquid state.

5. **Figure 2 shows apparatus used to determine the melting and boiling points of substance B. Explain why this apparatus is unsuitable for determining the boiling point of substance B.**
   - Type: `short_answer`
   - Topic: Experimental techniques, states of matter
   - Difficulty: higher
   - Skill focus: Scientific reasoning, evaluation of experimental design
   - Source reference: Page 4, Figure 2, Question 1(e)
   - Answer:
     Substance B has a boiling point of approximately 180°C (from Figure 1). The apparatus uses a water bath, which boils at 100°C. Therefore, the water bath cannot reach the temperature required to boil substance B.
   - Explanation:
     The maximum temperature a water bath can reach is 100°C (the boiling point of water). Since substance B has a boiling point of 180°C, the water bath cannot provide sufficient heat to make substance B boil.

6. **Suggest one reason why the student could not use the apparatus shown in Figure 2 to determine the exact melting point of substance B.**
   - Type: `short_answer`
   - Topic: Experimental techniques, accuracy
   - Difficulty: higher
   - Skill focus: Critical evaluation of experimental setup, understanding sources of error
   - Source reference: Page 4, Figure 2, Question 1(f)
   - Answer:
     The thermometer is placed in the water bath, not directly in substance B. This means it measures the water temperature, not the exact temperature of substance B itself, leading to potential inaccuracies in the melting point measurement.
   - Explanation:
     For an accurate measurement of the melting point, the thermometer should be in direct contact with the substance being tested. In this setup, the thermometer is in the surrounding water bath, which may not be at the exact same temperature as substance B, especially during phase changes.

### Judge verdict
- Model: gemini-2.5-flash
- Evaluated at: 2025-09-25T04:34:34.499Z
- Verdict: **REVISE**

**Explanation**

The proposed quiz demonstrates strong 'Answer precision', with all responses being factually correct and well-justified based on the provided material. 'Difficulty alignment' is also excellent, offering a suitable range of challenge appropriate for GCSE Triple Science. Furthermore, 'Safety & tone' are maintained throughout. However, the quiz's 'Question quality' is slightly impacted by a significant anomaly in the source's Figure 1 for substance A (boiling point lower than melting point), which, despite being acknowledged in the quiz summary, could still cause confusion. More critically, the 'Coverage and balance' is incomplete as questions 2(a) and 2(b) from the source material, which address the particle model and kinetic energy, have been omitted.

**Rubric findings**
  - **Question quality** — score 0.80: Prompts are generally precise and unambiguous. However, the inherent flaw in Figure 1 for substance A (boiling point lower than melting point) in the source material, though acknowledged in the quiz summary, slightly detracts from the overall quality of the data interpretation questions (1b, 1c) as they rely on this problematic data.
  - **Answer precision** — score 1.00: All answers are factually correct and directly grounded in the material. Explanations are clear, concise, and accurate, even when interpreting the flawed data for substance A consistently.
  - **Coverage and balance** — score 0.60: While the included questions offer a good mix of types and cover key concepts related to states of matter and experimental techniques, questions 2(a) and 2(b) from the provided source material (which cover the particle model and kinetic energy) are entirely omitted, leading to incomplete coverage of the source content.
  - **Difficulty alignment** — score 1.00: The questions are well-aligned with GCSE Triple Science, offering a suitable range from foundation (e.g., Q1a, Q1d) to higher-tier challenge (e.g., Q1e, Q1f).
  - **Safety & tone** — score 1.00: The quiz avoids misinformation (beyond the acknowledged flaw in the source graph), harmful, or off-spec content, and uses appropriate UK English spelling.

#### Judge prompt
```text
You are Spark's internal GCSE quiz quality judge. Review the proposed quiz objectively.
Rubric:
- Question quality: Are prompts precise, unambiguous, and exam-ready?
- Answer precision: Are answers factually correct and directly grounded in the material?
- Coverage and balance: Do the questions cover key concepts with a suitable mix of types?
- Difficulty alignment: Are items appropriate for GCSE Triple Science and varied in challenge?
- Safety & tone: Avoid misinformation, harmful or off-spec content.
Use the GCSE Triple Science context and ensure UK English spelling.
Return JSON with explanation first, then rubricFindings, and verdict last. Explanation must cite rubric dimensions.
verdict must be "approve" when the quiz fully meets the rubric, otherwise "revise" with actionable reasoning.
Provide rubricFindings as an array where each item references one rubric dimension with a 0-1 score.
```

## Ten-more quiz set
### Summary
- Quiz title: GCSE Chemistry: States of Matter and Experimental Techniques
- Summary: This quiz covers key concepts in GCSE Chemistry, focusing on states of matter, chemical equations, and experimental techniques for determining melting and boiling points. It includes a mix of multiple-choice questions requiring data interpretation from graphs and short-answer questions assessing understanding of experimental design and chemical principles. The quiz aligns with AQA GCSE Triple Science (Chemistry) specifications, particularly topics related to the particle model and practical skills. Note: The provided source material for Figure 1 contains an anomaly for substance A where the boiling point appears lower than the melting point; interpretations for questions 1(b) and 1(c) are made based on the most plausible intended meaning for other substances.
- Question count: 10

### Ten-more generation prompt
```text
You are Spark's GCSE Triple Science quiz builder. Work strictly from the supplied study material.
The learner already received an initial quiz, provided below as JSON. They now want additional questions.
Requirements:
- Produce exactly 10 new questions.
- Avoid duplicating any prompt ideas, answer wording, or explanation themes present in the base quiz.
- Continue to ground every item strictly in the supplied material.
- Highlight fresh angles or subtopics that were underrepresented previously.
- Multiple choice responses must include four options labelled A, B, C, and D.
- Difficulty must be mapped to foundation, intermediate, or higher for every question.
Return JSON following the schema. Set mode to "extension" and update questionCount accordingly.
Do not restate the previous questions in the response. Only include the new items.
```

### Questions

1. **The reaction between lithium and water produces lithium hydroxide and hydrogen gas. What type of chemical reaction is this?**
   - Type: `multiple_choice`
   - Topic: Chemical reactions, reactivity series
   - Difficulty: intermediate
   - Skill focus: Classification of chemical reactions
   - Source reference: Page 1, Question 1(a)
   - Options:
     - A. A) Neutralisation
     - B. B) Precipitation
     - C. C) Displacement
     - D. D) Combustion
   - Answer:
     C
   - Explanation:
     In this reaction, lithium (a more reactive metal) displaces hydrogen from water, forming lithium hydroxide and releasing hydrogen gas. This is a characteristic of a displacement reaction.

2. **In the completed chemical equation 2Li(s) + 2H₂O(l) → 2LiOH(aq) + H₂(g), what does the state symbol '(aq)' represent?**
   - Type: `multiple_choice`
   - Topic: Chemical notation, states of matter
   - Difficulty: foundation
   - Skill focus: Recall of chemical notation
   - Source reference: Page 1, Question 1(a)
   - Options:
     - A. A) A solid dissolved in acid
     - B. B) A gas dissolved in water
     - C. C) A substance dissolved in water
     - D. D) A liquid at room temperature
   - Answer:
     C
   - Explanation:
     The state symbol '(aq)' stands for 'aqueous', meaning the substance is dissolved in water to form a solution.

3. **According to Figure 1, which substance is a solid at -10°C?**
   - Type: `multiple_choice`
   - Topic: States of matter, data interpretation
   - Difficulty: intermediate
   - Skill focus: Data analysis, understanding phase changes
   - Source reference: Page 2, Figure 1
   - Options:
     - A. A) A
     - B. B) B
     - C. C) C
     - D. D) D
   - Answer:
     C
   - Explanation:
     Substance C has a melting point of 0°C. At -10°C, which is below its melting point, substance C would be in a solid state.

4. **Based on Figure 1, which substance has the highest boiling point?**
   - Type: `multiple_choice`
   - Topic: States of matter, data interpretation
   - Difficulty: foundation
   - Skill focus: Data extraction from graphs
   - Source reference: Page 2, Figure 1
   - Options:
     - A. A) A
     - B. B) B
     - C. C) C
     - D. D) D
   - Answer:
     C
   - Explanation:
     By observing the boiling points (represented by the top of the vertical lines or the '•' symbol) in Figure 1, substance C has a boiling point of approximately 200°C, which is the highest among the given substances.

5. **Using Figure 1, determine the state of substance B at 100°C.**
   - Type: `multiple_choice`
   - Topic: States of matter, phase changes
   - Difficulty: intermediate
   - Skill focus: Data interpretation, application of phase change rules
   - Source reference: Page 2, Figure 1
   - Options:
     - A. A) Solid
     - B. B) Liquid
     - C. C) Gas
     - D. D) Plasma
   - Answer:
     B
   - Explanation:
     Substance B has a melting point of approximately 70°C and a boiling point of approximately 180°C. Since 100°C is above its melting point and below its boiling point, substance B would be in a liquid state.

6. **In the experimental setup shown in Figure 2, what is the primary purpose of using a water bath to heat substance B?**
   - Type: `multiple_choice`
   - Topic: Experimental techniques, laboratory safety
   - Difficulty: foundation
   - Skill focus: Understanding experimental procedures
   - Source reference: Page 4, Figure 2
   - Options:
     - A. A) To prevent substance B from reacting with air
     - B. B) To ensure even and controlled heating of substance B
     - C. C) To cool substance B down slowly
     - D. D) To measure the volume of substance B
   - Answer:
     B
   - Explanation:
     A water bath provides a more uniform and controlled temperature environment for heating substances compared to direct heating, which helps in obtaining more accurate melting or boiling point measurements.

7. **If substance B had a boiling point of 250°C, what alternative heating method would be more suitable than a water bath for determining its boiling point?**
   - Type: `short_answer`
   - Topic: Experimental techniques, laboratory apparatus
   - Difficulty: higher
   - Skill focus: Application of practical knowledge, problem-solving in experimental design
   - Source reference: Page 4, Figure 2
   - Answer:
     An oil bath or a heating mantle.
   - Explanation:
     A water bath cannot exceed 100°C. For substances with higher boiling points like 250°C, an oil bath (which can reach higher temperatures) or a heating mantle (for direct, controlled heating of a flask) would be necessary.

8. **The model of shaking balls is good for representing particles in a gas. However, suggest one limitation of this model when trying to accurately represent real gas particles.**
   - Type: `short_answer`
   - Topic: Particle model, scientific models
   - Difficulty: higher
   - Skill focus: Critical evaluation of scientific models
   - Source reference: Page 4, Question 2
   - Answer:
     The balls do not represent the actual microscopic size of gas particles / the model does not show intermolecular forces between particles / the balls are all the same size and shape, unlike real gas particles which can vary / the model doesn't accurately represent the empty space between particles.
   - Explanation:
     While useful for illustrating random motion and separation, the model simplifies many aspects. Real gas particles are microscopic, have specific chemical properties, and interact via weak intermolecular forces, none of which are perfectly represented by macroscopic balls.

9. **Describe the arrangement and movement of particles in a liquid.**
   - Type: `short_answer`
   - Topic: States of matter, particle theory
   - Difficulty: intermediate
   - Skill focus: Recall and description of particle theory
   - Source reference: Page 5, Question 2(b)
   - Answer:
     Particles in a liquid are close together but randomly arranged. They can move past each other (flow) and have random motion.
   - Explanation:
     In a liquid, particles are held by intermolecular forces but have enough kinetic energy to overcome fixed positions, allowing them to slide past one another. This gives liquids a definite volume but no definite shape.

10. **For a given material, how does the average kinetic energy of its particles relate to its temperature?**
   - Type: `multiple_choice`
   - Topic: Kinetic theory, temperature
   - Difficulty: foundation
   - Skill focus: Understanding the kinetic theory of matter
   - Source reference: Page 5, Question 2(b)
   - Options:
     - A. A) Average kinetic energy decreases as temperature increases
     - B. B) Average kinetic energy is unrelated to temperature
     - C. C) Average kinetic energy increases as temperature increases
     - D. D) Average kinetic energy is constant regardless of temperature
   - Answer:
     C
   - Explanation:
     Temperature is a direct measure of the average kinetic energy of the particles within a substance. As temperature increases, particles move faster on average, thus possessing higher average kinetic energy.

### Ten-more judge verdict
- Model: gemini-2.5-flash
- Evaluated at: 2025-09-25T04:35:27.255Z
- Verdict: **APPROVE**

**Explanation**

The proposed quiz demonstrates excellent quality across all rubric dimensions. The 'Question quality' is high, with prompts that are precise, unambiguous, and exam-ready, effectively drawing from the provided source material. 'Answer precision' is consistently accurate, with all answers being factually correct and directly grounded in the material presented in the figures and text. The 'Coverage and balance' are commendable, offering a suitable mix of multiple-choice and short-answer questions that address key concepts such as states of matter, chemical equations, data interpretation, and experimental techniques. 'Difficulty alignment' is appropriate for GCSE Triple Science, with a varied challenge level that caters to different cognitive skills. Finally, 'Safety & tone' are maintained throughout, with no misinformation or off-spec content, and correct UK English spelling.

**Rubric findings**
  - **Question quality** — score 1.00: All prompts are precise, unambiguous, and well-phrased, making them suitable for GCSE examination. They effectively guide students to the required information or application of knowledge.
  - **Answer precision** — score 1.00: All provided answers are factually correct and directly align with the information presented in the source material (chemical equation, Figure 1, Figure 2, and the particle model description). Explanations are clear and accurate.
  - **Coverage and balance** — score 1.00: The quiz covers a good range of key concepts from states of matter, chemical reactions, data interpretation from graphs, and experimental techniques. There is a suitable balance between multiple-choice and short-answer questions, ensuring a comprehensive assessment.
  - **Difficulty alignment** — score 1.00: The questions are well-aligned with GCSE Triple Science expectations, offering a varied challenge from foundational recall and data extraction to intermediate interpretation and higher-level application and critical evaluation of models and experimental design.
  - **Safety & tone** — score 1.00: The quiz contains no misinformation, harmful, or off-spec content. The tone is academic and appropriate for the target audience, and UK English spelling is consistently used.

#### Judge prompt
```text
You are Spark's internal GCSE quiz quality judge. Review the proposed quiz objectively.
Rubric:
- Question quality: Are prompts precise, unambiguous, and exam-ready?
- Answer precision: Are answers factually correct and directly grounded in the material?
- Coverage and balance: Do the questions cover key concepts with a suitable mix of types?
- Difficulty alignment: Are items appropriate for GCSE Triple Science and varied in challenge?
- Safety & tone: Avoid misinformation, harmful or off-spec content.
Use the GCSE Triple Science context and ensure UK English spelling.
Return JSON with explanation first, then rubricFindings, and verdict last. Explanation must cite rubric dimensions.
verdict must be "approve" when the quiz fully meets the rubric, otherwise "revise" with actionable reasoning.
Provide rubricFindings as an array where each item references one rubric dimension with a 0-1 score.
```
