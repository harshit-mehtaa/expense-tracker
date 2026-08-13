#!/usr/bin/env bash
# Hook: telemetry-emit
# Fires on Stop. Collects session metrics and emits one JSONL record.
#
# Design: guardrail-core pattern — invisible, <50ms, no PII, no user friction.
# Works on: Linux, macOS, Windows (Git Bash / WSL)

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${HOOK_DIR}/portable.sh"

# Drain stop-hook JSON from stdin first — required for Cursor hook protocol
_ACO_STDIN=$(aco_hook_read_stdin)
unset _ACO_STDIN

cd "$(aco_project_root)" 2>/dev/null || exit 0

SESSION_KEY=$(aco_session_key)
TMPD=$(aco_tmpdir)
COUNTER_FILE="${TMPD}/aco-context-${SESSION_KEY}"
START_FILE="${TMPD}/aco-start-${SESSION_KEY}"
PROGRESS="$(aco_memory_dir)/progress.md"
LOG_DIR="$(aco_logs_dir)"
NVDATAFLOW_URL="http://nvdataflow.nvidia.com/dataflow2/ipp-nova-coding-orchestrator-telemetry/posting"

USER_ID=$(aco_user_id)
TOOL_CALLS=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
NOW=$(aco_epoch)
SESSION_START=$(cat "$START_FILE" 2>/dev/null || echo "")

if [ -n "$SESSION_START" ] && [ "$SESSION_START" != "0" ]; then
  DURATION_S=$(( NOW - SESSION_START ))
else
  DURATION_S=0
fi

# Skip trivial sessions (< 3 tool calls = opened and closed)
if [ "${TOOL_CALLS:-0}" -lt 3 ]; then
  exit 0
fi

# ── Extract fields from progress.md (portable — no grep -P) ──
STATUS="idle"
TASK_TYPE="unknown"
RISK_LEVEL="unknown"
REVIEW_VERDICT=""
ADVERSARIAL_VERDICT=""
COMPLIANCE_VERDICT=""
DE_TOTAL=0
DE_RESOLVED=0
OUTCOME="unknown"

if [ -f "$PROGRESS" ]; then
  STATUS=$(aco_parse_field "$PROGRESS" "Status" "idle")
  TASK_TYPE=$(aco_parse_kv "$PROGRESS" "task_type" "unknown")
  RISK_LEVEL=$(aco_parse_kv "$PROGRESS" "risk_level" "unknown")

  case "$STATUS" in
    idle)
      LAST_COMPLETED=$(aco_parse_field "$PROGRESS" "Last Completed" "")
      if [ -n "$LAST_COMPLETED" ]; then
        OUTCOME="committed"
      else
        OUTCOME="no_task"
      fi
      ;;
    analyze|plan|approve|implement|review|commit)
      OUTCOME="in_progress"
      ;;
  esac
fi

case "$RISK_LEVEL" in
  low)    RISK_TIER="tier1" ;;
  medium) RISK_TIER="tier2" ;;
  high)   RISK_TIER="tier3" ;;
  *)      RISK_TIER="unknown" ;;
esac

TIMESTAMP=$(aco_timestamp)
REPO_NAME=$(basename "$(aco_project_root)")
PLATFORM=$(aco_detect_platform)

# Session ID: platform-scoped so concurrent tools get distinct records
SESSION_ID="${CLAUDE_SESSION_ID:-${CURSOR_SESSION_ID:-${CODEX_THREAD_ID:-}}}"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="${PLATFORM}-$(aco_epoch)-$$"
fi

# ── Token counts from platform session files (ground truth) ──
TOKEN_DATA=""
if [ -x "${HOOK_DIR}/count-session-tokens.sh" ]; then
  TOKEN_DATA=$(bash "${HOOK_DIR}/count-session-tokens.sh" 2>/dev/null || echo "unavailable")
fi

TOKEN_JSON="[]"
TOTAL_INPUT=0
TOTAL_OUTPUT=0
if [ -n "$TOKEN_DATA" ] && [ "$TOKEN_DATA" != "unavailable" ]; then
  TOKEN_JSON="["
  FIRST=true
  while IFS='|' read -r model inp out crd ccr; do
    [ -z "$model" ] && continue
    inp=${inp:-0}; out=${out:-0}; crd=${crd:-0}; ccr=${ccr:-0}
    TOTAL_INPUT=$((TOTAL_INPUT + inp + crd + ccr))
    TOTAL_OUTPUT=$((TOTAL_OUTPUT + out))
    if [ "$FIRST" = true ]; then FIRST=false; else TOKEN_JSON="${TOKEN_JSON},"; fi
    TOKEN_JSON="${TOKEN_JSON}{\"model\":\"${model}\",\"input\":${inp},\"output\":${out},\"cache_read\":${crd},\"cache_create\":${ccr}}"
  done <<< "$TOKEN_DATA"
  TOKEN_JSON="${TOKEN_JSON}]"
fi

# ── JSON-escape all string fields ──
E_REPO=$(aco_json_escape "$REPO_NAME")
E_SESSION=$(aco_json_escape "$SESSION_ID")
E_TASK_TYPE=$(aco_json_escape "$TASK_TYPE")
E_RISK_TIER=$(aco_json_escape "$RISK_TIER")
E_OUTCOME=$(aco_json_escape "$OUTCOME")
E_REVIEW=$(aco_json_escape "$REVIEW_VERDICT")
E_ADVERSARIAL=$(aco_json_escape "$ADVERSARIAL_VERDICT")
E_COMPLIANCE=$(aco_json_escape "$COMPLIANCE_VERDICT")

# ── Build JSONL record ──
RECORD="{\"schema\":\"aco-telemetry-v2\",\"ts\":\"${TIMESTAMP}\",\"user_id\":\"${USER_ID}\",\"session_id\":\"${E_SESSION}\",\"platform\":\"${PLATFORM}\",\"repo\":\"${E_REPO}\",\"tool_calls\":${TOOL_CALLS},\"duration_s\":${DURATION_S},\"risk_tier\":\"${E_RISK_TIER}\",\"task_type\":\"${E_TASK_TYPE}\",\"outcome\":\"${E_OUTCOME}\",\"review_verdict\":\"${E_REVIEW}\",\"adversarial_verdict\":\"${E_ADVERSARIAL}\",\"compliance_verdict\":\"${E_COMPLIANCE}\",\"de_total\":${DE_TOTAL},\"de_resolved\":${DE_RESOLVED},\"tokens_by_model\":${TOKEN_JSON},\"total_input_tokens\":${TOTAL_INPUT},\"total_output_tokens\":${TOTAL_OUTPUT}}"

# ── Layer 1: Local JSONL (always on) ──
mkdir -p "$LOG_DIR" 2>/dev/null || true
TODAY=$(date +"%Y-%m-%d" 2>/dev/null || echo "unknown")
echo "$RECORD" >> "${LOG_DIR}/sessions-${TODAY}.jsonl" 2>/dev/null || true

# ── Layer 2: NVDataflow (opt-in) ──
if [ "${ACO_TELEMETRY:-}" = "true" ]; then
  NV_RECORD="{\"ts_created\":$(( NOW * 1000 )),\"_id\":\"${SESSION_ID}-${NOW}\",\"s_user_id\":\"${USER_ID}\",\"s_session_id\":\"${SESSION_ID}\",\"s_platform\":\"${PLATFORM}\",\"s_repo\":\"${REPO_NAME}\",\"l_tool_calls\":${TOOL_CALLS},\"l_duration_s\":${DURATION_S},\"s_risk_tier\":\"${RISK_TIER}\",\"s_task_type\":\"${TASK_TYPE}\",\"s_outcome\":\"${OUTCOME}\",\"s_review_verdict\":\"${REVIEW_VERDICT}\",\"l_total_input_tokens\":${TOTAL_INPUT},\"l_total_output_tokens\":${TOTAL_OUTPUT}}"
  curl -s -o /dev/null -X POST "$NVDATAFLOW_URL" \
    -H "Content-Type: application/json" \
    -d "$NV_RECORD" \
    --max-time 5 &>/dev/null &
fi

# ── Layer 3: Human-readable append ──
PROGRESS_FILE="claude-progress.md"
if [ -f "$PROGRESS_FILE" ] && [ "$OUTCOME" = "committed" ]; then
  if ! grep -q "## Session Log" "$PROGRESS_FILE" 2>/dev/null; then
    printf "\n## Session Log\n" >> "$PROGRESS_FILE"
  fi
  printf "%s | %s | %s | %s | %d calls | %ds | %s\n" \
    "$TODAY" "$PLATFORM" "$TASK_TYPE" "$RISK_TIER" "$TOOL_CALLS" "$DURATION_S" "$OUTCOME" \
    >> "$PROGRESS_FILE" 2>/dev/null || true
fi

# ── Cleanup old logs (7 days) ──
find "$LOG_DIR" -name "sessions-*.jsonl" -mtime +7 -delete 2>/dev/null || true

# ── Cleanup temp files ──
rm -f "$COUNTER_FILE" "$START_FILE" 2>/dev/null || true
