# Eval Agent Notes

- For command-line entry points under `eval/src/**`, parse flags with Zod-backed helpers (see `src/tests/testLlmApi.ts`) instead of ad-hoc `process.argv` slicing. This keeps validation and defaults declarative and consistent with other CLI tools such as `code/session/generateTestStory.ts`.
