#!/usr/bin/env bash
# Hook: stop-verify
# Triggers before session stops. Warns if a task is in progress.
# Works on: Linux, macOS, Windows (Git Bash / WSL)

set -euo pipefail

if [ "${STOP_HOOK_ACTIVE:-}" = "1" ]; then
  exit 0
fi
export STOP_HOOK_ACTIVE=1

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${HOOK_DIR}/portable.sh"

# Drain stop-hook JSON from stdin when invoked by Cursor / Claude Code
_ACO_STDIN=$(aco_hook_read_stdin)
unset _ACO_STDIN

cd "$(aco_project_root)" 2>/dev/null || exit 0

MEMORY_DIR=$(aco_memory_dir)
PROGRESS_FILE="${MEMORY_DIR}/progress.md"

if [ ! -f "$PROGRESS_FILE" ]; then
  exit 0
fi

STATUS=$(aco_parse_field "$PROGRESS_FILE" "Status" "idle")

if [ "$STATUS" != "idle" ]; then
  TASK=$(aco_parse_field "$PROGRESS_FILE" "Task" "unknown")
  MSG="Task in progress. Status: ${STATUS}. Task: ${TASK}. Progress has been saved in ${PROGRESS_FILE}."
  if [ "$(aco_detect_platform)" = "codex" ]; then
    printf '{"continue":true,"systemMessage":"%s"}\n' "$(aco_json_escape "$MSG")"
    exit 0
  fi

  echo "WARNING: Task in progress!"
  echo "  Status: $STATUS"
  echo "  Task: $TASK"
  echo ""
  echo "Progress has been saved in ${PROGRESS_FILE}."
fi
