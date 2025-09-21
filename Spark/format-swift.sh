#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/.swift-format"
TARGET_DIR="${1:-$SCRIPT_DIR}"

if ! command -v swift-format >/dev/null 2>&1; then
  echo "swift-format is not installed or not on PATH" >&2
  exit 1
fi

swift-format format \
  --in-place \
  --recursive \
  --configuration "$CONFIG_FILE" \
  "$TARGET_DIR"
