#!/usr/bin/env bash
# Hook: tdd-reminder
# PostToolUse hook on Write|Edit. Checks if the modified file is an implementation
# file and whether a corresponding test file exists. Outputs a non-blocking reminder
# if no test accompanies the change.
#
# Philosophy: Encourage test-first development without blocking workflow.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${HOOK_DIR}/portable.sh"

cd "$(aco_project_root)" 2>/dev/null || exit 0

_STDIN_JSON=$(aco_hook_read_stdin)
FILE=$(aco_resolve_edited_file "$_STDIN_JSON")
unset _STDIN_JSON

# No file context — nothing to check
if [ -z "$FILE" ]; then
  exit 0
fi

# Skip if the file itself is a test file
case "$FILE" in
  *_test.*|*.test.*|*.spec.*|*_spec.*|*__tests__*|*tests/*|*test/*)
    exit 0
    ;;
esac

# Skip non-source files (configs, docs, markdown, shell scripts, memory files)
case "$FILE" in
  *.md|*.json|*.yaml|*.yml|*.toml|*.ini|*.cfg|*.conf|*.sh|*.bash|*.lock|*.txt|*.csv|*.env*)
    exit 0
    ;;
  .claude/*|.ai-orchestrator/*|.github/*|.vscode/*|node_modules/*|vendor/*|dist/*|build/*)
    exit 0
    ;;
esac

# Extract file info
DIRNAME=$(dirname "$FILE")
BASENAME=$(basename "$FILE")
FILENAME="${BASENAME%.*}"
EXTENSION="${BASENAME##*.}"

# Define test file patterns to check
TEST_PATTERNS=()

case "$EXTENSION" in
  ts|tsx|js|jsx)
    TEST_PATTERNS=(
      "${DIRNAME}/${FILENAME}.test.${EXTENSION}"
      "${DIRNAME}/${FILENAME}.spec.${EXTENSION}"
      "${DIRNAME}/__tests__/${FILENAME}.test.${EXTENSION}"
      "${DIRNAME}/__tests__/${FILENAME}.spec.${EXTENSION}"
      "tests/${FILENAME}.test.${EXTENSION}"
      "test/${FILENAME}.test.${EXTENSION}"
    )
    ;;
  py)
    TEST_PATTERNS=(
      "${DIRNAME}/test_${FILENAME}.py"
      "${DIRNAME}/${FILENAME}_test.py"
      "tests/test_${FILENAME}.py"
      "tests/${FILENAME}_test.py"
      "test/test_${FILENAME}.py"
    )
    ;;
  rs)
    # Rust: check for #[cfg(test)] in the file itself, or tests/ directory
    if grep -q '#\[cfg(test)\]' "$FILE" 2>/dev/null; then
      exit 0
    fi
    TEST_PATTERNS=(
      "${DIRNAME}/../tests/${FILENAME}.rs"
      "tests/${FILENAME}.rs"
    )
    ;;
  go)
    TEST_PATTERNS=(
      "${DIRNAME}/${FILENAME}_test.go"
    )
    ;;
  rb)
    TEST_PATTERNS=(
      "${DIRNAME}/${FILENAME}_spec.rb"
      "spec/${FILENAME}_spec.rb"
      "test/test_${FILENAME}.rb"
      "test/${FILENAME}_test.rb"
    )
    ;;
  *)
    # Unknown file type — skip
    exit 0
    ;;
esac

# Check if any test file exists
for PATTERN in "${TEST_PATTERNS[@]}"; do
  if [ -f "$PATTERN" ]; then
    exit 0
  fi
done

# No test file found — output non-blocking reminder
echo ""
echo "TDD REMINDER: No test file found for '${BASENAME}'."
echo "  Consider writing tests first (test-driven development)."
echo "  Expected test file locations:"
for PATTERN in "${TEST_PATTERNS[@]:0:3}"; do
  echo "    - ${PATTERN}"
done
echo ""
