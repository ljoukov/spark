# Sample 5: F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg

## Context
- Sample ID: `with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c`
- Category: with-questions
- Source: F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg (data/samples/with-questions/F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg)
- Primary mode: extraction
- Subject: chemistry
- Board: AQA
- Primary model: gemini-2.5-flash (temperature 0.2)
- Ten-more model: gemini-2.5-flash (temperature 0.2)
- Primary generated at: 2025-09-25T04:35:48.408Z
- Ten-more generated at: 2025-09-25T04:36:27.741Z
- Primary judge model: gemini-2.5-flash
- Ten-more judge model: gemini-2.5-flash
- Judge evaluations at: 2025-09-25T04:36:01.173Z / 2025-09-25T04:36:43.955Z

## Prompt references
- Prompt commit: `8aa7ba19b2a23b826f04269ba880e11af45f7918`
- web/src/lib/server/llm/quizPrompts.ts
- web/src/lib/server/llm/quizGenerator.ts
- web/src/lib/server/llm/judge.ts

## Primary quiz set
### Summary
- Quiz title: AQA GCSE Chemistry: C20 Retrieval Quiz
- Summary: This quiz covers 6 key concepts from AQA GCSE Chemistry, focusing on topics such as corrosion, alloys, the Haber process, and fertilisers. It includes a mix of short answer and multiple-choice questions designed to test recall and understanding. One question on the Haber process equation has been corrected to ensure chemical accuracy. The questions are directly extracted from the provided C20 retrieval material.
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

1. **What is corrosion?**
   - Type: `short_answer`
   - Topic: Corrosion
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C20 questions, Q1
   - Answer:
     The destruction of a material through reactions with substances in the environment.
   - Explanation:
     Corrosion is a natural process that converts a refined metal into a more stable form, such as its oxide, hydroxide, or sulfide. It is the gradual destruction of materials (usually metals) by chemical and/or electrochemical reaction with their environment.

2. **What are two alloys of copper?**
   - Type: `multiple_choice`
   - Topic: Alloys
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C20 questions, Q5
   - Options:
     - A. Brass and bronze
     - B. Steel and cast iron
     - C. Solder and amalgam
     - D. Duralumin and magnalium
   - Answer:
     Brass and bronze
   - Explanation:
     Brass is an alloy of copper and zinc. Bronze is an alloy of copper and tin. Both are common alloys of copper.

3. **What is the balanced symbol equation for the Haber process?**
   - Type: `multiple_choice`
   - Topic: Haber Process
   - Difficulty: intermediate
   - Skill focus: Application
   - Source reference: C20 questions, Q15 (corrected equation)
   - Options:
     - A. N₂(g) + 2H₂(g) = 2NH₃(g)
     - B. N₂(g) + 3H₂(g) = 2NH₃(g)
     - C. N₂(g) + H₂(g) = NH₃(g)
     - D. 2N₂(g) + 3H₂(g) = 2NH₃(g)
   - Answer:
     N₂(g) + 3H₂(g) = 2NH₃(g)
   - Explanation:
     The Haber process combines nitrogen gas (N₂) from the air with hydrogen gas (H₂) to produce ammonia (NH₃). The balanced equation requires one molecule of nitrogen to react with three molecules of hydrogen to form two molecules of ammonia.

4. **What catalyst do we use for the Haber process?**
   - Type: `short_answer`
   - Topic: Haber Process
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C20 questions, Q19
   - Answer:
     Iron
   - Explanation:
     Finely divided iron is used as a catalyst in the Haber process to increase the rate of reaction without being consumed itself.

5. **What is an NPK fertiliser?**
   - Type: `multiple_choice`
   - Topic: Fertilisers
   - Difficulty: intermediate
   - Skill focus: Understanding
   - Source reference: C20 questions, Q21
   - Options:
     - A. A formulation containing soluble compounds of nitrogen, phosphorus, and potassium
     - B. A fertiliser containing only nitrogen and potassium
     - C. A natural fertiliser derived from animal waste
     - D. A compound used to neutralise acidic soil
   - Answer:
     A formulation containing soluble compounds of nitrogen, phosphorus, and potassium
   - Explanation:
     NPK fertilisers are formulations that contain compounds of nitrogen (N), phosphorus (P), and potassium (K). These are essential elements for plant growth and are supplied in soluble forms for absorption by plants.

6. **What is sacrificial protection?**
   - Type: `short_answer`
   - Topic: Corrosion Protection
   - Difficulty: intermediate
   - Skill focus: Recall
   - Source reference: C20 questions, Q3
   - Answer:
     Adding a more reactive metal to the surface of a material to protect it from corrosion.
   - Explanation:
     Sacrificial protection involves connecting a more reactive metal (the sacrificial anode) to the metal being protected. The more reactive metal corrodes preferentially, thereby protecting the less reactive metal.

### Judge verdict
- Model: gemini-2.5-flash
- Evaluated at: 2025-09-25T04:36:01.173Z
- Verdict: **APPROVE**

**Explanation**

The proposed quiz demonstrates excellent quality across all rubric dimensions. Question prompts are precise and unambiguous, making them highly suitable for GCSE assessment. Answer precision is outstanding, with all answers being factually correct and directly grounded in the provided material; notably, the balanced symbol equation for the Haber process (Q15) was accurately corrected from the source, enhancing its educational value. The quiz achieves good coverage and balance for its length, addressing key concepts such as corrosion, alloys, the Haber process, and fertilisers, and incorporating a suitable mix of short answer and multiple-choice question types. Difficulty alignment is appropriate for GCSE Triple Science, offering a varied challenge level. Finally, the quiz adheres to safety and tone guidelines, presenting accurate content in an appropriate educational register with correct UK English spelling.

**Rubric findings**
  - **Question quality** — score 1.00: Prompts are consistently precise, unambiguous, and well-phrased, making them exam-ready and clear for students.
  - **Answer precision** — score 1.00: All answers are factually correct and directly supported by the source material. The proactive correction of the Haber process equation (Q15) demonstrates a high level of accuracy and attention to detail.
  - **Coverage and balance** — score 0.90: The quiz provides a good selection of key concepts from the C20 material, covering important topics like corrosion, alloys, the Haber process, and fertilisers. The mix of short answer and multiple-choice questions is well-balanced for a concise quiz.
  - **Difficulty alignment** — score 1.00: The questions are well-aligned with GCSE Triple Science difficulty, offering a suitable range from foundation recall to intermediate application, appropriate for the target audience.
  - **Safety & tone** — score 1.00: The quiz is free from misinformation, harmful, or off-spec content. The tone is appropriate for an educational resource, and UK English spelling is consistently used.

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
- Quiz title: AQA GCSE Chemistry: C20 Retrieval Quiz
- Summary: This quiz extends the initial set with 10 new questions, bringing the total to 16. It further explores concepts from AQA GCSE Chemistry, including different methods of corrosion prevention, specific alloy compositions and properties, types of glass and ceramics, polymer classifications, composite materials, and the detailed effects of conditions on the Haber process. All questions are strictly based on the provided C20 retrieval material, offering fresh angles and subtopics.
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

1. **Which of the following are physical barriers used to protect against corrosion?**
   - Type: `multiple_choice`
   - Topic: Corrosion Protection
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C20 questions, Q2
   - Options:
     - A. A) Grease, paint, and a thin layer of metal
     - B. B) Sacrificial protection and galvanising
     - C. C) Anodising and electroplating
     - D. D) Alloying and cathodic protection
   - Answer:
     A) Grease, paint, and a thin layer of metal
   - Explanation:
     Physical barriers prevent oxygen and water from reaching the metal surface, thereby inhibiting the corrosion process. Grease, paint, and thin layers of less reactive metals (like tin plating) are common examples.

2. **How is rust formed?**
   - Type: `multiple_choice`
   - Topic: Corrosion
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C20 questions, Q4
   - Options:
     - A. A) Reaction between iron, water, and oxygen
     - B. B) Reaction between iron and carbon dioxide
     - C. C) Reaction between iron and nitrogen
     - D. D) Reaction between iron and sulfur
   - Answer:
     A) Reaction between iron, water, and oxygen
   - Explanation:
     Rust is the common term for the corrosion of iron and its alloys, such as steel. It specifically occurs when iron reacts with both oxygen and water in the environment.

3. **What are gold alloys in jewellery typically made from?**
   - Type: `multiple_choice`
   - Topic: Alloys
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C20 questions, Q6
   - Options:
     - A. A) Gold with copper, zinc, and silver
     - B. B) Gold with platinum and palladium
     - C. C) Gold with iron and carbon
     - D. D) Gold with aluminium and magnesium
   - Answer:
     A) Gold with copper, zinc, and silver
   - Explanation:
     Pure gold is very soft, so it is often alloyed with other metals like copper, zinc, and silver to increase its hardness, durability, and sometimes to alter its colour for jewellery making.

4. **What are steel alloys primarily made from?**
   - Type: `multiple_choice`
   - Topic: Alloys
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C20 questions, Q7
   - Options:
     - A. A) Iron, carbon, and other metals
     - B. B) Aluminium, copper, and zinc
     - C. C) Copper, tin, and lead
     - D. D) Gold, silver, and platinum
   - Answer:
     A) Iron, carbon, and other metals
   - Explanation:
     Steel is fundamentally an alloy of iron and carbon. Various other metals are often added in small quantities to create different types of steel with specific properties, such as stainless steel.

5. **What is a characteristic property of aluminium alloys?**
   - Type: `multiple_choice`
   - Topic: Alloys
   - Difficulty: intermediate
   - Skill focus: Understanding
   - Source reference: C20 questions, Q8
   - Options:
     - A. A) Generally have low densities
     - B. B) Have very high melting points
     - C. C) Are highly reactive with acids
     - D. D) Are magnetic
   - Answer:
     A) Generally have low densities
   - Explanation:
     Aluminium itself is a lightweight metal, and its alloys retain this property of generally having low densities, making them valuable for applications where weight reduction is important, such as in aircraft and vehicles.

6. **What is the main difference between soda-lime glass and borosilicate glass?**
   - Type: `multiple_choice`
   - Topic: Ceramics/Glass
   - Difficulty: intermediate
   - Skill focus: Comparison
   - Source reference: C20 questions, Q9
   - Options:
     - A. A) Borosilicate glass has a much higher melting point
     - B. B) Soda-lime glass is used for laboratory equipment
     - C. C) Borosilicate glass is more easily recycled
     - D. D) Soda-lime glass is more resistant to thermal shock
   - Answer:
     A) Borosilicate glass has a much higher melting point
   - Explanation:
     Borosilicate glass, which contains boron oxide, has a significantly higher melting point and better resistance to thermal shock compared to soda-lime glass, making it suitable for laboratory glassware and ovenware.

7. **Which of the following are examples of clay ceramics?**
   - Type: `multiple_choice`
   - Topic: Ceramics
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C20 questions, Q10
   - Options:
     - A. A) Pottery and bricks
     - B. B) Glass and concrete
     - C. C) Steel and aluminium
     - D. D) Polymers and composites
   - Answer:
     A) Pottery and bricks
   - Explanation:
     Clay ceramics are traditional ceramics made from clay, which is shaped and then hardened by firing at high temperatures. Pottery and bricks are classic examples of such materials.

8. **What is the main difference in behavior between thermosetting and thermosoftening polymers when heated?**
   - Type: `multiple_choice`
   - Topic: Polymers
   - Difficulty: intermediate
   - Skill focus: Comparison
   - Source reference: C20 questions, Q12
   - Options:
     - A. A) Thermosetting polymers do not soften when heated, thermosoftening polymers do
     - B. B) Thermosoftening polymers are stronger than thermosetting polymers
     - C. C) Thermosetting polymers can be remoulded multiple times, thermosetting cannot
     - D. D) Thermosoftening polymers have cross-links between polymer chains, thermosetting do not
   - Answer:
     A) Thermosetting polymers do not soften when heated, thermosoftening polymers do
   - Explanation:
     Thermosoftening polymers soften and melt when heated because their intermolecular forces are overcome, allowing them to be reshaped. Thermosetting polymers form permanent cross-links during their initial heating and curing, which prevents them from softening or melting upon subsequent heating.

9. **What is a composite material?**
   - Type: `short_answer`
   - Topic: Composites
   - Difficulty: foundation
   - Skill focus: Definition
   - Source reference: C20 questions, Q13
   - Answer:
     A mixture of a matrix and reinforcements
   - Explanation:
     A composite material is engineered by combining two or more distinct materials, typically a 'matrix' (or binder) and 'reinforcements' (like fibres or particles), to achieve properties superior to those of the individual components.

10. **What is the effect of increasing the temperature of the Haber process on the yield, rate, and cost?**
   - Type: `multiple_choice`
   - Topic: Haber Process
   - Difficulty: higher
   - Skill focus: Analysis
   - Source reference: C20 questions, Q17
   - Options:
     - A. A) Decrease yield, increase rate, increase cost
     - B. B) Increase yield, decrease rate, decrease cost
     - C. C) Increase yield, increase rate, increase cost
     - D. D) Decrease yield, decrease rate, decrease cost
   - Answer:
     A) Decrease yield, increase rate, increase cost
   - Explanation:
     The Haber process is an exothermic reaction. Increasing the temperature shifts the equilibrium to the left (reactants), thus decreasing the yield of ammonia. However, higher temperatures increase the kinetic energy of reactant particles, leading to more frequent and energetic collisions, which increases the reaction rate. Operating at higher temperatures also requires more energy input, increasing the overall cost.

### Ten-more judge verdict
- Model: gemini-2.5-flash
- Evaluated at: 2025-09-25T04:36:43.955Z
- Verdict: **APPROVE**

**Explanation**

The proposed quiz demonstrates excellent adherence to the rubric dimensions. Question quality is consistently high, with prompts that are precise, unambiguous, and exam-ready. Answer precision is flawless, as all answers are factually correct and directly grounded in the provided C20 retrieval material. The coverage and balance are appropriate for an extension quiz, addressing key concepts across various topics within the C20 chapter, including corrosion, alloys, ceramics, polymers, composites, and the Haber process. Difficulty alignment is well-managed, with questions appropriately categorised from 'foundation' to 'higher' to suit GCSE Triple Science. Finally, the quiz maintains an appropriate safety and tone, free from misinformation or off-spec content, and uses UK English spelling.

**Rubric findings**
  - **Question quality** — score 1.00: All prompts are precise, unambiguous, and directly reflect the questions from the C20 retrieval material, making them highly exam-ready.
  - **Answer precision** — score 1.00: Every answer provided is factually correct and perfectly matches the corresponding answers in the source material. Explanations are accurate and supportive.
  - **Coverage and balance** — score 1.00: The quiz covers a suitable range of key concepts from the C20 material, including various aspects of materials science and industrial processes. The mix of multiple-choice and short-answer questions is appropriate for a retrieval quiz.
  - **Difficulty alignment** — score 1.00: The questions are well-aligned with GCSE Triple Science, featuring a varied challenge from 'foundation' recall to 'higher' analysis, as indicated by the assigned difficulty levels.
  - **Safety & tone** — score 1.00: The quiz is free from misinformation, harmful, or off-spec content. The tone is appropriate for an educational context, and UK English spelling is consistently used.

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
