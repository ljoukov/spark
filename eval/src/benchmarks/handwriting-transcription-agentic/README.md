# Handwriting Transcription Agentic Benchmark

This benchmark runs one or more agentic workflows (in parallel when multiple models are provided) to transcribe student handwriting with iterative ambiguity resolution:

- pass 1: call `extract_text` with `documentPaths: [clipboard-1.png]`, plus `supportingPaths` for `hamilton2017-h1-h2.jpg` -> `output/transcription_v1.md`
- pass 2: verify with `view_image` + `read_file`, then correct ambiguities -> `output/transcription_v2.md`
- pass 3: add official solutions `hamilton-2017-solutions-p1.jpg` + `hamilton-2017-solutions-p2.jpg` -> `output/transcription_v3.md`

The task enforces a lightweight flow: one `extract_text` pass followed by one verification/cleanup pass (`view_image` handwriting + `view_image` context + `read_file` extraction), with uncertainty markers instead of iterative crop loops.
The benchmark is agent-only and does not run separate judge models.

## Run

From repo root:

```bash
bun --cwd=eval run bench:handwriting-transcription-agentic
```

Subagents are disabled by default. Enable them explicitly:

```bash
bun --cwd=eval run bench:handwriting-transcription-agentic -- --use-subagents
```

Single model override:

```bash
bun --cwd=eval run bench:handwriting-transcription-agentic -- --model-id=gemini-2.5-pro
```

Parallel multi-model run:

```bash
bun --cwd=eval run bench:handwriting-transcription-agentic -- --models=chatgpt-gpt-5.3-codex,chatgpt-gpt-5.3-codex-spark,gemini-2.5-pro,gemini-flash-latest
```

Optional custom data paths:

```bash
bun --cwd=eval run bench:handwriting-transcription-agentic -- \
  --handwriting-image=/absolute/path/clipboard.png \
  --problems-image=/absolute/path/problems.jpg \
  --solutions-p1-image=/absolute/path/solutions-p1.jpg \
  --solutions-p2-image=/absolute/path/solutions-p2.jpg
```

## Outputs

- Run workspace and logs: `eval/src/benchmarks/handwriting-transcription-agentic/output/<model-id>/<timestamp>-<id>/`
- Summary JSON: `.../summary.json`
- Agent console log mirror: `.../agent.log`
- Per-agent logs when `--use-subagents` is enabled: `.../agent_main.log` and `.../agent_<agent_id>.log`
- Agent event stream log: `.../agent-log.jsonl`
- Run-local report: `.../RESULTS.md`
