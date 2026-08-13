---
name: update-system
description: Analyze error and success logs, then propose updates to rules and patterns. Conservative — only for patterns seen 3+ times.
---

# /update-system - Self-Improvement

Analyze error and success logs, then propose updates to rules and patterns. Conservative by design — only proposes changes for patterns seen 3+ times.

## Usage
```
/update-system
```

## Instructions

### Step 1: Read Current State

1. Read `.claude/memory/logs/errors.md`
2. Read `.claude/memory/logs/successes.md`
3. Read `.claude/rules/orchestrator.md`
4. Read `.claude/memory/patterns.md`

### Step 2: Analyze Logs

**Error analysis:**
- Find errors with `Frequency: 3` or higher — these are systemic issues
- Group related errors by category
- Identify root causes that could be prevented by a rule or pattern

**Success analysis:**
- Find successes marked `Reusable: yes`
- Identify patterns that should be codified into `patterns.md`
- Look for approaches that could become standard practice

### Step 3: Generate Proposals

For each identified improvement, generate a proposal:

```markdown
## Proposed Changes

### 1. [RULE/PATTERN] <title>
- **Source:** <error/success entries that triggered this>
- **Type:** New rule | Rule update | New pattern | Pattern update
- **Change:**
  ```
  <exact text to add or modify>
  ```
- **Rationale:** <why this would help>
```

### Step 4: Present to User

Show all proposals to the user and ask for approval:
- **Accept all** — apply all changes
- **Accept selectively** — user picks which to apply
- **Reject all** — discard proposals

### Step 5: Apply Approved Changes

For each approved proposal:

**If adding a rule to `orchestrator.md`:**
- Add to the appropriate section (Core Principles, Quality Standards, Safety, Learning)
- Number it sequentially
- Keep the file well-organized

**If adding a pattern to `patterns.md`:**
- Add under the appropriate category (or create one)
- Respect the 100-line cap — evict least relevant patterns if at capacity
- Use this format:
  ```markdown
  ## <Category>
  - **<Pattern name>**: <description and when to apply>
  ```

### Step 6: Clean Up Logs

After applying changes:
- Do NOT delete the log entries that triggered the proposals
- Instead, add a note: `(Codified in rules/patterns on YYYY-MM-DD)`
- This prevents re-proposing the same change

## Safety Rules

1. **3+ threshold is mandatory** — never propose rules for one-off events
2. **User confirmation required** — never auto-apply changes to rules or patterns
3. **Don't modify SKILL.md files** — self-improvement applies to rules and patterns only
4. **Don't contradict existing rules** — new rules must be compatible with current ones
5. **Keep it concise** — each new rule is 1-2 sentences. Each pattern is 1-3 lines.
6. **Respect caps** — `orchestrator.md` shouldn't grow unbounded either. Aim for max 25 rules total.

## Example Output

```
## Analysis Summary

Errors analyzed: 12 entries
Successes analyzed: 8 entries

### High-frequency errors (3+):
- Off-by-one in pagination (Frequency: 4)
- Missing null checks on API responses (Frequency: 3)

### Reusable successes:
- Builder pattern for complex configs (seen in 3 tasks)
- Table-driven tests for validation logic (seen in 2 tasks)

## Proposed Changes

### 1. [RULE] Boundary condition testing
- **Source:** errors.md — "Off-by-one in pagination" (Freq: 4)
- **Type:** New rule
- **Change:**
  Always write boundary condition tests (empty, single, first, last) for any code
  involving indices, pagination, or ranges.
- **Rationale:** This error pattern has occurred 4 times. A rule would catch it at planning time.

### 2. [PATTERN] Null-safe API response handling
- **Source:** errors.md — "Missing null checks on API responses" (Freq: 3)
- **Type:** New pattern
- **Change:**
  ## API Responses
  - **Null-safe access**: Always validate API response shape before accessing nested fields.
    Use optional chaining (?.) or explicit null checks at the response boundary.
- **Rationale:** 3 occurrences of runtime errors from unexpected null API responses.

Accept all / Accept selectively / Reject all?
```
