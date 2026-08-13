#!/usr/bin/env bash
# Hook: session-start-load
# Triggers at session start. Detects in-progress tasks and initializes telemetry state.
# Works on: Linux, macOS, Windows (Git Bash / WSL)

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${HOOK_DIR}/portable.sh"

# Drain sessionStart JSON from stdin when invoked as a Cursor hook
_ACO_STDIN=$(aco_hook_read_stdin)
unset _ACO_STDIN

cd "$(aco_project_root)" 2>/dev/null || exit 0

SESSION_KEY=$(aco_session_key)
TMPD=$(aco_tmpdir)

# Reset context monitor counter and record session start timestamp
rm -f "${TMPD}/aco-context-${SESSION_KEY}" 2>/dev/null || true
echo "$(aco_epoch)" > "${TMPD}/aco-start-${SESSION_KEY}" 2>/dev/null || true

MEMORY_DIR=$(aco_memory_dir)
PROGRESS_FILE="${MEMORY_DIR}/progress.md"
HANDOFF_FILE="${MEMORY_DIR}/handoff.md"

# ── Check for interrupted task ──
if [ -f "$PROGRESS_FILE" ]; then
  STATUS=$(aco_parse_field "$PROGRESS_FILE" "Status" "idle")

  if [ "$STATUS" != "idle" ]; then
    TASK=$(aco_parse_field "$PROGRESS_FILE" "Task" "unknown")
    STEPS=$(aco_parse_field "$PROGRESS_FILE" "Steps Completed" "none")
    CURRENT=$(aco_parse_field "$PROGRESS_FILE" "Current Step" "none")

    echo "RESUMED SESSION — Task in progress detected!"
    echo ""
    echo "  Task: $TASK"
    echo "  Status: $STATUS"
    echo "  Completed: $STEPS"
    if [ "$CURRENT" != "none" ]; then
      echo "  Last active: $CURRENT"
    fi
    echo ""
    echo "Use /task to resume, or /task <new task> to abort and start fresh."
  fi
fi

# ── Check for handoff state ──
if [ -f "$HANDOFF_FILE" ]; then
  HANDOFF_STATUS=$(aco_parse_field "$HANDOFF_FILE" "Status" "none")

  if [ "$HANDOFF_STATUS" = "pending_handoff" ]; then
    echo ""
    echo "HANDOFF STATE — Previous session hit context limits."
    echo "  Read ${HANDOFF_FILE} for completed work and blockers."
    echo "  /task will incorporate this automatically."
  fi
fi
