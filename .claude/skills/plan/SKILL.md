---
name: plan
description: Generate an implementation plan without executing it. Uses researcher and architect agents.
---

# /plan - Standalone Planning

Generate an implementation plan without executing it. Uses the researcher and architect agents.

## Usage
```
/plan <description of what you want to build or change>
```

## Instructions

### Step 1: Analyze

1. Read `.claude/memory/architecture.md` for existing knowledge
2. Read `.claude/memory/patterns.md` for coding conventions
3. Read `.claude/memory/logs/errors.md` for known pitfalls

4. **Staleness check**: Apply the Architecture Staleness Protocol from `pipeline.md`. In short: skip the researcher if architecture.md has substantial content covering the areas this task touches; launch the researcher if architecture.md is empty, stale, or the task touches undocumented areas.
5. If the researcher IS needed, launch the researcher agent (subagent_type: "Explore", **tier: fast**) with:
   ```
   Explore the codebase to understand the architecture relevant to this task:
   "<task description>"

   Read .claude/memory/architecture.md for existing knowledge.
   Focus on: file structure, key modules, dependencies, test setup, and any code
   directly related to the task.

   Return a structured summary with:
   - Relevant files and their purposes
   - Key functions/classes involved
   - Dependencies and imports
   - Test file locations
   - Any gotchas or patterns to follow
   ```

6. If the researcher finds new architecture info, update `architecture.md` (respect 150-line cap)

### Step 2: Plan

Launch the architect agent (subagent_type: "Plan", **tier: balanced**) with:
```
Design an implementation plan for this task:
"<task description>"

Context from analysis:
<paste researcher results>

Known patterns (.claude/memory/patterns.md):
<paste patterns>

Known errors to avoid (.claude/memory/logs/errors.md):
<paste relevant errors>

Produce a plan with:
- Maximum 10 numbered steps
- Each step: what to do, which file(s), estimated risk (low/medium/high)
- Identify any steps that could be parallelized
- List test strategy (new tests, existing tests to run)
- Flag any decisions that need user input
```

### Step 2b: Challenge (Conditional)

**Skip plan-challenger** if ALL plan steps are [LOW] risk AND the task is docs/config only. If the architect's plan does not include a `## Task Classification:` section, treat risk as `medium` and task as `feature` — do NOT skip. Otherwise, launch the plan-challenger agent (subagent_type: "general-purpose", **tier: balanced**) with:
```
You are an adversarial plan reviewer. Read .claude/agents/plan-challenger.md for your full instructions.

Task: "<task description>"

Implementation plan from the architect:
<paste architect's plan>

Stress-test this plan. Focus on the plan's own assumptions and claims.
You can read specific files mentioned in the plan to verify assumptions,
but do NOT re-explore the entire codebase.

Look for:
- Untested assumptions about file locations, function signatures, APIs
- Failure modes and missing rollback strategies
- Hidden dependencies between plan steps
- Scope risks and missing edge cases
- Architectural weaknesses
- Missing requirements

Return structured findings with severity (must_fix, should_fix, nice_to_fix) and a verdict (SOUND, NEEDS_WORK, RISKY).
```

If the challenger returns must_fix or should_fix findings, revise the plan to address them before presenting to the user.

### Step 3: Present

Show the plan to the user with:
- Numbered steps with file targets and risk levels
- Highlighted high-risk steps
- Flagged decisions needing input
- Test strategy summary
- Scope estimate (small/medium/large)
- If the plan-challenger found issues, note what was caught and revised

### Step 4: Offer Next Steps

Ask the user:
- "Want to execute this plan? Run `/task` with the same description."
- "Want to refine it? Tell me what to change."
- "Want to save it? I'll keep it in progress.md for later."

If the user wants to save:
- Write the plan to `progress.md` with status `planned` (not `idle`)
- The next `/task` run will detect it and offer to execute

## Notes

- This skill does NOT execute the plan — it only creates it
- No files are modified except `architecture.md` (if stale) and `progress.md` (if saving)
- Use this when you want to think before acting, or when the task is complex enough to warrant upfront planning
