# Handwriting Transcription Agentic Benchmark

This benchmark runs one or more agentic workflows (in parallel when multiple models are provided) over an attached file bundle.

The agent is expected to infer file roles from content (handwritten student work, problem statements, and optional official solutions), transcribe all files with one `extract_text` call, and produce grading + feedback output. If official solutions are missing, the agent should solve problems itself and use those solutions as reference.

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
bun --cwd=eval run bench:handwriting-transcription-agentic -- --models=chatgpt-gpt-5.5-fast,chatgpt-gpt-5.3-codex-spark,gemini-2.5-pro,gemini-flash-latest
```

Optional custom data paths (repeat `--file` as needed):

```bash
bun --cwd=eval run bench:handwriting-transcription-agentic -- \
  --file=/absolute/path/student-work-1.png \
  --file=/absolute/path/problem-sheet.pdf \
  --file=/absolute/path/official-solutions.jpg
```

Or pass a comma-separated list:

```bash
bun --cwd=eval run bench:handwriting-transcription-agentic -- \
  --files=/absolute/path/student-work.png,/absolute/path/problems.pdf
```

## Outputs

- Run workspace and logs: `eval/src/benchmarks/handwriting-transcription-agentic/output/<model-id>/<timestamp>-<id>/`
- Summary JSON: `.../summary.json`
- Agent console log mirror: `.../agent.log`
- Per-agent logs when `--use-subagents` is enabled: `.../agent_main.log` and `.../agent_<agent_id>.log`
- Agent event stream log: `.../agent-log.jsonl`
- Run-local report: `.../RESULTS.md`
