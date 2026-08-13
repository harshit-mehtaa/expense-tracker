# Bug Patterns

<!-- Cap: 50 entries. Evict oldest when at capacity. -->
<!-- Updated: 2026-04-28 -->
<!-- Source: Migrated from reviewer-adversarial.md (originally from cl-patch-agent production bugs) -->
<!-- Usage: The adversarial reviewer reads this file and checks each pattern against the current diff. -->
<!-- Add new patterns via /log-error with category "bug-pattern", or manually. -->

## How to Use This File

Each pattern below is a **proven production failure mode**. The adversarial reviewer checks every pattern against the current diff during REVIEW. Any violation is automatically critical severity.

Not all patterns apply to every project. The reviewer should skip patterns that reference technologies or architectures not present in the current codebase.

---

### P1: Sentinel/Constant Integrity
**Trigger**: Code uses string comparisons (`startswith()`, `==`, `in`) with literals that are checked elsewhere.
**Failure**: A new string literal is introduced but doesn't use the shared constant — silent mismatch.
**Check**: Grep for all `startswith()` and string equality checks related to changed values.

### P2: External I/O Missing Timeouts
**Trigger**: Code adds `requests.get/post`, `aiohttp`, `subprocess`, `origin.fetch()`, or similar external calls.
**Failure**: No explicit timeout → pipeline hang in production.
**Check**: Every external call must have a timeout parameter.

### P3: Cross-Path Output Consistency
**Trigger**: Code adds or modifies an output field in a system with multiple assembly/output paths.
**Failure**: Field added in one path but missing in another → silent null in production.
**Check**: For each new/changed field, grep for ALL assembly functions and verify the field is populated in every path.

### P4: Pre-Populated Field Trust in Multi-Item Processing
**Trigger**: Multi-item processing paths where the orchestrator re-attributes identity.
**Failure**: Code trusts fields pre-populated from the first item; after re-attribution, those fields are wrong.
**Check**: If the diff touches multi-item paths, verify identity fields are re-derived, not inherited.

### P5: Template Double-Brace Escaping
**Trigger**: LangChain `ChatPromptTemplate` (or similar template engines) with JSON examples containing curly braces.
**Failure**: Single braces `{` in examples are interpreted as template variables → 100% crash.
**Check**: All curly braces in template examples must be double-escaped: `{{` and `}}`.

### P6: Silent Scope Widening on Failure
**Trigger**: Failure/fallback path in exception handlers.
**Failure**: Fallback silently widens scope to "process everything" → spurious results, cross-contamination.
**Check**: For each `except` or fallback branch, trace what happens — does it broaden the operation scope?

### P7: Async Context Propagation
**Trigger**: Code uses `asyncio.to_thread()` or thread pools.
**Failure**: Bare `asyncio.to_thread()` doesn't propagate contextvars — breaks tracing (LangSmith, OpenTelemetry, etc.).
**Check**: Must use a context-propagating wrapper (`traced_to_thread()`, `contextvars.copy_context()`, etc.).

### P8: Exception Path Result Completeness
**Trigger**: Exception handler in a batch/multi-item processing function.
**Failure**: Bare `return state` from catch blocks → silently dropped results for unprocessed items.
**Check**: Every exception handler must synthesize explicit FAILED/SKIPPED results for ALL items being processed.

### P9: Unbounded Fan-Out
**Trigger**: Fan-out pattern (list comprehension creating parallel tasks, multiple agent calls, etc.).
**Failure**: Unbounded fan-out on large inputs → resource exhaustion (EAGAIN, connection limits, OOM).
**Check**: Is the fan-out bounded by a constant or configurable limit?

### P10: Stale References After Rename
**Trigger**: Code renames a function, variable, metric, enum value, or config key.
**Failure**: Test files, docs, or config still reference the old name → mysterious failures.
**Check**: Grep `tests/`, `docs/`, and config files for all references to the renamed symbol.

### P11: Cross-Path Field Completeness (Variant of P3)
**Trigger**: System has N output assembly paths and a new field is added.
**Failure**: Field present in N-1 paths, missing in 1 → intermittent null depending on which path executes.
**Check**: List ALL assembly paths, verify field presence in each.
