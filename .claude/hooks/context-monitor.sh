#!/usr/bin/env bash
# Hook: context-monitor
# Tracks tool call count. Warns at 50/80/100+ thresholds.
# Works on: Linux, macOS, Windows (Git Bash / WSL)

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${HOOK_DIR}/portable.sh"

# Drain postToolUse JSON from stdin when invoked by Cursor / Claude Code hooks
_ACO_STDIN=$(aco_hook_read_stdin)
unset _ACO_STDIN

SESSION_KEY=$(aco_session_key)
TMPD=$(aco_tmpdir)
COUNTER_FILE="${TMPD}/aco-context-${SESSION_KEY}"

# Atomic increment via temp file rename (safe for concurrent sessions)
LOCK_FILE="${COUNTER_FILE}.lock"
(
  if command -v flock &>/dev/null; then
    flock -x 200
  fi
  COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
  COUNT=$(( ${COUNT:-0} + 1 ))
  echo "$COUNT" > "${COUNTER_FILE}.tmp"
  mv "${COUNTER_FILE}.tmp" "$COUNTER_FILE"
) 200>"$LOCK_FILE" 2>/dev/null

COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")

if [ "$COUNT" -eq 50 ]; then
  echo ""
  echo "CONTEXT MONITOR [INFO]: Session has reached ~50 tool calls."
  echo "  Consider finishing the current task soon."
  echo ""
elif [ "$COUNT" -eq 80 ]; then
  echo ""
  echo "CONTEXT MONITOR [WARNING]: Session has reached ~80 tool calls."
  echo "  Save state to .claude/memory/ and don't start new work."
  echo ""
elif [ "$COUNT" -ge 100 ] && [ $(( COUNT % 10 )) -eq 0 ]; then
  echo ""
  echo "CONTEXT MONITOR [CRITICAL]: Session has reached ~${COUNT} tool calls."
  echo "  Update progress.md and handoff.md, commit work, prepare to end session."
  echo ""
fi
