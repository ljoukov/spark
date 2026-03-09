# Spark Agent Replay Benchmark

- Scope: applies to `eval/src/benchmarks/spark-agent-replay/**`.
- Keep all benchmark run artifacts under `output/`. That directory is local-only and must stay uncommitted.
- Do not commit real Spark run paths, copied workspaces, screenshots, prompt text, summaries, marks, or any other content derived from real student submissions.
- Examples in docs, comments, and commit messages must use placeholders or synthetic data only, for example `data/spark-agent/<timestamp>/<workspace-id>`.
- If you need a durable fixture or example artifact for tests/docs, create a redacted synthetic sample instead of reusing a real grader run.
