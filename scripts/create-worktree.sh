#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <worktree-path> [branch-name]" >&2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required but was not found in PATH." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
target_path="$1"
branch_name="${2:-}"

if [ -e "$target_path" ]; then
  echo "Target path already exists: $target_path" >&2
  exit 1
fi

cd "$repo_root"

if [ -n "$branch_name" ]; then
  if git show-ref --verify --quiet "refs/heads/$branch_name"; then
    git worktree add "$target_path" "$branch_name"
  else
    case "$branch_name" in
      l-*)
        ;;
      *)
        echo "New branch names must use the l- prefix: $branch_name" >&2
        exit 1
        ;;
    esac

    git worktree add -b "$branch_name" "$target_path" origin/main
  fi
else
  git worktree add --detach "$target_path" origin/main
fi

cd "$target_path"

SPARK_ENV_SOURCE="${SPARK_ENV_SOURCE:-$HOME/projects/spark}"

copy_env_file() {
  local relative_path="$1"
  local source_path="$SPARK_ENV_SOURCE/$relative_path"

  if [ ! -f "$source_path" ]; then
    return
  fi

  mkdir -p "$(dirname "$relative_path")"
  cp "$source_path" "$relative_path"
}

copy_env_file ".env.local"
copy_env_file "eval/.env.local"
copy_env_file "web/.env.local"

# Ensure dev dependencies are present even if the caller exported NODE_ENV=production.
export NODE_ENV=development
bun install --frozen-lockfile
bun --cwd=web install
bun --cwd=eval install

echo "Spark worktree ready at $target_path"
