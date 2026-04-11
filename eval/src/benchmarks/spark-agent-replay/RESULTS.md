# Spark Agent Grader Replay Results

Source run replayed for all rows:

- `data/spark-agent/2026-03-09T13-46-47-176Z/6f2b978f-eec5-4cbc-8831-3f2068381b8a`

Notes:

- `chatgpt-gpt-5.4-fast` replay exposes `thinkingLevel=low|medium|high`; there is no distinct replay-time `xhigh`. On this branch, `xhigh` is effectively an alias of `high`.
- Exact supported Gemini IDs used on this branch:
  - `gemini-3.1-pro-preview` for the requested Gemini 3.1 Pro row
  - `gemini-2.5-pro`
  - `gemini-flash-latest`
- The Gemini rows below are the post-fix reruns after the shared `@ljoukov/llm` Gemini function-call/history fix. Earlier March 9 Gemini failures were superseded by these reruns.

## ChatGPT GPT-5.4-fast

| Mode | State | Wall s | Model calls | Tool calls | Tokens `p/c/r/th/tot` | Cost | Output | Artifact |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| `low` | completed | 449.922 | 14 | 24 | `455267 / 359680 / 4593 / 2879 / 462739` | `$0.4410` + `$0.0171` tool LLM | Final grader output written | `output/2026-03-09T14-11-43-317Z/chatgpt-gpt-5-4` |
| `medium` | failed | 411.886 | 1 before failure | n/a | `14518 / 2560 / 69 / 49 / 14636` | `$0.0323` | No grader outputs | `output/2026-03-09T15-55-35-071Z/chatgpt-gpt-5-4` |
| `high` | stopped | 244.121 observed | 5 observed | n/a | `84519 / 37376 / 7661 / 25657 / 117837` | `$0.2255` observed | Only checkpoint; no grader outputs yet | `output/2026-03-09T14-05-44-647Z/chatgpt-gpt-5-4` |
| `xhigh` | alias of `high` | n/a | n/a | n/a | n/a | n/a | No separate run path on this branch | see `high` |

Key observations:

- `low` was the only completed `chatgpt-gpt-5.4-fast` run. It produced [summary.json](output/2026-03-09T14-11-43-317Z/chatgpt-gpt-5-4/summary.json) and [run-summary.json](output/2026-03-09T14-11-43-317Z/chatgpt-gpt-5-4/workspace/grader/output/run-summary.json), with a final score of `20/30`.
- `medium` failed in the `extract_text` path with `UND_ERR_BODY_TIMEOUT` during a `gemini-flash-latest` tool call.
- `high` reproduced the source-run bottleneck: much higher thinking-token spend early, but it still did not reach final grading output during observation.

## Gemini (post-fix reruns, `--disable-extract-text`)

| Model | State | Wall s | Model calls | Tool calls | Tokens `p/c/r/th/tot` | Cost | Output | Artifact |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| `gemini-3.1-pro-preview` | completed | 570.469 | 15 | 24 | `374192 / 195431 / 14017 / 345 / 388554` | `$0.5690` | Real grader outputs with totals/problems | `output/2026-03-10T10-54-54-115Z/gemini-3-1-pro-preview` |
| `gemini-2.5-pro` | completed | 533.633 | 12 | 11 | `81361 / 25022 / 2113 / 2969 / 86443` | `$0.1244` | Partial output contract only | `output/2026-03-10T11-02-20-056Z/gemini-2-5-pro` |
| `gemini-flash-latest` | completed | 112.123 | 12 | 15 | `204788 / 153450 / 3044 / 9641 / 217473` | `$0.0517` | Fastest/cheapest, but low-trust grading | `output/2026-03-10T11-02-19-989Z/gemini-flash-latest` |

Key observations:

- `gemini-3.1-pro-preview` is the strongest Gemini result after the shared llm fix. It produced [run-summary.json](output/2026-03-10T10-54-54-115Z/gemini-3-1-pro-preview/workspace/grader/output/run-summary.json) with `21/30` and three problem files:
  - [p1.md](output/2026-03-10T10-54-54-115Z/gemini-3-1-pro-preview/workspace/grader/output/problems/p1.md)
  - [p2.md](output/2026-03-10T10-54-54-115Z/gemini-3-1-pro-preview/workspace/grader/output/problems/p2.md)
  - [p3.md](output/2026-03-10T10-54-54-115Z/gemini-3-1-pro-preview/workspace/grader/output/problems/p3.md)
- `gemini-2.5-pro` got past the old Gemini-history failure mode, but its [run-summary.json](output/2026-03-10T11-02-20-056Z/gemini-2-5-pro/workspace/grader/output/run-summary.json) contains no `totals` or `problems`, and [grader/output/problems](output/2026-03-10T11-02-20-056Z/gemini-2-5-pro/workspace/grader/output/problems) is an empty file instead of a problem directory.
- `gemini-flash-latest` completed, but quality is not trustworthy:
  - [transcription.md](output/2026-03-10T11-02-19-989Z/gemini-flash-latest/workspace/grader/output/transcription.md) rewrites weak student answers into cleaner/correct ones and appends unrelated content.
  - [pB.md](output/2026-03-10T11-02-19-989Z/gemini-flash-latest/workspace/grader/output/problems/pB.md) misinterprets the suffix task and internally totals `9/11`, while [run-summary.json](output/2026-03-10T11-02-19-989Z/gemini-flash-latest/workspace/grader/output/run-summary.json) records `8/11`.
  - [pC.md](output/2026-03-10T11-02-19-989Z/gemini-flash-latest/workspace/grader/output/problems/pC.md) drops determiner items 8-10 and shrinks the section to `6/7`.

## Bottom Line

- Best overall completed run from the full matrix: `chatgpt-gpt-5.4-fast low`
- Best Gemini run after the shared llm fix: `gemini-3.1-pro-preview`
- Lowest cost / fastest Gemini run: `gemini-flash-latest`, but with the weakest output quality
- `gemini-2.5-pro` is unblocked by the llm-layer fix, but still needs stronger output-contract enforcement
