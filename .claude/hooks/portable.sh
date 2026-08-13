#!/usr/bin/env bash
# portable.sh — shared utilities for cross-platform hook execution
#
# Source this file from any hook: . "$(dirname "${BASH_SOURCE[0]}")/portable.sh"
# Works on: Linux, macOS, Windows (Git Bash / WSL), Alpine, CI runners
#
# Multi-platform safe: when a user runs Claude Code + Cursor + Codex in the
# same project, each gets its own counter/start files keyed by platform tag.

# ── Temp directory (Linux, macOS, Windows Git Bash, WSL) ──
aco_tmpdir() {
  local d="${TMPDIR:-${TEMP:-${TMP:-/tmp}}}"
  echo "${d%/}"
}

# ── Hook/orchestrator location ──
# In this repo hooks live at .claude/hooks. When installed into another project,
# they may live at .ai-orchestrator/.claude/hooks and be called by thin wrappers.
ACO_PORTABLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACO_ORCH_DIR="$(cd "${ACO_PORTABLE_DIR}/../.." && pwd)"

# ── Detect which platform is calling this hook ──
# Returns: claude-code | cursor | codex | pi | <custom> | unknown
# Multiple platforms can be installed, but only ONE fires a given hook invocation.
#
# ACO_PLATFORM is checked FIRST and wins outright. Autodetection relies on each
# harness exporting recognisable env vars; that is knowable for Claude Code, Cursor
# and Codex, but not for every harness. Rather than guess, any platform can be named
# explicitly:
#
#   export ACO_PLATFORM=pi        # in the shell profile on that machine
#
# The value is used as the telemetry tag and to select a row in
# .claude/memory/cost-routing.md, so it must match a platform named there.
#
# Order matters for the autodetect branches: Cursor sets CLAUDE_PROJECT_DIR as a
# compatibility alias (see Cursor Hooks docs — Environment Variables). Detect Cursor
# before Claude-only signals so telemetry is not mis-tagged as claude-code in Cursor.
aco_detect_platform() {
  # Explicit override — the reliable path for any harness, including pi.
  if [ -n "${ACO_PLATFORM:-}" ]; then
    echo "${ACO_PLATFORM}"
    return
  fi

  if [ "${CODEX_CI:-}" = "1" ] || [ -n "${CODEX_THREAD_ID:-}" ] \
    || [ -n "${CODEX_SANDBOX:-}" ] || [ -n "${CODEX_MANAGED_BY_NPM:-}" ]; then
    echo "codex"
  elif [ -n "${CURSOR_VERSION:-}" ] || [ -n "${CURSOR_PROJECT_DIR:-}" ] \
    || [ -n "${CURSOR_TRANSCRIPT_PATH:-}" ] || [ "${CURSOR_CODE_REMOTE:-}" = "true" ] \
    || [ "${CURSOR_AGENT:-}" = "1" ] || [ -n "${CURSOR_SANDBOX:-}" ] \
    || [ -n "${CURSOR_WORKSPACE_LABEL:-}" ]; then
    echo "cursor"
  # Best-effort pi detection. These names are UNVERIFIED — if pi does not export
  # them, set ACO_PLATFORM=pi instead; that always works.
  elif [ -n "${PI_SESSION_ID:-}" ] || [ -n "${PI_PROJECT_DIR:-}" ] \
    || [ -n "${PI_AGENT:-}" ]; then
    echo "pi"
  elif [ -n "${CLAUDE_CODE_ENTRYPOINT:-}" ] || [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    echo "claude-code"
  else
    echo "unknown"
  fi
}

# ── Cursor / Claude Code hook stdin (JSON) ──
# Command hooks receive JSON on stdin when invoked by the IDE; drain it so the
# agent loop does not block. When stdin is a TTY (manual bash run), read nothing.
#
# Never use blocking `cat` on non-TTY stdin: CI/sandbox often attaches an empty
# pipe that never closes, which would hang the hook forever.
aco_hook_read_stdin() {
  if [ -t 0 ]; then
    printf '%s' ""
    return 0
  fi
  if command -v python3 &>/dev/null; then
    python3 -c '
import sys
import time
if sys.stdin.isatty():
    sys.exit(0)
try:
    import select
except ImportError:
    sys.exit(0)
# Wait briefly for hook JSON (IDE usually writes before exec); avoid infinite block.
buf = []
deadline = 0.15
step = 0.02
end = time.time() + deadline
while time.time() < end:
    r, _, _ = select.select([sys.stdin], [], [], step)
    if r:
        chunk = sys.stdin.read(1048576)
        if not chunk:
            break
        buf.append(chunk)
        if len(chunk) < 1048576:
            break
    elif buf:
        break
sys.stdout.write("".join(buf))
' 2>/dev/null || true
    return 0
  fi
  # No python3: best-effort short read (may miss stdin JSON on slow pipes)
  dd bs=4096 count=1 iflag=nonblock of=/dev/null 2>/dev/null || true
  printf '%s' ""
}

# Resolve the edited file path: env vars or hook JSON.
aco_resolve_edited_file() {
  local stdin_json="$1"
  local file="${CLAUDE_FILE:-${CURSOR_FILE:-${CHANGED_FILE:-}}}"
  if [ -n "$file" ]; then
    printf '%s' "$file"
    return 0
  fi
  [ -n "$stdin_json" ] || return 0
  command -v python3 &>/dev/null || return 0
  python3 -c '
import json, sys
raw = sys.argv[1]
if not raw or not raw.strip():
    sys.exit(0)
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    sys.exit(0)

def emit(value):
    if isinstance(value, str) and value:
        print(value)
        sys.exit(0)

def search(obj):
    if isinstance(obj, dict):
        for key in ("file_path", "filePath", "path", "target_file", "file", "abs_path", "absolute_path"):
            emit(obj.get(key))
        for key in ("tool_input", "toolInput", "input", "params"):
            search(obj.get(key))
    elif isinstance(obj, list):
        for item in obj:
            search(item)

search(d)
' "$stdin_json" 2>/dev/null || true
}

# ── Session key: stable hash of working directory + platform ──
# Platform-scoped so Claude Code and Cursor don't share counter files.
aco_session_key() {
  local platform
  platform=$(aco_detect_platform)
  local input="${PWD}:${platform}"
  if command -v md5sum &>/dev/null; then
    echo "$input" | md5sum | cut -d' ' -f1
  elif command -v md5 &>/dev/null; then
    md5 -q -s "$input"
  elif command -v sha256sum &>/dev/null; then
    echo "$input" | sha256sum | cut -d' ' -f1
  elif command -v shasum &>/dev/null; then
    echo "$input" | shasum -a 256 | cut -d' ' -f1
  elif command -v python3 &>/dev/null; then
    python3 -c "import hashlib,sys; print(hashlib.md5(sys.argv[1].encode()).hexdigest())" "$input"
  else
    echo "default-${platform}"
  fi
}

# ── Parse "## Key: value" from markdown (portable, no grep -P) ──
aco_parse_field() {
  local file="$1" key="$2" default="${3:-}"
  [ -f "$file" ] || { echo "$default"; return; }
  local val
  val=$(sed -n "s/^## ${key}: *//p" "$file" 2>/dev/null | head -1)
  echo "${val:-$default}"
}

# ── Parse "key: value" from markdown (non-header fields) ──
aco_parse_kv() {
  local file="$1" key="$2" default="${3:-}"
  [ -f "$file" ] || { echo "$default"; return; }
  local val
  val=$(sed -n "s/^${key}: *//p" "$file" 2>/dev/null | head -1)
  echo "${val:-$default}"
}

# ── Anonymous persistent user ID ──
aco_user_id() {
  local home_dir="${HOME:-${USERPROFILE:-}}"
  if [ -z "$home_dir" ]; then
    echo "anonymous"
    return
  fi
  local id_file="${home_dir}/.ai-orchestrator/user_id"
  if [ -f "$id_file" ]; then
    cat "$id_file" 2>/dev/null
    return
  fi
  local uid
  if command -v python3 &>/dev/null; then
    uid=$(python3 -c "import uuid; print(uuid.uuid4().hex[:8])" 2>/dev/null)
  elif command -v uuidgen &>/dev/null; then
    uid=$(uuidgen | tr -d '-' | head -c 8)
  else
    uid=$(head -c 4 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || echo "00000000")
  fi
  mkdir -p "$(dirname "$id_file")" 2>/dev/null || true
  echo "$uid" > "$id_file" 2>/dev/null || true
  echo "$uid"
}

# ── Project root ──
aco_project_root() {
  git rev-parse --show-toplevel 2>/dev/null || echo "$PWD"
}

# ── Relative path helper ──
aco_relpath() {
  local path="$1" root="$2"
  case "$path" in
    "$root") echo "." ;;
    "$root"/*) echo "${path#"$root"/}" ;;
    *) echo "$path" ;;
  esac
}

# ── Shared memory/log roots ──
# Development checkout: .claude/memory
# Installed project:    .ai-orchestrator/memory
aco_memory_dir() {
  local root
  root=$(aco_project_root)

  if [ -d "${root}/.ai-orchestrator/memory" ]; then
    echo ".ai-orchestrator/memory"
    return
  fi

  if [ -d "${root}/.claude/memory" ]; then
    echo ".claude/memory"
    return
  fi

  if [ "$ACO_ORCH_DIR" != "$root" ] && [ -d "${ACO_ORCH_DIR}/memory" ]; then
    aco_relpath "${ACO_ORCH_DIR}/memory" "$root"
    return
  fi

  if [ -d "${root}/memory" ]; then
    echo "memory"
    return
  fi

  if [ "$ACO_ORCH_DIR" != "$root" ]; then
    aco_relpath "${ACO_ORCH_DIR}/memory" "$root"
  else
    echo ".claude/memory"
  fi
}

aco_logs_dir() {
  echo "$(aco_memory_dir)/logs"
}

# ── Epoch seconds (capture once, avoid double-invoke) ──
aco_epoch() {
  local result
  result=$(date +%s 2>/dev/null) && { echo "$result"; return; }
  command -v python3 &>/dev/null && { python3 -c "import time; print(int(time.time()))"; return; }
  echo "0"
}

# ── UTC timestamp (ISO 8601) ──
aco_timestamp() {
  local result
  result=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null) && { echo "$result"; return; }
  command -v python3 &>/dev/null && { python3 -c "from datetime import datetime,timezone; print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))"; return; }
  echo "1970-01-01T00:00:00Z"
}

# ── JSON-safe string escape (handles quotes and backslashes) ──
aco_json_escape() {
  local val="$1"
  if command -v python3 &>/dev/null; then
    python3 -c "import json,sys; print(json.dumps(sys.argv[1])[1:-1])" "$val" 2>/dev/null && return
  fi
  printf '%s' "$val" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g'
}

