#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "${REPO_ROOT}" ]; then
  echo "error: not inside a git repository" >&2
  exit 1
fi
cd "${REPO_ROOT}"

if [ ! -f spark-data/.git ] && [ ! -d spark-data/.git ]; then
  echo "error: expected spark-data/.git to exist; initialize the submodule first" >&2
  exit 1
fi

if [ -n "$(git -C spark-data status --porcelain)" ]; then
  echo "error: spark-data has local changes; stash or commit them before syncing" >&2
  exit 1
fi

echo "info: fetching origin refs" >&2
git fetch origin >/dev/null

TARGET_SHA=$(git ls-tree origin/main spark-data | awk '{print $3}')
if [ -z "${TARGET_SHA}" ]; then
  echo "error: could not determine spark-data commit from origin/main" >&2
  exit 1
fi

echo "info: origin/main references spark-data @ ${TARGET_SHA}" >&2

CURRENT_SHA=$(git -C spark-data rev-parse HEAD)
if [ "${CURRENT_SHA}" = "${TARGET_SHA}" ]; then
  echo "info: spark-data already at requested commit" >&2
else
  echo "info: fetching spark-data remote" >&2
  git -C spark-data fetch origin >/dev/null

  echo "info: checking out spark-data @ ${TARGET_SHA}" >&2
  git -C spark-data checkout "${TARGET_SHA}" >/dev/null
fi

QUIZ_ROOT="spark-data/quiz"
EVAL_OUTPUT_DIR="${QUIZ_ROOT}/eval-output"
EVAL_OUTPUT_ARCHIVE="${QUIZ_ROOT}/eval-output.tar.gz"

if [ -d "${EVAL_OUTPUT_DIR}" ]; then
  echo "info: ${EVAL_OUTPUT_DIR} already exists; leaving as-is" >&2
else
  if ! git -C spark-data lfs version >/dev/null 2>&1; then
    echo "warn: git-lfs not installed; skipping eval-output unpack" >&2
  else
    echo "info: ensuring ${EVAL_OUTPUT_ARCHIVE} is available via git-lfs" >&2
    git -C spark-data lfs pull --include="quiz/eval-output.tar.gz" --exclude="" >/dev/null

    if [ -f "${EVAL_OUTPUT_ARCHIVE}" ]; then
      echo "info: unpacking ${EVAL_OUTPUT_ARCHIVE}" >&2
      mkdir -p "${QUIZ_ROOT}"
      tar -xzf "${EVAL_OUTPUT_ARCHIVE}" -C "${QUIZ_ROOT%/}" >/dev/null
    else
      echo "warn: ${EVAL_OUTPUT_ARCHIVE} missing after lfs pull; skipping unpack" >&2
    fi
  fi
fi

echo "done: spark-data checkout synced to origin/main" >&2
