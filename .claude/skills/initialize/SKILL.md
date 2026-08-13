---
name: initialize
description: First-time setup for the AI Coding Orchestrator. Scans codebase, populates memory, verifies components.
---

# /initialize - First-Time Setup

Bootstrap the AI Coding Orchestrator for a project. Scans the codebase, populates memory files, verifies all components are wired up, and gets the system ready for `/task`.

## Usage
```
/initialize           # First-time setup (skips already-populated files)
/initialize --fresh   # Reset and re-scan everything
```

## Instructions

You are setting up the orchestrator for first use in this project. Follow every step below.

### Step 1: Verify Orchestrator Files

Check that all required orchestrator files exist. Report any missing files.

**Required files:**
```
.claude/CLAUDE.md
.claude/settings.json
.claude/rules/orchestrator.md
.claude/skills/task/SKILL.md
.claude/skills/task/pipeline.md
.claude/skills/log-error/SKILL.md
.claude/skills/log-success/SKILL.md
.claude/skills/update-system/SKILL.md
.claude/skills/review/SKILL.md
.claude/skills/plan/SKILL.md
.claude/skills/initialize/SKILL.md
.claude/agents/researcher.md
.claude/agents/architect.md
.claude/agents/reviewer.md
.claude/agents/test-runner.md
.claude/agents/reviewer-compliance.md
.claude/agents/plan-challenger.md
.claude/agents/doc-classifier.md
.claude/agents/doc-writer.md
.claude/agents/doc-reviewer.md
.claude/skills/docs/SKILL.md
.claude/skills/design/SKILL.md
.claude/agents/design-writer.md
.claude/agents/design-critic.md
.claude/agents/reviewer-adversarial.md
.claude/hooks/post-write-lint.sh
.claude/hooks/tdd-reminder.sh
.claude/hooks/context-monitor.sh
.claude/hooks/stop-verify.sh
.claude/hooks/session-start-load.sh
```

For each missing file, report it as an error. The user needs to re-install the orchestrator.

Verify hook scripts are executable (`chmod +x`). Fix if not.

### Step 2: Initialize Memory Files

Create any missing memory files with standard headers. If `--fresh` was passed, overwrite all memory files.

**Files to ensure exist:**

`.claude/memory/progress.md`:
```markdown
# Task Progress

## Status: idle

No task in progress.
```

`.claude/memory/architecture.md`:
```markdown
# Codebase Architecture

<!-- Cap: 150 lines. Evict oldest sections when at capacity. -->
<!-- Updated by the researcher agent during ANALYZE phase. -->
```

`.claude/memory/patterns.md`:
```markdown
# Coding Patterns & Conventions

<!-- Cap: 100 lines. Evict oldest entries when at capacity. -->
<!-- Updated by /update-system based on success/error logs. -->
```

`.claude/memory/vision.md`:
```markdown
# Project Vision

<!-- Cap: 100 lines. Updated by /initialize, /update-system, or manually. -->
<!-- Last updated: YYYY-MM-DD -->

## Design Principles

## Architectural Invariants

## Tech Debt Inventory

## What We Will NOT Do

## Quality Thresholds
```

`.claude/memory/logs/errors.md`:
```markdown
# Error Journal

<!-- Cap: 30 entries. Evict oldest when at capacity. -->
<!-- Format: ### YYYY-MM-DD | Category | Frequency: N -->
```

`.claude/memory/logs/successes.md`:
```markdown
# Success Journal

<!-- Cap: 20 entries. Evict oldest when at capacity. -->
<!-- Format: ### YYYY-MM-DD | Category | Reusable: yes/no -->
```

`.claude/memory/bug-patterns.md`:
```markdown
# Bug Patterns

<!-- Cap: 50 entries. Evict oldest when at capacity. -->
<!-- Updated: YYYY-MM-DD -->
<!-- Usage: The adversarial reviewer reads this file and checks each pattern against the current diff. -->
<!-- Add new patterns via /log-error with category "bug-pattern", or manually. -->

## How to Use This File

Each pattern below is a proven production failure mode. The adversarial reviewer checks every
pattern against the current diff during REVIEW. Any violation is automatically critical severity.

Not all patterns apply to every project. The reviewer skips patterns referencing technologies
not present in the current codebase.
```

`.claude/memory/handoff.md`:
```markdown
# Session Handoff

<!-- Cap: 50 lines. Written by context-monitor hook, consumed by /task Step 0. -->

## Status: none
```

### Step 3: Scan the Codebase

Launch the researcher agent (subagent_type: "Explore") with:

```
This is a first-time project scan for the AI Coding Orchestrator.
Explore the entire codebase and produce a comprehensive overview.

Focus on:
1. **Tech stack**: Language(s), framework(s), build tool(s), package manager
2. **Directory structure**: Top-level layout, source dirs, test dirs, config dirs
3. **Entry points**: Main files, CLI entry points, server entry points
4. **Build & run commands**: How to build, run, test, lint, format
5. **Dependencies**: Key third-party libraries and what they're used for
6. **Test setup**: Test framework, test directory, how to run tests, any fixtures/helpers
7. **Linting & formatting**: ESLint, Prettier, Ruff, rustfmt, gofmt — what's configured
8. **CI/CD**: Any pipeline configuration files
9. **Coding patterns**: Naming conventions (camelCase/snake_case/PascalCase), error handling style, module organization pattern

Return a structured summary covering all of the above.
Ignore the .claude/ directory itself — that's the orchestrator, not the project.
```

### Step 4: Populate architecture.md

Take the researcher's output and write a concise architecture summary to `.claude/memory/architecture.md`.

Format:
```markdown
# Codebase Architecture

<!-- Cap: 150 lines. Evict oldest sections when at capacity. -->
<!-- Last scanned: YYYY-MM-DD -->

## Tech Stack
- Language: ...
- Framework: ...
- Build tool: ...
- Package manager: ...
- Test framework: ...

## Directory Structure
- `src/` — ...
- `tests/` — ...
- ...

## Build & Run
- Build: `<command>`
- Run: `<command>`
- Test: `<command>`
- Lint: `<command>`
- Format: `<command>`

## Key Modules
- `module-name` — purpose (2-3 lines max)
- ...

## Dependencies
- `package-name` — what it's used for
- ...

## Test Setup
- Framework: ...
- Location: ...
- Command: `<command>`
- Fixtures/helpers: ...
```

Respect the 150-line cap. Be concise.

### Step 4.5: Populate vision.md (draft)

Use researcher findings to pre-populate what can be detected:
- **Design Principles**: Infer from code structure (e.g., MVC pattern, microservices)
- **Architectural Invariants**: Detect strong patterns that look intentional (e.g., all DB access via repository layer)
- **Tech Debt**: Scan for TODO/FIXME/HACK/XXX comments with file locations
- **Quality Thresholds**: Detect from config files (e.g., coverage thresholds, lint rules)

Present the draft to the user: "Here's a draft vision document. Review and edit the placeholders -- this helps the orchestrator make better strategic decisions."

### Step 5: Populate patterns.md

Extract coding conventions from the researcher's scan and write to `.claude/memory/patterns.md`.

Format:
```markdown
# Coding Patterns & Conventions

<!-- Cap: 100 lines. Evict oldest entries when at capacity. -->
<!-- Last scanned: YYYY-MM-DD -->

## Naming
- Variables: camelCase / snake_case / ...
- Functions: camelCase / snake_case / ...
- Classes/Types: PascalCase / ...
- Files: kebab-case / camelCase / snake_case / ...

## Error Handling
- Style: try/catch / Result types / error codes / ...
- Pattern: <describe the project's error handling approach>

## Module Organization
- Pattern: feature-based / layer-based / ...
- Imports: absolute / relative / aliased / ...

## Code Style
- Indentation: spaces (N) / tabs
- Quotes: single / double
- Semicolons: yes / no (for JS/TS)
- Line length: N chars (if configured)

## Testing
- Pattern: describe/it / test() / #[test] / ...
- Naming: `test_feature_scenario` / `should do something` / ...
- Mocking: <library or approach>
```

Only include sections that are detectable. Respect the 100-line cap.

### Step 6: Check Git Status

1. Check if the project is a git repository (`git rev-parse --is-inside-work-tree`)
2. If NOT a git repo:
   - Warn the user: "This project is not a git repository. The /task pipeline's COMMIT phase requires git."
   - Ask: "Initialize git now?" — If yes, run `git init`
3. If it IS a git repo:
   - Note the current branch
   - Check for uncommitted changes
   - Report status

### Step 7: Summary Report

Present a summary to the user:

```
## Orchestrator Initialized

### Components
- [x] Skills: 10/10 installed (task, review, plan, docs, design, log-error, log-success, update-system, initialize, my-system)
- [x] Agents: 12/12 installed (researcher, architect, reviewer, reviewer-compliance, reviewer-adversarial, plan-challenger, test-runner, doc-classifier, doc-writer, doc-reviewer, design-writer, design-critic)
- [x] Hooks: 5/5 installed (post-write-lint, tdd-reminder, context-monitor, stop-verify, session-start-load)
- [x] Rules: 1/1 loaded (orchestrator.md)
- [x] Memory: 8/8 files ready (progress, architecture, patterns, vision, handoff, bug-patterns, + 2 log files)

### Project Profile
- Language: <detected>
- Framework: <detected>
- Test command: <detected>
- Lint command: <detected>

### Ready
Run `/task <description>` to start your first orchestrated task.
```

If any component is missing, show `[ ]` instead of `[x]` and explain how to fix it.

## Notes

- This skill is safe to run multiple times — it only overwrites memory files if `--fresh` is passed
- The scan ignores `.claude/`, `node_modules/`, `.git/`, `vendor/`, `target/`, `__pycache__/`, and other common non-source directories
- If the project is empty (no source files), still initialize but note that architecture and patterns will be populated on first `/task` run
