# Sample Quiz Generation Report

- Generated at: 2025-09-25T07:33:43.161Z
- Commit: c1217843fd4ac21e2c0bb84d06b44796761b239e
- Prompt sources:
  - [web/src/lib/server/llm/quizPrompts.ts](https://github.com/spark-ai/spark/blob/c1217843fd4ac21e2c0bb84d06b44796761b239e/web/src/lib/server/llm/quizPrompts.ts)
  - [web/src/lib/server/llm/quizGenerator.ts](https://github.com/spark-ai/spark/blob/c1217843fd4ac21e2c0bb84d06b44796761b239e/web/src/lib/server/llm/quizGenerator.ts)
  - [web/src/lib/server/llm/judge.ts](https://github.com/spark-ai/spark/blob/c1217843fd4ac21e2c0bb84d06b44796761b239e/web/src/lib/server/llm/judge.ts)

## Samples

### Sample 1: Y8Lesson-Health-BloodDonations.pdf (synthesis)

- Source: Y8Lesson-Health-BloodDonations.pdf (data/samples/no-questions/Y8Lesson-Health-BloodDonations.pdf)
- Base quiz summary: This quiz assesses understanding of blood, organ, and stem cell donation, covering reasons for donation, processes, and the law in England, with a mix of question types aligned with the OCR GCSE Biology specification. Coverage gaps: The quiz does not cover the specific biological mechanisms of tissue matching or rejection, nor detailed ethical considerations from different faith perspectives, as these were not detailed in the source material.
- Base verdict: approve
- Extension verdict: approve
- Reports: [Quiz](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz.md) · [Judge](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-judgement.md) · [10 more](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension.md) · [10 more judge](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension-judgement.json)
- Image: [Y8Lesson-Health-BloodDonations.pdf](https://github.com/spark-ai/spark/blob/c1217843fd4ac21e2c0bb84d06b44796761b239e/data/samples/no-questions/Y8Lesson-Health-BloodDonations.pdf)

### Sample 2: 18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg (extraction)

- Source: 18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg (data/samples/with-questions/18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg)
- Base quiz summary: This quiz contains 20 short-answer questions covering atomic structure, the history of the atom, elements, compounds, mixtures, and separation techniques, aligned with the AQA GCSE Chemistry specification. Coverage gaps: none – full coverage achieved.
- Base verdict: approve
- Extension verdict: approve
- Reports: [Quiz](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz.md) · [Judge](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-judgement.md) · [10 more](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension.md) · [10 more judge](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension-judgement.json)
- Image: [18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg](https://github.com/spark-ai/spark/blob/c1217843fd4ac21e2c0bb84d06b44796761b239e/data/samples/with-questions/18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg)

### Sample 3: 966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg (extraction)

- Source: 966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg (data/samples/with-questions/966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg)
- Base quiz summary: This quiz contains 18 short-answer questions covering covalent bonding, properties of simple and giant covalent structures, and allotropes of carbon, aligned with the AQA specification. Coverage gaps: the source material provided only 18 questions, not the requested 20.
- Base verdict: approve
- Extension verdict: approve
- Reports: [Quiz](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz.md) · [Judge](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-judgement.md) · [10 more](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension.md) · [10 more judge](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension-judgement.json)
- Image: [966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg](https://github.com/spark-ai/spark/blob/c1217843fd4ac21e2c0bb84d06b44796761b239e/data/samples/with-questions/966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg)

### Sample 4: C2.1ExamQs.pdf (extraction)

- Source: C2.1ExamQs.pdf (data/samples/with-questions/C2.1ExamQs.pdf)
- Base quiz summary: This quiz assesses understanding of states of matter, the particle model, and chemical equations, using multiple-choice, short answer, and numeric questions aligned with the AQA GCSE Chemistry specification. Coverage gaps: The quiz is based on a very limited source document; to meet the question count, multiple questions are derived from a single graph, and broader topics within the syllabus are not covered.
- Base verdict: revise
- Extension verdict: approve
- Reports: [Quiz](sample-quizzes/with-questions-c2-1examqs/quiz.md) · [Judge](sample-quizzes/with-questions-c2-1examqs/quiz-judgement.md) · [10 more](sample-quizzes/with-questions-c2-1examqs/quiz-extension.md) · [10 more judge](sample-quizzes/with-questions-c2-1examqs/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-extension-judgement.json)
- Image: [C2.1ExamQs.pdf](https://github.com/spark-ai/spark/blob/c1217843fd4ac21e2c0bb84d06b44796761b239e/data/samples/with-questions/C2.1ExamQs.pdf)

### Sample 5: F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg (extraction)

- Source: F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg (data/samples/with-questions/F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg)
- Base quiz summary: This quiz contains 20 short-answer questions covering corrosion, alloys, ceramics, polymers, composites, and the Haber process, aligned with the AQA GCSE Chemistry specification. Coverage gaps: Question 21 on NPK fertilisers from the source material has been omitted to meet the required question count.
- Base verdict: approve
- Extension verdict: approve
- Reports: [Quiz](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz.md) · [Judge](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-judgement.md) · [10 more](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension.md) · [10 more judge](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension-judgement.json)
- Image: [F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg](https://github.com/spark-ai/spark/blob/c1217843fd4ac21e2c0bb84d06b44796761b239e/data/samples/with-questions/F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg)
