# PDF Transcription Agentic Benchmark

This is a separate benchmark from `pdf-transcription` (the multi-model comparison suite).

It runs one or more agentic workflows (in parallel when multiple models are provided) using:

- default model: `chatgpt-gpt-5.4-fast`
- production tools from `@spark/llm/agent/sparkAgentRunner`
- required extraction/crop tools: `pdf_to_images`, `read_pdf`, `crop_image`, `trim_image`, `draw_grid_overlay`, and `view_image`
- optional reference-text tool (enabled by default): `extract_pdf_reference_text`

Canonical workflow instructions are maintained in:

- `packages/llm/src/agent/skills/pdfTranscription.ts` (`PDF_TRANSCRIPTION_SKILL_TEXT`)

The benchmark writes that skill into `workspace/TASK.md` and instructs the agent to follow it.

It then runs two judges (`gemini-2.5-pro`, `chatgpt-gpt-5.3-codex-spark`) and reports pass/fail, latency, cost, and tool calls.

## Run

From repo root:

```bash
bun --cwd=eval run bench:pdf-transcription-agentic
```

Subagents are disabled by default. Enable them explicitly:

```bash
bun --cwd=eval run bench:pdf-transcription-agentic -- --use-subagents
```

Disable PDF reference-text extraction (image-only transcription mode):

```bash
bun --cwd=eval run bench:pdf-transcription-agentic -- --disable-reference-text
```

Single model override:

```bash
bun --cwd=eval run bench:pdf-transcription-agentic -- --model-id=gemini-2.5-pro
```

Parallel multi-model run:

```bash
bun --cwd=eval run bench:pdf-transcription-agentic -- --models=chatgpt-gpt-5.4-fast,chatgpt-gpt-5.3-codex-spark,gemini-2.5-pro,gemini-flash-latest
```

Optional custom PDF:

```bash
bun --cwd=eval run bench:pdf-transcription-agentic -- --source-pdf=/absolute/path/to/file.pdf
```

## Outputs

- Run workspace and logs: `eval/src/benchmarks/pdf-transcription-agentic/output/<model-id>/<timestamp>-<id>/`
- Summary JSON: `.../summary.json`
- Agent console log mirror: `.../agent.log`
- Per-agent logs when `--use-subagents` is enabled: `.../agent_main.log` and `.../agent_<agent_id>.log`
- Agent event stream log: `.../agent-log.jsonl`
- Run-local report: `.../RESULTS.md`
- Reference-text artifact when enabled: `workspace/output/reference/pdf-text.md`

The benchmark prints stage transitions and live agent events to console while it runs.
