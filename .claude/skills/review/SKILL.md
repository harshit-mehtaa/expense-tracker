# /review - Standalone Code Review

Run a code review on the current changes without going through the full /task pipeline.

## Usage
```
/review                    # Review all uncommitted changes
/review <file or path>     # Review specific file(s)
```

## Instructions

### Step 1: Determine Scope

- If no argument provided, review all uncommitted changes (`git diff` + `git diff --cached`)
- If a file or path is provided, review only those changes
- If there are no changes, inform the user and stop

### Step 2: Gather Context

1. Read `.claude/memory/patterns.md` for coding conventions
2. Read `.claude/memory/logs/errors.md` for known pitfalls
3. Identify the purpose of the changes from commit history and code context

### Step 3: Delegate to Reviewer

**Tier routing**: Use **tier: balanced**. For security-sensitive changes (files/identifiers involving auth, crypto, secret, password, token, permission, role, session) or diffs >= 100 lines, use **tier: strong**. Tiers map to concrete models per platform in `.claude/memory/cost-routing.md` — never name a model here, or this skill stops working on any machine that is not running Claude Code.

Launch the reviewer agent (subagent_type: "general-purpose", **tier: see routing above**) with:

```
Review the following code changes.

Task context: <inferred from diff or user description>

Review as a senior engineer, a distinguished engineer, AND a principal engineer.

Use `git diff` to see all changes. If specific files were requested, focus on:
<files>

Check for:
- Correctness: Does the code do what it should?
- Edge cases: Missing error handling, boundary conditions?
- Security: Any OWASP top 10 concerns?
- Performance: Unnecessary allocations, N+1 queries, blocking calls?
- Style: Consistent with codebase patterns?
- Tests: Adequate coverage? Failure paths tested? Deterministic?
- Scalability: Time/space complexity at scale? Unbounded growth? Concurrency safety? Resource limits?
- Robustness: Boundary conditions? Timeout handling? Graceful degradation? Idempotency?
- Code Smells: God objects? Duplication? Deep nesting? Magic numbers? Tight coupling?
- First Principles: Root cause vs symptom? Hidden assumptions? Correct data model? YAGNI? Separation of concerns?

Known patterns to enforce:
<paste patterns.md content>

Known errors to watch for:
<paste relevant errors from errors.md>

Rate each issue: critical / high / medium / low
Return your review in the structured format specified in your agent definition.
```

### Step 3b: Adversarial Review (parallel with Step 3)

Launch the adversarial reviewer agent in parallel with the quality reviewer (subagent_type: "general-purpose", **tier: balanced**; **tier: strong** for security-sensitive changes). On a small local model, run this sequentially rather than in parallel and see the degradation notes in `cost-routing.md`:

```
You are an adversarial developer reviewer. Read .claude/agents/reviewer-adversarial.md for your full instructions.

Your job is to BREAK this code.

Task context: <inferred from diff or user description>

Use `git diff` to see all changes. Then go BEYOND the diff:
- Generate concrete edge case tables for each changed function
- Challenge design decisions: why this approach vs the modern/correct alternative?
- Hunt for security leaks, SOLID/DRY/YAGNI violations with evidence
- Classify every diff hunk: ESSENTIAL, SUPPORTING, COSMETIC, DRIVE-BY, SUSPICIOUS
- Check known bug patterns from .claude/memory/bug-patterns.md

Return your findings in the structured format from reviewer-adversarial.md.
```

### Step 3c: Co-Founder Filter

After both reviewers return, apply the co-founder filter to adversarial findings:
- For each finding, verify with a fresh code read
- Classify: ACCEPTED, ACCEPTED_DEFERRED, REJECTED, CHALLENGED
- Push back on false positives and over-engineering; accept genuine improvements
- Output the Co-Founder Filter table

### Step 4: Present Results

Show combined output to the user:
- Quality reviewer summary and issues by severity
- Co-Founder Filter table (adversarial findings after triage)
- Merged verdict (quality + accepted adversarial findings)

### Step 5: Offer Next Steps

Based on the verdict:
- **PASS**: "Changes look good. Ready to commit?"
- **PASS_WITH_NOTES**: "Changes are acceptable with minor notes. Want to address them or commit as-is?"
- **FAIL**: "Critical/high issues found. Want me to fix them?"

If the user wants fixes, apply them directly (no need for the full /task pipeline).
