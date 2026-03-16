# Spark Agent Replay Benchmark

This benchmark replays a persisted Spark grader run from `data/spark-agent/...` so you can rerun the same task with a different model or `thinkingLevel`.

It is intended for grading-agent benchmarking first. The replay uses the same Spark grader tools and starts from the same initial workspace state that the original run saw.

## What It Replays

The benchmark requires replay artifacts captured inside the persisted workspace:

- `.spark-agent-replay/manifest.json`
- `.spark-agent-replay/initial-workspace/**`

Older grader runs that predate those artifacts are intentionally unsupported and should fail fast.

## Run

From repo root:

```bash
bun --cwd=eval run bench:spark-agent-replay -- \
  --run-path data/spark-agent/<timestamp>/<workspace-id>
```

Replay the same run with lower thinking:

```bash
bun --cwd=eval run bench:spark-agent-replay -- \
  --run-path data/spark-agent/<timestamp>/<workspace-id> \
  --thinking low
```

Optional model override:

```bash
bun --cwd=eval run bench:spark-agent-replay -- \
  --run-path data/spark-agent/<timestamp>/<workspace-id> \
  --model-id chatgpt-gpt-5.4
```

## How It Works

1. It copies the captured replay snapshot into a fresh local workspace under `output/`.
2. It writes the resolved prompt and system prompt into the run directory for inspection.
3. It runs the local Spark grader agent with the requested model, `thinkingLevel`, subagent setting, and max-step limit.
4. It writes a machine-readable summary plus full tool-loop traces.

## Outputs

All output stays under:

- `eval/src/benchmarks/spark-agent-replay/output/<timestamp>/<model>/`

Each run directory includes:

- `prompt.txt`
- `system-prompt.txt`
- `summary.json`
- `event-log.json`
- `workspace/`

The replay workspace contains the cloned inputs plus normal Spark agent logs such as:

- `workspace/logs/agent/agent.log`
- `workspace/logs/agent/llm_calls/**`
- `workspace/logs/agent/tool_calls/**`

## Current Results

This repository intentionally does not commit benchmark outputs or benchmark conclusions for this tool yet.

Local replay runs may contain confidential student work, derived summaries, marks, filenames, screenshots, and copied workspace artifacts. Because of that, all run output belongs under the ignored `output/` directory only.

If you want to compare models or thinking settings, run the benchmark locally and inspect the generated `summary.json`, `event-log.json`, and `workspace/logs/agent/**` traces.
