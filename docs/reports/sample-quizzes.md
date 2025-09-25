# Sample Quiz Generation Report

- Generated at: 2025-09-25T08:17:56.524Z
- Commit: 6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9
- Prompt sources:
  - [web/src/lib/server/llm/quizPrompts.ts](https://github.com/spark-ai/spark/blob/6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9/web/src/lib/server/llm/quizPrompts.ts)
  - [web/src/lib/server/llm/quizGenerator.ts](https://github.com/spark-ai/spark/blob/6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9/web/src/lib/server/llm/quizGenerator.ts)
  - [web/src/lib/server/llm/judge.ts](https://github.com/spark-ai/spark/blob/6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9/web/src/lib/server/llm/judge.ts)
  - [web/src/lib/slop/judge.ts](https://github.com/spark-ai/spark/blob/6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9/web/src/lib/slop/judge.ts)

## Samples

### Sample 1: Y8Lesson-Health-BloodDonations.pdf (synthesis)

- Source: Y8Lesson-Health-BloodDonations.pdf (data/samples/no-questions/Y8Lesson-Health-BloodDonations.pdf)
- Base quiz summary: This quiz covers key aspects of blood, organ, and stem cell donation, aligning with GCSE Biology (OCR specification). It includes questions on the importance of donation, the types of individuals who might need donations, the processes involved in blood and stem cell donation, and the legal framework surrounding organ donation in England. The quiz features a mix of multiple-choice, short-answer, true/false, and numeric questions to assess a range of recall and analytical skills.
- Quality verdict: approve
- Slop risk: 0.087 (clean)
- Extension: 10 questions (generated 2025-09-25T08:03:51.896Z)
- Extension quality verdict: approve
- Extension slop risk: 0.000 (clean)
- Reports: [Quiz](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz.md) · [Quality judge](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-judgement.md) · [Slop](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-slop.md) · [Extension quiz](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension.md) · [Extension judge](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension-judgement.md) · [Extension slop](sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension-slop.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz.json) · [Quality judge](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-judgement.json) · [Slop](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-slop.json) · [Extension](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension.json) · [Extension judge](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension-judgement.json) · [Extension slop](../../web/static/admin/sample-quizzes/no-questions-y8lesson-health-blooddonations/quiz-extension-slop.json)
- Image: [Y8Lesson-Health-BloodDonations.pdf](https://github.com/spark-ai/spark/blob/6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9/data/samples/no-questions/Y8Lesson-Health-BloodDonations.pdf)

### Sample 2: 18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg (extraction)

- Source: 18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg (data/samples/with-questions/18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg)
- Base quiz summary: This quiz covers fundamental concepts in GCSE Chemistry C1, focusing on atomic structure, historical models of the atom, properties of sub-atomic particles, and methods for separating mixtures. It includes a mix of recall and understanding questions, with 3 multiple-choice and 3 short-answer items. The difficulty ranges from foundation to higher.
- Quality verdict: approve
- Slop risk: 0.000 (clean)
- Extension: 10 questions (generated 2025-09-25T08:06:56.183Z)
- Extension quality verdict: revise
- Extension slop risk: 0.313 (clean)
- Reports: [Quiz](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz.md) · [Quality judge](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-judgement.md) · [Slop](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-slop.md) · [Extension quiz](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension.md) · [Extension judge](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension-judgement.md) · [Extension slop](sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension-slop.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz.json) · [Quality judge](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-judgement.json) · [Slop](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-slop.json) · [Extension](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension.json) · [Extension judge](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension-judgement.json) · [Extension slop](../../web/static/admin/sample-quizzes/with-questions-18fcf3eb-957a-4922-86c8-28cf0f1ca467-1-105-c/quiz-extension-slop.json)
- Image: [18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg](https://github.com/spark-ai/spark/blob/6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9/data/samples/with-questions/18FCF3EB-957A-4922-86C8-28CF0F1CA467_1_105_c.jpeg)

### Sample 3: 966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg (extraction)

- Source: 966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg (data/samples/with-questions/966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg)
- Base quiz summary: This quiz covers fundamental concepts of covalent bonding, including its formation, the types of atoms involved, and the properties and structures of different covalent substances. It includes questions on giant covalent structures, simple molecular structures, and carbon allotropes such as graphite and graphene. The quiz features a mix of multiple-choice and short-answer questions, focusing on recall and explanation skills. All questions are directly extracted from the provided C2 Retrieval practice material, ensuring close alignment with the source content.
- Quality verdict: revise
- Slop risk: 0.063 (clean)
- Extension: 10 questions (generated 2025-09-25T08:09:56.326Z)
- Extension quality verdict: approve
- Extension slop risk: 0.263 (clean)
- Reports: [Quiz](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz.md) · [Quality judge](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-judgement.md) · [Slop](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-slop.md) · [Extension quiz](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension.md) · [Extension judge](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension-judgement.md) · [Extension slop](sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension-slop.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz.json) · [Quality judge](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-judgement.json) · [Slop](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-slop.json) · [Extension](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension.json) · [Extension judge](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension-judgement.json) · [Extension slop](../../web/static/admin/sample-quizzes/with-questions-966860a9-bfd8-436c-958d-2470ed154da6-1-105-c/quiz-extension-slop.json)
- Image: [966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg](https://github.com/spark-ai/spark/blob/6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9/data/samples/with-questions/966860A9-BFD8-436C-958D-2470ED154DA6_1_105_c.jpeg)

### Sample 4: C2.1ExamQs.pdf (extraction)

- Source: C2.1ExamQs.pdf (data/samples/with-questions/C2.1ExamQs.pdf)
- Base quiz summary: This quiz covers key concepts in GCSE Chemistry, focusing on states of matter, changes of state, interpretation of melting and boiling point data from graphs, experimental techniques for determining these points, and the particle model of gases. It includes 3 multiple-choice questions and 3 short-answer questions, providing a balanced assessment of recall, application, and analytical skills. The quiz aligns with AQA GCSE Triple Science Chemistry specifications.
- Quality verdict: revise
- Slop risk: 0.550 (flagged)
- Extension: 10 questions (generated 2025-09-25T08:13:50.312Z)
- Extension quality verdict: approve
- Extension slop risk: 0.625 (flagged)
- Reports: [Quiz](sample-quizzes/with-questions-c2-1examqs/quiz.md) · [Quality judge](sample-quizzes/with-questions-c2-1examqs/quiz-judgement.md) · [Slop](sample-quizzes/with-questions-c2-1examqs/quiz-slop.md) · [Extension quiz](sample-quizzes/with-questions-c2-1examqs/quiz-extension.md) · [Extension judge](sample-quizzes/with-questions-c2-1examqs/quiz-extension-judgement.md) · [Extension slop](sample-quizzes/with-questions-c2-1examqs/quiz-extension-slop.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz.json) · [Quality judge](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-judgement.json) · [Slop](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-slop.json) · [Extension](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-extension.json) · [Extension judge](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-extension-judgement.json) · [Extension slop](../../web/static/admin/sample-quizzes/with-questions-c2-1examqs/quiz-extension-slop.json)
- Image: [C2.1ExamQs.pdf](https://github.com/spark-ai/spark/blob/6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9/data/samples/with-questions/C2.1ExamQs.pdf)

### Sample 5: F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg (extraction)

- Source: F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg (data/samples/with-questions/F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg)
- Base quiz summary: This quiz covers 6 key chemistry concepts from the C20 section of the AQA GCSE Triple Science specification. It includes a mix of knowledge recall and application questions, focusing on corrosion, alloys, industrial processes (Haber process), and fertilisers. The questions are primarily multiple-choice with one short-answer question, offering a balanced assessment of understanding. Some questions required minor typo corrections for accuracy.
- Quality verdict: approve
- Slop risk: 0.287 (clean)
- Extension: 10 questions (generated 2025-09-25T08:16:56.299Z)
- Extension quality verdict: revise
- Extension slop risk: 0.063 (clean)
- Reports: [Quiz](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz.md) · [Quality judge](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-judgement.md) · [Slop](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-slop.md) · [Extension quiz](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension.md) · [Extension judge](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension-judgement.md) · [Extension slop](sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension-slop.md)
- JSON: [Quiz](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz.json) · [Quality judge](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-judgement.json) · [Slop](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-slop.json) · [Extension](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension.json) · [Extension judge](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension-judgement.json) · [Extension slop](../../web/static/admin/sample-quizzes/with-questions-f503558b-56e2-4fb4-b7c9-788a6231bba3-1-105-c/quiz-extension-slop.json)
- Image: [F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg](https://github.com/spark-ai/spark/blob/6d79996708e82ea8dfb4d6e01e2ecb6862cdafa9/data/samples/with-questions/F503558B-56E2-4FB4-B7C9-788A6231BBA3_1_105_c.jpeg)
