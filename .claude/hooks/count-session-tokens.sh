#!/usr/bin/env bash
# count-session-tokens.sh — extract actual token counts from AI tool session files
#
# Supports: Claude Code, Cursor, and recent Codex CLI session JSONL.
#
# Output: model|input|output|cache_read|cache_create (one line per model)
# Falls back to "unavailable" if the file can't be found or parsed.
#
# Works on: Linux, macOS, Windows (Git Bash / WSL)

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${HOOK_DIR}/portable.sh"

PLATFORM=$(aco_detect_platform)

if [ "$PLATFORM" = "codex" ]; then
  CODEX_HOME_DIR="${CODEX_HOME:-${HOME:-}/.codex}"
  CODEX_SESSIONS="${CODEX_HOME_DIR}/sessions"
  SESSION_FILE=""

  if [ -d "$CODEX_SESSIONS" ]; then
    if [ -n "${CODEX_THREAD_ID:-}" ]; then
      SESSION_FILE=$(find "$CODEX_SESSIONS" -type f -name "*${CODEX_THREAD_ID}.jsonl" 2>/dev/null | head -1)
    fi
    if [ -z "$SESSION_FILE" ]; then
      SESSION_FILE=$(find "$CODEX_SESSIONS" -type f -name "*.jsonl" 2>/dev/null | sort | tail -1)
    fi
  fi

  if [ -z "$SESSION_FILE" ] || [ ! -f "$SESSION_FILE" ] || ! command -v python3 &>/dev/null; then
    echo "unavailable"
    exit 0
  fi

  python3 -c '
import json, sys

last = None
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        for line in f:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            payload = row.get("payload") or {}
            if row.get("type") == "event_msg" and payload.get("type") == "token_count":
                usage = (payload.get("info") or {}).get("total_token_usage", {})
                if usage:
                    last = usage
except (OSError, UnicodeDecodeError):
    pass

if not last:
    print("unavailable")
else:
    input_tokens = int(last.get("input_tokens", 0) or 0)
    cached = int(last.get("cached_input_tokens", 0) or 0)
    output_tokens = int(last.get("output_tokens", 0) or 0)
    uncached = max(input_tokens - cached, 0)
    print(f"codex|{uncached}|{output_tokens}|{cached}|0")
' "$SESSION_FILE" 2>/dev/null || echo "unavailable"
  exit 0
fi

SESSION_ID="${CLAUDE_SESSION_ID:-${CURSOR_SESSION_ID:-}}"
if [ -z "$SESSION_ID" ]; then
  echo "unavailable"
  exit 0
fi

# ── Locate session JSONL file ──
# Claude Code: ~/.claude/projects/<path-hash>/<session-id>.jsonl
# Cursor: ~/.cursor-server/data/ or similar (varies by version)

CLAUDE_PROJECTS="${HOME}/.claude/projects"
SESSION_FILE=""

if [ -d "$CLAUDE_PROJECTS" ]; then
  GIT_ROOT=$(aco_project_root)

  # Try multiple path encoding strategies (Claude normalizes paths differently)
  for transform in \
    "sed 's|/|-|g'" \
    "sed 's|[/_]|-|g'" \
    "sed 's|/|-|g; s|_|-|g'"
  do
    PATH_HASH=$(echo "$GIT_ROOT" | eval "$transform")
    CANDIDATE="${CLAUDE_PROJECTS}/${PATH_HASH}/${SESSION_ID}.jsonl"
    if [ -f "$CANDIDATE" ]; then
      SESSION_FILE="$CANDIDATE"
      break
    fi
  done

  # Last resort: glob match on repo name
  if [ -z "$SESSION_FILE" ]; then
    REPO_NAME=$(basename "$GIT_ROOT")
    MATCH=$(find "$CLAUDE_PROJECTS" -maxdepth 1 -type d -name "*${REPO_NAME}" 2>/dev/null | head -1)
    if [ -n "$MATCH" ] && [ -f "${MATCH}/${SESSION_ID}.jsonl" ]; then
      SESSION_FILE="${MATCH}/${SESSION_ID}.jsonl"
    fi
  fi
fi

if [ -z "$SESSION_FILE" ] || [ ! -f "$SESSION_FILE" ]; then
  echo "unavailable"
  exit 0
fi

# ── Parse tokens by model ──
# Claude/Cursor JSONL format: {"type":"assistant","message":{"model":"...","usage":{...}}}
python3 -c "
import json, sys
from collections import defaultdict

totals = defaultdict(lambda: [0, 0, 0, 0])

try:
    with open(sys.argv[1]) as f:
        for line in f:
            try:
                r = json.loads(line)
                if r.get('type') != 'assistant':
                    continue
                msg = r.get('message', {})
                u = msg.get('usage', {})
                model = msg.get('model', 'unknown')
                if not u:
                    continue
                totals[model][0] += u.get('input_tokens', 0)
                totals[model][1] += u.get('output_tokens', 0)
                totals[model][2] += u.get('cache_read_input_tokens', 0)
                totals[model][3] += u.get('cache_creation_input_tokens', 0)
            except (json.JSONDecodeError, KeyError, TypeError):
                pass
except (FileNotFoundError, PermissionError):
    pass

if not totals:
    print('unavailable')
else:
    for model, (inp, out, crd, ccr) in sorted(totals.items()):
        print(f'{model}|{inp}|{out}|{crd}|{ccr}')
" "$SESSION_FILE" 2>/dev/null || echo "unavailable"
