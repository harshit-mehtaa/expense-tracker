#!/usr/bin/env bash
# Hook: post-write-lint
# Triggers after Write|Edit tool calls to auto-lint changed files.
# Detects the project's linter and runs it on the changed file.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${HOOK_DIR}/portable.sh"

cd "$(aco_project_root)" 2>/dev/null || exit 0

# File path: CLAUDE_FILE (Claude Code) or postToolUse JSON on stdin (Cursor)
_STDIN_JSON=$(aco_hook_read_stdin)
FILE=$(aco_resolve_edited_file "$_STDIN_JSON")
unset _STDIN_JSON
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  exit 0
fi

# Get the file extension
EXT="${FILE##*.}"

# Get the project root (look for common root markers)
PROJECT_ROOT="$PWD"

# Detect and run the appropriate linter
lint_ran=false

case "$EXT" in
  ts|tsx|js|jsx|mjs|cjs)
    # Try ESLint first, then Prettier
    if [ -f "$PROJECT_ROOT/node_modules/.bin/eslint" ]; then
      "$PROJECT_ROOT/node_modules/.bin/eslint" --fix "$FILE" 2>/dev/null || true
      lint_ran=true
    elif command -v npx &>/dev/null && [ -f "$PROJECT_ROOT/package.json" ]; then
      npx --no-install eslint --fix "$FILE" 2>/dev/null || true
      lint_ran=true
    fi
    if [ -f "$PROJECT_ROOT/node_modules/.bin/prettier" ]; then
      "$PROJECT_ROOT/node_modules/.bin/prettier" --write "$FILE" 2>/dev/null || true
      lint_ran=true
    fi
    ;;
  py)
    # Try ruff, then black, then autopep8
    if command -v ruff &>/dev/null; then
      ruff check --fix "$FILE" 2>/dev/null || true
      ruff format "$FILE" 2>/dev/null || true
      lint_ran=true
    elif command -v black &>/dev/null; then
      black --quiet "$FILE" 2>/dev/null || true
      lint_ran=true
    elif command -v autopep8 &>/dev/null; then
      autopep8 --in-place "$FILE" 2>/dev/null || true
      lint_ran=true
    fi
    ;;
  rs)
    if command -v rustfmt &>/dev/null; then
      rustfmt "$FILE" 2>/dev/null || true
      lint_ran=true
    fi
    ;;
  go)
    if command -v gofmt &>/dev/null; then
      gofmt -w "$FILE" 2>/dev/null || true
      lint_ran=true
    fi
    if command -v goimports &>/dev/null; then
      goimports -w "$FILE" 2>/dev/null || true
    fi
    ;;
  rb)
    if command -v rubocop &>/dev/null; then
      rubocop -a "$FILE" 2>/dev/null || true
      lint_ran=true
    fi
    ;;
  *)
    # No linter configured for this extension
    ;;
esac

if [ "$lint_ran" = true ]; then
  echo "Lint: $FILE"
fi
