# Sample Quiz Generation Report

- Generated at: 2025-09-25T22:37:00.420Z
- Commit: ce8344db8cee9a66e43b49357dc9c776f4243c2e
- Prompt sources:
  - [web/src/lib/server/llm/quizPrompts.ts](https://github.com/spark-ai/spark/blob/ce8344db8cee9a66e43b49357dc9c776f4243c2e/web/src/lib/server/llm/quizPrompts.ts)
  - [web/src/lib/server/llm/quizGenerator.ts](https://github.com/spark-ai/spark/blob/ce8344db8cee9a66e43b49357dc9c776f4243c2e/web/src/lib/server/llm/quizGenerator.ts)
  - [web/src/lib/server/llm/judge.ts](https://github.com/spark-ai/spark/blob/ce8344db8cee9a66e43b49357dc9c776f4243c2e/web/src/lib/server/llm/judge.ts)

## Samples

### Sample 1: Y8Lesson-Health-BloodDonations.pdf (synthesis)

- Source: Y8Lesson-Health-BloodDonations.pdf (data/samples/no-questions/Y8Lesson-Health-BloodDonations.pdf)
- Base quiz summary: This quiz assesses understanding of blood, organ, and stem cell donation, covering reasons, processes, and the law in England, with multiple choice, short answer, true/false, and numeric questions aligned with the OCR specification. Coverage gaps: The quiz does not assess the specific considerations involved in an individual's choice to donate or not to donate, as the source material presents these as discussion points rather than factual content.
- Base verdict: revise
- Extension verdict: approve
- Reports: [Quiz](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz.md) · [Judge](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-judgement.md) · [10 more](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension.md) · [10 more judge](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension-judgement.json)
- Image: [Y8Lesson-Health-BloodDonations.pdf](https://github.com/spark-ai/spark/blob/ce8344db8cee9a66e43b49357dc9c776f4243c2e/data/samples/no-questions/Y8Lesson-Health-BloodDonations.pdf)

### Sample 2: 18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg (extraction)

- Source: 18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg (data/samples/with-questions/18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg)
- Base quiz summary: This quiz assesses fundamental knowledge of atomic structure, the history of the atom, elements, compounds, mixtures, and separation techniques using short-answer questions, aligned with the AQA GCSE Chemistry specification. Coverage gaps: none – full coverage achieved.
- Base verdict: approve
- Extension verdict: approve
- Reports: [Quiz](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz.md) · [Judge](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-judgement.md) · [10 more](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension.md) · [10 more judge](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension-judgement.json)
- Image: [18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg](https://github.com/spark-ai/spark/blob/ce8344db8cee9a66e43b49357dc9c776f4243c2e/data/samples/with-questions/18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg)

### Sample 3: 966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg (extraction)

- Source: 966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg (data/samples/with-questions/966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg)
- Base quiz summary: This quiz assesses understanding of covalent bonding, simple and giant molecular structures, polymers, and the properties of carbon allotropes, based on AQA GCSE Chemistry specifications. Coverage gaps: none – full coverage achieved.
- Base verdict: approve
- Extension verdict: approve
- Reports: [Quiz](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz.md) · [Judge](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-judgement.md) · [10 more](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension.md) · [10 more judge](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension-judgement.json)
- Image: [966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg](https://github.com/spark-ai/spark/blob/ce8344db8cee9a66e43b49357dc9c776f4243c2e/data/samples/with-questions/966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg)

### Sample 4: C2.1ExamQs.pdf (extraction)

- Source: C2.1ExamQs.pdf (data/samples/with-questions/C2.1ExamQs.pdf)
- Base quiz summary: This quiz assesses understanding of states of matter, changes of state, and the particle model, using multiple-choice, short-answer, and numeric questions aligned with the AQA specification. Coverage gaps: none – full coverage achieved.
- Base verdict: revise
- Extension verdict: revise
- Reports: [Quiz](sample-quizzes/with-questions-c2-1examqs/quiz.md) · [Judge](sample-quizzes/with-questions-c2-1examqs/quiz-judgement.md) · [10 more](sample-quizzes/with-questions-c2-1examqs/quiz-extension.md) · [10 more judge](sample-quizzes/with-questions-c2-1examqs/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-extension-judgement.json)
- Image: [C2.1ExamQs.pdf](https://github.com/spark-ai/spark/blob/ce8344db8cee9a66e43b49357dc9c776f4243c2e/data/samples/with-questions/C2.1ExamQs.pdf)

### Sample 5: F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg (extraction)

- Source: F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg (data/samples/with-questions/F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg)
- Base quiz summary: This quiz contains 20 short-answer questions covering corrosion, alloys, polymers, composites, and the Haber process, aligned with the AQA GCSE Chemistry specification. Coverage gaps: NPK fertilisers are not covered.
- Base verdict: revise
- Extension verdict: approve
- Reports: [Quiz](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz.md) · [Judge](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-judgement.md) · [10 more](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension.md) · [10 more judge](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension-judgement.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz.json) · [Judge](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-judgement.json) · [10 more](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension.json) · [10 more judge](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension-judgement.json)
- Image: [F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg](https://github.com/spark-ai/spark/blob/ce8344db8cee9a66e43b49357dc9c776f4243c2e/data/samples/with-questions/F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg)
