# PDF Transcription Agentic Benchmark

This is a separate benchmark from `pdf-transcription` (the multi-model comparison suite).

It runs a single agentic workflow using:

- model: `chatgpt-gpt-5.3-codex`
- production tools from `@spark/llm/agent/sparkAgentRunner`
- required crop loop tools: `pdf_to_images`, `crop_image`, and `read_file`

The benchmark requires the agent to:

1. Render PDF pages.
2. Extract H1/H2/H3 diagrams with `bbox1000`.
3. Re-check crops and re-crop when extra text or clipping is present.
4. Produce markdown transcription and diagram manifest.

The full benchmark task is written into `workspace/task.md`; the runtime prompt only tells the agent to read that file and follow it.

It then runs two judges (`gemini-2.5-pro`, `chatgpt-gpt-5.3-codex`) and reports pass/fail, latency, cost, and tool calls.

## Run

From repo root:

```bash
bun --cwd=eval run bench:pdf-transcription-agentic
```

Optional custom PDF:

```bash
bun --cwd=eval run bench:pdf-transcription-agentic -- --source-pdf=/absolute/path/to/file.pdf
```

## Outputs

- Run workspace and logs: `eval/src/benchmarks/pdf-transcription-agentic/output/<run-id>/`
- Summary JSON: `.../summary.json`
- Agent console log mirror: `.../agent.log`
- Agent event stream log: `.../agent-log.jsonl`
- Auto-generated report: `eval/src/benchmarks/pdf-transcription-agentic/RESULTS.md`

The benchmark prints stage transitions and live agent events to console while it runs.
