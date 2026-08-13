---
name: log-success
description: Log a successful pattern or approach to the success journal for future reuse.
---

# /log-success - Record a Win

Log a successful pattern or approach to the success journal for future reuse.

## Usage
```
/log-success <description of what worked well>
```

## Instructions

1. Read `.claude/memory/logs/successes.md`
2. Check if a similar success already exists:
   - If yes, update it with the new context and mark as `Reusable: yes` if not already
   - If no, add a new entry
3. Enforce the 20-entry cap — if at capacity, remove the oldest non-reusable entry
4. Write the updated file

### New Entry Format

```markdown
### YYYY-MM-DD | <Category> | Reusable: <yes/no>

**What worked:** <description>
**Why it worked:** <analysis>
**Pattern:** <reusable pattern or approach>
**Context:** <when to apply this>
```

### Categories

Choose the most appropriate:
- `pattern` — design pattern, code structure that worked well
- `approach` — problem-solving strategy, debugging technique
- `tooling` — tool usage, configuration that saved time
- `testing` — testing strategy, test pattern that caught bugs
- `architecture` — architectural decision that proved correct
- `communication` — how the plan/review was structured effectively
- `performance` — optimization that made a measurable difference

### Reusability Assessment

Mark as `Reusable: yes` if the pattern can be applied to other tasks:
- Is it generalizable beyond the specific task?
- Does it represent a repeatable approach?
- Would it be useful to reference in future planning?

Mark as `Reusable: no` if it's specific to one situation.

### Cap Enforcement

The success journal is capped at 20 entries. When adding a new entry would exceed the cap:
1. First, try to remove a `Reusable: no` entry (oldest first)
2. If all entries are `Reusable: yes`, remove the oldest one
3. Add the new entry

### Example

```markdown
### 2025-01-15 | pattern | Reusable: yes

**What worked:** Used the builder pattern for complex configuration objects
**Why it worked:** Made the API fluent, reduced constructor parameter count from 12 to 0
**Pattern:** When an object has 5+ configuration options, use a builder with sensible defaults
**Context:** Any time you need to construct complex objects with many optional parameters
```
