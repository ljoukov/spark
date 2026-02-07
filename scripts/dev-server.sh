#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="spark-dev-https"
DEFAULT_PORT="8081"
LOG_FILE="/tmp/${SESSION_NAME}.log"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"

usage() {
  cat <<EOF >&2
Usage:
  $(basename "$0") <start|stop|restart|logs> [port]

Examples:
  $(basename "$0") start
  $(basename "$0") restart 8082
  $(basename "$0") stop
  $(basename "$0") logs
EOF
}

require_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux is required but was not found in PATH." >&2
    exit 1
  fi
}

require_https_certs() {
  local cert_dir="${HOME}/.localhost-certs"
  local key_path="${cert_dir}/localhost-key.pem"
  local cert_path="${cert_dir}/localhost.pem"
  if [[ -f "${key_path}" && -f "${cert_path}" ]]; then
    return 0
  fi
  echo "HTTPS dev requires trusted local certs." >&2
  echo "Expected:" >&2
  echo "  key:  ${key_path}" >&2
  echo "  cert: ${cert_path}" >&2
  exit 1
}

validate_port() {
  local port="${1}"
  if [[ -z "${port}" ]]; then
    echo "port is required" >&2
    exit 2
  fi
  if [[ ! "${port}" =~ ^[0-9]+$ ]]; then
    echo "invalid port: ${port}" >&2
    exit 2
  fi
  if (( port < 1 || port > 65535 )); then
    echo "invalid port: ${port}" >&2
    exit 2
  fi
}

session_exists() {
  tmux has-session -t "${SESSION_NAME}" 2>/dev/null
}

start_session() {
  local port="${1}"
  if session_exists; then
    echo "tmux session ${SESSION_NAME} is already running"
    echo "Attach: tmux attach -t ${SESSION_NAME}"
    echo "Logs: ${LOG_FILE}"
    return 0
  fi

  local cmd="cd \"${WEB_DIR}\" && VITE_DEV_PORT=${port} VITE_DEV_AUTH_HOST=localhost:${port} bun run dev:https 2>&1 | tee \"${LOG_FILE}\""
  tmux new-session -d -s "${SESSION_NAME}" "${cmd}"

  echo "Started ${SESSION_NAME}"
  echo "URL: https://localhost:${port}/"
  echo "Attach: tmux attach -t ${SESSION_NAME}"
  echo "Logs: ${LOG_FILE}"
}

stop_session() {
  if ! session_exists; then
    echo "tmux session ${SESSION_NAME} is not running"
    return 0
  fi
  tmux kill-session -t "${SESSION_NAME}"
  echo "Stopped ${SESSION_NAME}"
}

tail_logs() {
  if [[ ! -f "${LOG_FILE}" ]]; then
    echo "Log file not found: ${LOG_FILE}" >&2
    echo "Start the server first: $(basename "$0") start [port]" >&2
    exit 1
  fi
  echo "Tailing ${LOG_FILE} (Ctrl+C to stop)"
  tail -n 50 -f "${LOG_FILE}"
}

ACTION="${1:-}"
PORT="${2:-${DEFAULT_PORT}}"

if [[ -z "${ACTION}" ]]; then
  usage
  exit 2
fi

case "${ACTION}" in
  start)
    require_tmux
    validate_port "${PORT}"
    require_https_certs
    start_session "${PORT}"
    ;;
  stop)
    require_tmux
    stop_session
    ;;
  restart)
    require_tmux
    validate_port "${PORT}"
    require_https_certs
    stop_session
    start_session "${PORT}"
    ;;
  logs)
    tail_logs
    ;;
  *)
    usage
    exit 2
    ;;
esac
