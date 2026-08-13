---
name: log-error
description: Log an error or mistake to the error journal for future learning.
---

# /log-error - Record a Mistake

Log an error or mistake to the error journal for future learning.

## Usage
```
/log-error <description of what went wrong>
```

## Instructions

1. Read `.claude/memory/logs/errors.md`
2. Check if a similar error already exists:
   - If yes, increment its `Frequency` counter
   - If no, add a new entry
3. Enforce the 30-entry cap — if at capacity, remove the oldest entry with the lowest frequency
4. Write the updated file

### New Entry Format

```markdown
### YYYY-MM-DD | <Category> | Frequency: 1

**What happened:** <description>
**Root cause:** <analysis of why>
**Prevention:** <how to avoid this in the future>
```

### Categories

Choose the most appropriate:
- `syntax` — typos, wrong syntax, missing imports
- `logic` — incorrect algorithm, wrong condition, off-by-one
- `architecture` — wrong abstraction, poor separation of concerns
- `testing` — missing test, wrong assertion, flaky test
- `tooling` — build errors, config issues, dependency problems
- `security` — vulnerability introduced, insecure pattern used
- `performance` — N+1 query, unnecessary allocation, blocking call
- `process` — skipped step, wrong order, forgot to check something

### Frequency Tracking

When incrementing an existing error's frequency:
- Update the date to today
- Keep the original description but add a note about the new occurrence
- Update the `Frequency: N` counter

### Cap Enforcement

The error journal is capped at 30 entries. When adding a new entry would exceed the cap:
1. Sort entries by frequency (ascending) then by date (oldest first)
2. Remove the entry with the lowest frequency and oldest date
3. Add the new entry

### Example

```markdown
### 2025-01-15 | logic | Frequency: 2

**What happened:** Off-by-one error in pagination calculation
**Root cause:** Used `<=` instead of `<` when comparing page index to total pages
**Prevention:** Always write a test for boundary conditions (first page, last page, empty)
- 2025-01-20: Same issue in search results pagination
```
