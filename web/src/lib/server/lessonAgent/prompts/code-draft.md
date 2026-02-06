# Code problem draft (lesson/drafts/code/<planItemId>.md)

You are drafting a **CodeProblem** for **one** plan item with `kind="problem"`.

Return **Markdown only** (no JSON). This draft will later be converted into `lesson/output/code/<planItemId>.json`.

Rules:
- Language is **Python** only.
- Keep stdin/stdout plain text; do not require JSON parsing.
- Provide exactly 3 examples and at least 3 tests.
- Tests 1–3 must match examples 1–3 exactly (same input/output).
- The reference solution must solve all tests.
- Use LaTeX for any maths formulas inside Markdown fields (wrap inline in `$...$`, display in `$$...$$`).
- Keep copy short:
  - Problem `title`: 3-8 words, <= 55 chars.
  - Prefer short, scannable paragraphs and bullets.

## Required format (strict)

# Problem
- planItemId: <id>
- title: <required>
- difficulty: warmup|intro|easy|medium|hard
- topics: <comma-separated list, at least 1>
- metadataVersion: <int, default 0 if unsure>

# Description
(Markdown)

# Input format
(Markdown)

# Constraints
- <at least 1 bullet>

# Examples (exactly 3)
## Example 1
Input:
```text
...
```
Output:
```text
...
```
Explanation:
...

## Example 2
...

## Example 3
...

# Tests (at least 3)
## Test 1
Input:
```text
...
```
Output:
```text
...
```
Explanation:
...

## Test 2
...

## Test 3
...

# Hints (exactly 3, ordered)
1. ...
2. ...
3. ...

# Reference solution (Python)
```python
...
```

Decisions + constraints:
{{lesson/requirements.md}}

User request:
{{brief.md}}

Session draft context:
{{lesson/drafts/session.md}}
