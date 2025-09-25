# Sample 3: 966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg

## Context
- Sample ID: `with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c`
- Category: with-questions
- Source: 966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg (data/samples/with-questions/966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg)
- Primary mode: extraction
- Subject: chemistry
- Board: AQA
- Primary model: gemini-2.5-flash (temperature 0.2)
- Ten-more model: gemini-2.5-flash (temperature 0.2)
- Primary generated at: 2025-09-25T04:32:37.115Z
- Ten-more generated at: 2025-09-25T04:33:15.704Z
- Primary judge model: gemini-2.5-flash
- Ten-more judge model: gemini-2.5-flash
- Judge evaluations at: 2025-09-25T04:32:49.994Z / 2025-09-25T04:33:29.339Z

## Prompt references
- Prompt commit: `8aa7ba19b2a23b826f04269ba880e11af45f7918`
- web/src/lib/server/llm/quizPrompts.ts
- web/src/lib/server/llm/quizGenerator.ts
- web/src/lib/server/llm/judge.ts

## Primary quiz set
### Summary
- Quiz title: GCSE Chemistry: Covalent Bonding and Allotropes Retrieval Quiz
- Summary: This quiz covers fundamental concepts of covalent bonding, including formation, types of atoms involved, and the structures and properties of various covalent substances. It also includes questions on carbon allotropes like graphite, graphene, and fullerenes. The quiz features a mix of multiple-choice and short-answer questions, designed to test recall and explanatory skills. The syllabus alignment is general to AQA GCSE Chemistry C2 topics, as specific specification points were not provided in the source material.
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

1. **How are covalent bonds formed?**
   - Type: `multiple_choice`
   - Topic: Covalent bonding basics
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C2 questions, Q1
   - Options:
     - A. A) By atoms transferring electrons
     - B. B) By atoms sharing electrons
     - C. C) By atoms gaining electrons
     - D. D) By atoms losing electrons
   - Answer:
     B) By atoms sharing electrons
   - Explanation:
     Covalent bonds are formed when two non-metal atoms share a pair of electrons, allowing both atoms to achieve a stable outer electron shell.

2. **Which type of atoms form covalent bonds between them?**
   - Type: `multiple_choice`
   - Topic: Covalent bonding basics
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C2 questions, Q2
   - Options:
     - A. A) Metals and non-metals
     - B. B) Metals only
     - C. C) Non-metals only
     - D. D) Ions
   - Answer:
     C) Non-metals only
   - Explanation:
     Covalent bonds typically form between non-metal atoms as they both have a strong attraction for electrons and can achieve a stable electron configuration by sharing.

3. **Why do giant covalent substances have high melting points?**
   - Type: `short_answer`
   - Topic: Giant covalent structures
   - Difficulty: intermediate
   - Skill focus: Explanation
   - Source reference: C2 questions, Q6
   - Answer:
     It takes a lot of energy to break the strong covalent bonds between the atoms.
   - Explanation:
     Giant covalent substances, such as diamond or silicon dioxide, have extremely high melting points because a vast amount of energy is required to overcome the strong covalent bonds extending throughout the entire structure.

4. **Why can graphite conduct electricity?**
   - Type: `short_answer`
   - Topic: Graphite structure and properties
   - Difficulty: intermediate
   - Skill focus: Explanation
   - Source reference: C2 questions, Q11
   - Answer:
     The delocalised electrons can move through the graphite.
   - Explanation:
     Graphite's unique layered structure allows for the presence of delocalised electrons, which are free to move between the layers, enabling it to conduct electricity.

5. **What is graphene?**
   - Type: `multiple_choice`
   - Topic: Allotropes of carbon
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C2 questions, Q13
   - Options:
     - A. A) A hollow cage of carbon atoms
     - B. B) A hollow cylinder of carbon atoms
     - C. C) One layer of graphite
     - D. D) A giant covalent lattice of silicon
   - Answer:
     C) One layer of graphite
   - Explanation:
     Graphene is a single, two-dimensional layer of graphite, consisting of carbon atoms arranged in a hexagonal lattice.

6. **Give three uses of fullerenes.**
   - Type: `short_answer`
   - Topic: Fullerenes and their uses
   - Difficulty: intermediate
   - Skill focus: Recall, Application
   - Source reference: C2 questions, Q18
   - Answer:
     Lubricants, drug delivery (spheres), high-tech electronics.
   - Explanation:
     Fullerenes, such as buckyballs and nanotubes, have diverse applications due to their unique structures and properties, including use as lubricants, in targeted drug delivery systems, and in advanced electronic components.

### Judge verdict
- Model: gemini-2.5-flash
- Evaluated at: 2025-09-25T04:32:49.994Z
- Verdict: **APPROVE**

**Explanation**

The proposed quiz demonstrates excellent quality across all rubric dimensions. The 'Question quality' is high, with prompts that are precise, unambiguous, and exam-ready. 'Answer precision' is also outstanding, as all answers are factually correct, directly grounded in the provided material, and supported by clear explanations. The 'Coverage and balance' are appropriate for a retrieval quiz, addressing key concepts in covalent bonding and carbon allotropes with a suitable mix of multiple-choice and short-answer questions. 'Difficulty alignment' is well-managed, offering a varied challenge suitable for GCSE Triple Science. Finally, 'Safety & tone' are fully met, with no misinformation or off-spec content and consistent use of UK English spelling.

**Rubric findings**
  - **Question quality** — score 1.00: All prompts are precise, unambiguous, and align with typical GCSE exam question phrasing, making them suitable for assessment.
  - **Answer precision** — score 1.00: All provided answers are factually correct, directly correspond to the source material, and are supported by clear and accurate explanations.
  - **Coverage and balance** — score 1.00: The quiz effectively covers key concepts related to covalent bonding and carbon allotropes, drawing from the provided material. It also demonstrates a suitable balance between multiple-choice and short-answer question types.
  - **Difficulty alignment** — score 1.00: The questions are appropriate for GCSE Triple Science, featuring a good mix of foundation and intermediate difficulty levels, testing both recall and explanatory skills.
  - **Safety & tone** — score 1.00: The quiz contains no misinformation, harmful, or off-spec content, and maintains an appropriate educational tone with correct UK English spelling.

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
- Quiz title: GCSE Chemistry: Covalent Bonding and Allotropes Retrieval Quiz
- Summary: This quiz covers fundamental concepts of covalent bonding, including formation, types of atoms involved, and the structures and properties of various covalent substances. It also includes questions on carbon allotropes like graphite, graphene, and fullerenes. The quiz features a mix of multiple-choice and short-answer questions, designed to test recall and explanatory skills. The syllabus alignment is general to AQA GCSE Chemistry C2 topics, as specific specification points were not provided in the source material.
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

1. **Describe the structure and bonding of a giant covalent substance.**
   - Type: `short_answer`
   - Topic: Giant covalent structures
   - Difficulty: intermediate
   - Skill focus: Description
   - Source reference: C2 questions, Q3
   - Answer:
     Billions of atoms bonded together by strong covalent bonds.
   - Explanation:
     Giant covalent substances consist of a vast network of billions of atoms, all held together by strong covalent bonds throughout the entire structure.

2. **Describe the structure and bonding of small molecules.**
   - Type: `short_answer`
   - Topic: Small molecules
   - Difficulty: intermediate
   - Skill focus: Description
   - Source reference: C2 questions, Q4
   - Answer:
     Small numbers of atoms group together into molecules with strong covalent bonds between the atoms and weak intermolecular forces between the molecules.
   - Explanation:
     Small molecules are formed when a small number of atoms are joined by strong covalent bonds. These individual molecules are then held together by much weaker intermolecular forces.

3. **Describe the structure and bonding of polymers.**
   - Type: `short_answer`
   - Topic: Polymers
   - Difficulty: intermediate
   - Skill focus: Description
   - Source reference: C2 questions, Q5
   - Answer:
     Many identical molecules joined together by strong covalent bonds in a long chain, with weak intermolecular forces between the chains.
   - Explanation:
     Polymers are large molecules made up of many identical smaller molecules (monomers) joined together in long chains by strong covalent bonds. The forces between these polymer chains are weak intermolecular forces.

4. **Why do small molecules have low melting points?**
   - Type: `multiple_choice`
   - Topic: Small molecules properties
   - Difficulty: foundation
   - Skill focus: Explanation
   - Source reference: C2 questions, Q7
   - Options:
     - A. A) They have strong covalent bonds.
     - B. B) They have delocalised electrons.
     - C. C) Only a small amount of energy is needed to break the weak intermolecular forces.
     - D. D) They are made of non-metal atoms.
   - Answer:
     C) Only a small amount of energy is needed to break the weak intermolecular forces.
   - Explanation:
     Small molecules have low melting points because only a small amount of energy is required to overcome the weak intermolecular forces holding the molecules together, not the strong covalent bonds within the molecules.

5. **Why do large molecules have higher melting and boiling points than small molecules?**
   - Type: `short_answer`
   - Topic: Molecular size and properties
   - Difficulty: intermediate
   - Skill focus: Explanation
   - Source reference: C2 questions, Q8
   - Answer:
     The intermolecular forces are stronger in large molecules.
   - Explanation:
     As molecules get larger, the intermolecular forces between them become stronger. More energy is therefore required to overcome these stronger forces, leading to higher melting and boiling points compared to smaller molecules.

6. **Why do most covalent substances not conduct electricity?**
   - Type: `multiple_choice`
   - Topic: Covalent substances conductivity
   - Difficulty: intermediate
   - Skill focus: Explanation
   - Source reference: C2 questions, Q9
   - Options:
     - A. A) They have strong covalent bonds.
     - B. B) They are made of non-metals.
     - C. C) They do not have delocalised electrons or ions.
     - D. D) Their atoms are too small.
   - Answer:
     C) They do not have delocalised electrons or ions.
   - Explanation:
     For a substance to conduct electricity, it must have mobile charged particles, such as delocalised electrons or ions. Most covalent substances do not possess these, as their electrons are held in fixed covalent bonds.

7. **Describe the structure and bonding in graphite.**
   - Type: `short_answer`
   - Topic: Graphite structure and bonding
   - Difficulty: higher
   - Skill focus: Description
   - Source reference: C2 questions, Q10
   - Answer:
     Each carbon atom is bonded to three others in hexagonal rings arranged in layers – it has delocalised electrons and weak forces between the layers.
   - Explanation:
     In graphite, each carbon atom forms strong covalent bonds with three other carbon atoms, creating hexagonal rings arranged in flat layers. One electron from each carbon atom is delocalised, allowing for electrical conductivity, and weak intermolecular forces exist between the layers.

8. **Explain why graphite is soft.**
   - Type: `multiple_choice`
   - Topic: Graphite properties
   - Difficulty: intermediate
   - Skill focus: Explanation
   - Source reference: C2 questions, Q12
   - Options:
     - A. A) It has weak covalent bonds.
     - B. B) Layers are not bonded so can slide over each other.
     - C. C) It has delocalised electrons.
     - D. D) It is a giant covalent structure.
   - Answer:
     B) Layers are not bonded so can slide over each other.
   - Explanation:
     Graphite is soft and slippery because the weak intermolecular forces between its layers mean the layers are not strongly bonded and can easily slide past one another.

9. **Give two properties of graphene.**
   - Type: `short_answer`
   - Topic: Graphene properties
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C2 questions, Q14
   - Answer:
     Strong, conducts electricity.
   - Explanation:
     Graphene is known for its exceptional strength, being one of the strongest materials known, and its excellent electrical conductivity due to its delocalised electrons.

10. **What is a fullerene?**
   - Type: `multiple_choice`
   - Topic: Allotropes of carbon
   - Difficulty: foundation
   - Skill focus: Recall
   - Source reference: C2 questions, Q15
   - Options:
     - A. A) A single layer of graphite.
     - B. B) A giant covalent lattice of silicon.
     - C. C) A hollow cage of carbon atoms arranged as a sphere or a tube.
     - D. D) A long chain of identical molecules.
   - Answer:
     C) Hollow cage of carbon atoms arranged as a sphere or a tube.
   - Explanation:
     Fullerenes are a class of carbon allotropes characterized by their hollow structures, which can be spherical (like buckyballs) or cylindrical (like nanotubes).

### Ten-more judge verdict
- Model: gemini-2.5-flash
- Evaluated at: 2025-09-25T04:33:29.339Z
- Verdict: **APPROVE**

**Explanation**

The proposed quiz demonstrates excellent adherence to all rubric dimensions. The 'Question quality' is high, with prompts that are precise, unambiguous, and exam-ready, directly mirroring the style and content expected at GCSE level. 'Answer precision' is faultless, as all answers and their accompanying explanations are factually correct and directly grounded in the provided source material. The 'Coverage and balance' are appropriate for GCSE Triple Science, addressing key concepts of covalent bonding, structures, properties, and carbon allotropes with a suitable mix of short-answer and multiple-choice question types. 'Difficulty alignment' is well-judged, with questions appropriately categorised from foundation to higher, ensuring varied challenge. Finally, 'Safety & tone' are impeccable, with no misinformation, harmful, or off-spec content, and consistent use of UK English spelling.

**Rubric findings**
  - **Question quality** — score 1.00: Prompts are precise, unambiguous, and directly align with GCSE exam expectations, effectively testing understanding of covalent bonding and allotropes.
  - **Answer precision** — score 1.00: All answers and explanations are factually correct and directly derived from the provided source material, demonstrating high accuracy.
  - **Coverage and balance** — score 1.00: The quiz covers essential concepts of covalent bonding and carbon allotropes, offering a balanced mix of short-answer and multiple-choice questions suitable for a retrieval quiz.
  - **Difficulty alignment** — score 1.00: Questions are appropriately challenging for GCSE Triple Science, with a good spread of foundation, intermediate, and higher difficulty levels.
  - **Safety & tone** — score 1.00: The quiz is free from misinformation, harmful, or off-spec content, maintaining an appropriate educational tone and using correct UK English spelling.

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
