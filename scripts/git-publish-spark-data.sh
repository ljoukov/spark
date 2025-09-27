#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 \"spark-data commit msg\" [\"super repo commit msg\"]" >&2
  exit 1
fi

SUBMODULE_COMMIT_MSG=$1
SUPER_COMMIT_MSG_INPUT=${2:-}

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "${REPO_ROOT}" ]; then
  echo "error: not inside a git repository" >&2
  exit 1
fi
cd "${REPO_ROOT}"

if [ ! -f spark-data/.git ] && [ ! -d spark-data/.git ]; then
  echo "error: expected spark-data submodule to be present" >&2
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "${CURRENT_BRANCH}" != "main" ]; then
  echo "error: checkout main in the super repo before publishing spark-data" >&2
  exit 1
fi

DIRTY_SUPER=$(git status --porcelain | grep -v ' spark-data$' || true)
if [ -n "${DIRTY_SUPER}" ]; then
  echo "error: super repo has other changes; commit or stash them first" >&2
  echo "details:\n${DIRTY_SUPER}" >&2
  exit 1
fi

echo "info: fetching origin to verify main is up to date" >&2
git fetch origin >/dev/null
LOCAL_MAIN=$(git rev-parse HEAD)
REMOTE_MAIN=$(git rev-parse origin/main)
if [ "${LOCAL_MAIN}" != "${REMOTE_MAIN}" ]; then
  echo "error: local main is not aligned with origin/main; fast-forward before publishing" >&2
  exit 1
fi

pushd spark-data >/dev/null

if [ -z "$(git status --porcelain)" ]; then
  echo "error: no changes detected in spark-data" >&2
  popd >/dev/null
  exit 1
fi

if [ -d eval-output ]; then
  if git lfs version >/dev/null 2>&1; then
    echo "info: packaging eval-output/ into eval-output.tar.gz" >&2
    rm -f eval-output.tar.gz
    tar -czf eval-output.tar.gz eval-output
  else
    echo "error: git-lfs is required to package eval-output/" >&2
    popd >/dev/null
    exit 1
  fi
fi

if [ -f eval-output.tar.gz ]; then
  git add eval-output.tar.gz
else
  echo "warn: eval-output.tar.gz not found; nothing to add" >&2
fi

SUBMODULE_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || true)
if [ -z "${SUBMODULE_BRANCH}" ]; then
  echo "error: spark-data is in detached HEAD; checkout a branch before publishing" >&2
  popd >/dev/null
  exit 1
fi

echo "info: committing spark-data changes on ${SUBMODULE_BRANCH}" >&2
git add -A
git commit -m "${SUBMODULE_COMMIT_MSG}"

NEW_SUBMODULE_SHA=$(git rev-parse HEAD)
NEW_SUBMODULE_SHORT=$(git rev-parse --short HEAD)

echo "info: pushing spark-data/${SUBMODULE_BRANCH} to origin" >&2
git push origin "${SUBMODULE_BRANCH}"

popd >/dev/null

git add spark-data

if [ -z "${SUPER_COMMIT_MSG_INPUT}" ]; then
  SUPER_COMMIT_MSG="[chore] update spark-data to ${NEW_SUBMODULE_SHORT}"
else
  SUPER_COMMIT_MSG=${SUPER_COMMIT_MSG_INPUT}
fi

echo "info: committing super repo pointer update" >&2
git commit -m "${SUPER_COMMIT_MSG}"

echo "info: pushing main to origin" >&2
git push origin main

echo "done: spark-data changes published and super repo updated" >&2
