#!/usr/bin/env bash
set -euo pipefail

resolve_rebase_conflicts_in_favor_of_local() {
  while true; do
    local conflict_lines
    conflict_lines=$(git status --porcelain | grep -E '^(UU|AA|AU|UA|DU|UD|DD) ' || true)
    if [ -z "${conflict_lines}" ]; then
      echo "error: rebase conflict resolution failed; please resolve manually" >&2
      git rebase --abort >/dev/null 2>&1 || true
      return 1
    fi

    while IFS= read -r line; do
      [ -z "${line}" ] && continue
      local status path
      status=${line:0:2}
      path=${line:3}
      if [[ "${path}" == *" -> "* ]]; then
        path=${path##* -> }
      fi

      case "${status}" in
        UD|DD)
          echo "info: keeping local deletion for ${path}" >&2
          git rm --force -- "${path}" >/dev/null 2>&1 || true
          ;;
        *)
          if git checkout --theirs -- "${path}" >/dev/null 2>&1; then
            git add -- "${path}"
          else
            git rm --force -- "${path}" >/dev/null 2>&1 || true
          fi
          ;;
      esac
    done <<< "${conflict_lines}"

    if git rebase --continue >/dev/null 2>&1; then
      break
    fi
  done

  return 0
}

auto_rebase_with_local_priority() {
  local upstream=$1
  if [ -z "${upstream}" ] || [ "${upstream}" = "@{u}" ]; then
    echo "error: missing upstream reference for spark-data branch" >&2
    return 1
  fi

  local remote=${upstream%%/*}
  local remote_branch=${upstream#*/}

  if [ -z "${remote}" ] || [ "${remote}" = "${upstream}" ]; then
    echo "error: unable to determine remote from upstream ${upstream}" >&2
    return 1
  fi

  echo "info: fetching ${remote}/${remote_branch} to sync upstream state" >&2
  git fetch "${remote}" >/dev/null

  if ! git rev-parse --verify "${upstream}" >/dev/null 2>&1; then
    echo "info: upstream ${upstream} not found; assuming first publish" >&2
    return 0
  fi

  local head_sha upstream_sha
  head_sha=$(git rev-parse HEAD)
  upstream_sha=$(git rev-parse "${upstream}")
  if [ "${head_sha}" = "${upstream_sha}" ]; then
    return 0
  fi

  echo "info: rebasing spark-data onto ${upstream} preferring local changes" >&2
  if git -c rebase.backend=merge rebase -X theirs "${upstream}" >/dev/null 2>&1; then
    return 0
  fi

  echo "info: resolving rebase conflicts automatically" >&2
  if ! resolve_rebase_conflicts_in_favor_of_local; then
    return 1
  fi

  return 0
}

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

DIRTY_SUPER=$(git status --porcelain | grep -v ' spark-data$' | sed '/scripts\/git-publish-spark-data.sh$/d' || true)
if [ -n "${DIRTY_SUPER}" ]; then
  echo "info: super repo has additional changes; they will remain unstaged" >&2
fi

pushd spark-data >/dev/null

SUBMODULE_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || true)
SUBMODULE_UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
SUBMODULE_REMOTE="origin"
SUBMODULE_REMOTE_BRANCH=""

if [ -n "${SUBMODULE_UPSTREAM}" ]; then
  SUBMODULE_REMOTE=${SUBMODULE_UPSTREAM%%/*}
  SUBMODULE_REMOTE_BRANCH=${SUBMODULE_UPSTREAM#*/}
  if [ -z "${SUBMODULE_REMOTE}" ] || [ "${SUBMODULE_REMOTE}" = "${SUBMODULE_UPSTREAM}" ]; then
    echo "error: could not determine remote for ${SUBMODULE_UPSTREAM}" >&2
    popd >/dev/null
    exit 1
  fi
fi

if [ -z "${SUBMODULE_BRANCH}" ]; then
  if [ -z "${SUBMODULE_REMOTE_BRANCH}" ]; then
    DEFAULT_REMOTE_HEAD=$(git symbolic-ref --short "refs/remotes/${SUBMODULE_REMOTE}/HEAD" 2>/dev/null || true)
    if [ -n "${DEFAULT_REMOTE_HEAD}" ]; then
      SUBMODULE_REMOTE_BRANCH=${DEFAULT_REMOTE_HEAD#*/}
    fi
  fi

  if [ -z "${SUBMODULE_REMOTE_BRANCH}" ]; then
    SUBMODULE_REMOTE_BRANCH="main"
  fi

  SUBMODULE_BRANCH=${SUBMODULE_REMOTE_BRANCH}
  echo "info: spark-data HEAD detached; operating against ${SUBMODULE_REMOTE}/${SUBMODULE_REMOTE_BRANCH}" >&2
fi

if [ -z "${SUBMODULE_REMOTE_BRANCH}" ]; then
  SUBMODULE_REMOTE_BRANCH=${SUBMODULE_BRANCH}
  echo "info: no upstream configured; defaulting to ${SUBMODULE_REMOTE}/${SUBMODULE_REMOTE_BRANCH}" >&2
elif [ -z "${SUBMODULE_UPSTREAM}" ]; then
  echo "info: no upstream configured; defaulting to ${SUBMODULE_REMOTE}/${SUBMODULE_REMOTE_BRANCH}" >&2
fi

SUBMODULE_UPSTREAM="${SUBMODULE_REMOTE}/${SUBMODULE_REMOTE_BRANCH}"

SUBMODULE_STATUS=$(git status --porcelain)

if [ -n "${SUBMODULE_STATUS}" ]; then
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

  echo "info: committing spark-data changes on ${SUBMODULE_BRANCH}" >&2
  git add -A
  git commit -m "${SUBMODULE_COMMIT_MSG}"
else
  echo "info: spark-data working tree clean; using existing commits" >&2
fi

if ! auto_rebase_with_local_priority "${SUBMODULE_UPSTREAM}"; then
  echo "error: failed to rebase spark-data with local preference" >&2
  popd >/dev/null
  exit 1
fi

NEW_SUBMODULE_SHA=$(git rev-parse HEAD)
NEW_SUBMODULE_SHORT=$(git rev-parse --short HEAD)

NEED_SUBMODULE_PUSH=1
if git rev-parse --verify "${SUBMODULE_UPSTREAM}" >/dev/null 2>&1; then
  UPSTREAM_SHA=$(git rev-parse "${SUBMODULE_UPSTREAM}")
  if [ "${NEW_SUBMODULE_SHA}" = "${UPSTREAM_SHA}" ]; then
    NEED_SUBMODULE_PUSH=0
  fi
else
  NEED_SUBMODULE_PUSH=1
fi

if [ "${NEED_SUBMODULE_PUSH}" -eq 1 ]; then
  echo "info: pushing spark-data/${SUBMODULE_BRANCH} to ${SUBMODULE_REMOTE}/${SUBMODULE_REMOTE_BRANCH}" >&2
  if ! git push "${SUBMODULE_REMOTE}" "HEAD:${SUBMODULE_REMOTE_BRANCH}"; then
    echo "warn: push rejected; re-syncing upstream and retrying" >&2
    if ! auto_rebase_with_local_priority "${SUBMODULE_UPSTREAM}"; then
      echo "error: unable to reconcile spark-data branch with upstream" >&2
      popd >/dev/null
      exit 1
    fi
    NEW_SUBMODULE_SHA=$(git rev-parse HEAD)
    NEW_SUBMODULE_SHORT=$(git rev-parse --short HEAD)
    if ! git push "${SUBMODULE_REMOTE}" "HEAD:${SUBMODULE_REMOTE_BRANCH}"; then
      echo "error: push still rejected; resolve conflicts manually" >&2
      popd >/dev/null
      exit 1
    fi
  fi
else
  echo "info: spark-data branch already in sync with ${SUBMODULE_UPSTREAM}; skipping push" >&2
fi

popd >/dev/null

git add spark-data

if git diff --cached --quiet -- spark-data; then
  echo "info: no super repo changes detected; skipping commit" >&2
  exit 0
fi

if [ -z "${SUPER_COMMIT_MSG_INPUT}" ]; then
  SUPER_COMMIT_MSG="[chore] update spark-data to ${NEW_SUBMODULE_SHORT}"
else
  SUPER_COMMIT_MSG=${SUPER_COMMIT_MSG_INPUT}
fi

echo "info: committing super repo pointer update" >&2
git commit -m "${SUPER_COMMIT_MSG}"

echo "info: pushing main to origin" >&2
if ! git push origin main; then
  echo "error: failed to push main; update your local main (e.g. git pull --ff-only origin main) and rerun" >&2
  exit 1
fi

echo "done: spark-data changes published and super repo updated" >&2
