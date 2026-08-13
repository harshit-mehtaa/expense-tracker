---
name: task
description: Run the full AI coding orchestrator pipeline (ANALYZE, PLAN, APPROVE, IMPLEMENT, VALIDATE, REVIEW, COMMIT). Use when the user asks to implement, fix, refactor, or change code with /task or in natural language.
---

# /task - AI Coding Orchestrator Pipeline

Run the full coding pipeline: ANALYZE → PLAN → APPROVE → IMPLEMENT → REVIEW → COMMIT

## Usage
```
/task <description of the coding task>
```

## Instructions

You are the orchestrator. Follow this pipeline exactly. Never skip phases.

### Secrets Safety

When reading `.env`, `.secret`, `credentials.*`, `*.key`, or any file matching common secrets patterns:
- **NEVER output raw secret values to the user.** Show key names only with values masked as `***`.
- When passing content to agents, strip or mask secret values.
- If a file read is needed for implementation context, extract only the key names and structure, not the values.
- This applies to ALL phases — ANALYZE, IMPLEMENT, REVIEW, VALIDATE, and any agent prompts.

### Cost Routing (Tier to Model Mapping)

This skill is platform-agnostic. Each agent call references a **tier**, not a specific model. The platform plugin maps tiers to its own models.

| Tier | Use Case | Claude Code | pi (Qwen) | Codex | Cursor |
|------|----------|-------------|-----------|-------|--------|
| `fast` | Structured exploration, test execution, deterministic transforms | `haiku` | small Qwen | `gpt-5.4-mini` | `cursor-small` |
| `balanced` | Planning, reviewing, adversarial reasoning (default) | `opus` | large Qwen | `gpt-5.4` | `cursor-medium` |
| `strong` | High-risk reasoning, security/auth code, large diffs | `opus` (inherit session) | large Qwen | `gpt-5.5` | `cursor-large` |

`.claude/memory/cost-routing.md` holds the authoritative map, including the exact model IDs for each platform — the table above is a summary. The active platform comes from `ACO_PLATFORM` if set, otherwise from `aco_detect_platform()` in `.claude/hooks/portable.sh`.

Each `subagent_type:` call below specifies the tier as `tier: <name>`; the platform invokes the mapped model. **Never hardcode model names** in this skill or in agent definitions — a hardcoded model breaks the pipeline on every machine that does not run that model.

**On a small local model**, read the degradation notes at the end of `cost-routing.md` before running the full pipeline. In short: prefer Tier 1 review, run reviewers sequentially rather than in parallel, and defer `plan-challenger` / `reviewer-adversarial` to a frontier-model machine — a weak model in those roles returns confident empty findings, which reads as a pass.

### Non-Interactive Mode

When the environment variable `ACO_AUTO_APPROVE` is set to `true`, all `AskUserQuestion` gates are bypassed:
- **APPROVE gate (Step 3)**: Auto-approve the plan and proceed to IMPLEMENT.
- **COMMIT gate (Step 6)**: Auto-commit (or skip commit if `ACO_SKIP_COMMIT=true`).
- **End-of-IMPLEMENT escalation**: Auto-acknowledge any unresolved test failures and proceed to VALIDATE.

Check this at each gate: if the env var equals `true`, skip `AskUserQuestion` and proceed as if the user selected "Approve". If `ACO_SKIP_COMMIT` is set to `true`, skip Step 6 entirely after REVIEW completes.

### Phase Banner (Output at Every Phase Transition)

At the start of **every phase**, output a visible banner to the user so they always know where they are in the pipeline. This is the **first thing you do** when entering a phase — before any agent delegation, file reads, or other actions.

**Banner template:**
```
========================================
  PHASE <N>/6: <PHASE_NAME>
  [<progress_bar>]  <percent>%
  <one-line description>
========================================
```

**Phase mapping:**

| Step | Phase Name | Progress Bar | % | Description |
|------|-----------|-------------|---|-------------|
| 0 | INITIALIZE | (use pipeline-start banner instead) | — | — |
| 1 | ANALYZE | `[====--------------------]` | 17% | Exploring the codebase... |
| 2 | PLAN | `[========----------------]` | 33% | Answering design questions and building plan... |
| 3 | APPROVE | `[============------------]` | 50% | Presenting plan for your approval... |
| 4 | IMPLEMENT | `[================--------]` | 67% | Executing the approved plan... |
| 5 | REVIEW | `[====================----]` | 83% | Reviewing code changes... |
| 6 | COMMIT | `[========================]` | 100% | Preparing to commit... |

**Pipeline-start banner** (output at the very beginning of Step 0):
```
========================================
  TASK PIPELINE STARTED
  ANALYZE → PLAN → APPROVE → IMPLEMENT → REVIEW → COMMIT
  Initializing...
========================================
```

**Completion banner** (output after Step 6 finishes successfully):
```
========================================
  TASK COMPLETE
  [========================]  100%
  All phases finished successfully.
========================================
```

**IMPLEMENT sub-step banner** (output before each sub-step within Step 4):
```
----------------------------------------
  IMPLEMENT — Step <N>/<total>: <step description>
----------------------------------------
```

**Resume indicator:** If resuming a previous task, append `(RESUMED)` to the phase name:
```
  PHASE 1/6: ANALYZE (RESUMED)
```

### Step 0: Initialize & Check for Resume

1. **Output the pipeline-start banner** to the user (see Phase Banner section above).
2. Read `.claude/memory/progress.md`.
3. If status is `planned` (from a previous `/plan` or `/task --dry-run`):
   - Show the user the saved plan and ask: "Execute this plan?" or "Start fresh?"
   - If executing, skip ANALYZE and PLAN — jump to APPROVE (Step 3) with the saved plan.
   - If starting fresh, reset `progress.md` to idle and continue with the new task.
4. If status is NOT `idle` and NOT `planned`, a previous task was interrupted:
   - Show the user what was in progress and which phase was last completed.
   - If `.claude/memory/handoff.md` has `Status: pending_handoff`, read it and show the Completed Work, Remaining Work, Key Decisions, and Blockers sections.
   - Ask: "Resume from [next phase]?" or "Abort and start fresh?"
   - If resuming, skip to the appropriate phase below (use the resume indicator in the phase banner). Clear handoff.md status to `none` after successful resume.
   - If aborting, reset `progress.md` to idle and `handoff.md` status to `none`, then continue with the new task.
5. Read `.claude/memory/architecture.md` and `.claude/memory/patterns.md` for context.
6. Read `.claude/memory/logs/errors.md` to avoid known mistakes.
7. **Vision check**: Read `.claude/memory/vision.md`. If it contains only placeholder comments (no actual content under Design Principles, Architectural Invariants, etc.), warn: "vision.md is empty — the orchestrator cannot validate architectural invariants. Consider populating it via `/initialize` or manually."
8. Update `progress.md`:
   ```
   ## Status: analyze
   ## Task: <user's task description>
   ## Started: <timestamp>
   ## Steps Completed: none
   ```

### Step 1: ANALYZE (DISCOVER then QUESTION)

This phase has two sub-phases: **DISCOVER** (explore the codebase) and **QUESTION** (generate the questions that will drive the plan).

1. **Output the ANALYZE phase banner** (Phase 1/6, 17% — see Phase Banner section).

#### Sub-phase 1a: DISCOVER

2. **Staleness check**: Apply the Architecture Staleness Protocol from `pipeline.md`. In short: skip the researcher if architecture.md has substantial content covering the areas this task touches; launch the researcher if architecture.md is empty, stale, or the task touches undocumented areas.
3. If the researcher IS needed, launch the `researcher` agent (subagent_type: "general-purpose", **tier: fast**) with this prompt:
   ```
   You are the researcher agent. Read .claude/agents/researcher.md for your full instructions.

   Explore the codebase to understand the architecture relevant to this task:
   "<task description>"

   Read .claude/memory/architecture.md for existing knowledge.
   Focus on: file structure, key modules, dependencies, test setup, and any code
   directly related to the task.

   Return a structured summary with relevant files, key functions/classes,
   dependencies, test setup, patterns, and gotchas.
   ```
4. If the researcher reveals architecture not captured in `architecture.md`, update it (respect 150-line cap).

#### Sub-phase 1b: QUESTION

5. **Generate DE Questions in two flavors** (see pipeline.md for full guidance):

   The DE Questions umbrella has two flavors — both must be generated:

   **Design Questions** — questions a developer needs answered BEFORE they can plan:
   - "What is the current behavior and why was it built this way?" (trace code paths, not just grep counts)
   - "What are the constraints I cannot violate?" (API contracts, downstream consumers, perf budgets)
   - "What are my options for implementing this, and what are the tradeoffs?"
   - "Where exactly does the change need to go, and what is the blast radius?"
   - "What is the simplest thing that could work?"

   **Verification Questions** — questions a reviewer will check AFTER the code is written:
   - "Are all callers/consumers updated consistently?"
   - "Is the contract preserved for downstream systems?"
   - "Are there other locations in the repo with the same pattern that need the same fix?"

   **Evidence requirements** — every question must include DEEP evidence:
   - NOT: a grep showing 3 files match a name
   - YES: `workflow_manager.py:340` reads `routing_decision` and branches on SINGLE vs DEPENDENT — change here means both branches must handle the new value. `endpoint.py:498` includes it in API response body — downstream consumer sees this value. `state_models.py:270` defines the enum — this is the source of truth.

   **What makes a good Design Question:**
   - It must be answered before the plan can be formed
   - The answer changes the approach (if it does not, it is a verification question instead)
   - It is grounded in specific code locations with traced behavior, not just grep counts

   **What makes a good Verification Question:**
   - It can only be checked after the code is written
   - It verifies consistency, completeness, or correctness across the repo
   - It has a concrete pass/fail criterion

6. Store questions in `progress.md` under `## Design Questions:` and `## Verification Questions:` as separate numbered lists with evidence.
7. Update `progress.md`: `## Steps Completed: analyze`

### Step 2: PLAN

1. **Output the PLAN phase banner** (Phase 2/6, 33% — see Phase Banner section).
2. Launch the `architect` agent (subagent_type: "general-purpose", **tier: balanced**) with this prompt:
   ```
   You are the architect agent. Read .claude/agents/architect.md for your full instructions.

   Design an implementation plan for this task:
   "<task description>"

   Context from analysis:
   <paste researcher results or architecture.md content>

   DESIGN QUESTIONS (you MUST answer each one with code evidence before planning):
   <paste Design Questions from progress.md>

   VERIFICATION QUESTIONS (map each to a plan step that ensures it will be satisfied):
   <paste Verification Questions from progress.md>

   Known patterns (.claude/memory/patterns.md):
   <paste patterns>

   Known errors to avoid (.claude/memory/logs/errors.md):
   <paste relevant errors>

   Your process:
   1. Answer each Design Question first — with file:line evidence and traced code paths
   2. Let those answers determine your approach
   3. Break the approach into max 10 numbered steps
   4. Map each Verification Question to the step(s) that satisfy it
   5. Flag any Verification Questions with no corresponding step
   6. Surface any new questions you discover while answering (tag as [design] or [verification])
   7. Include Cases Matrix, test strategy, and Task Classification
   8. Include a Validation Strategy: what task-appropriate validation would prove the change works
      (e.g., unit tests, docker build, API call, trace push, curl to staging, LLM invocation)
   ```
2b. **Surface strategic concerns**: If the architect's output includes a `## Strategic Concerns` section, incorporate these concerns into the APPROVE presentation. Do not silently drop them.
3. **Conditional plan challenge**: Evaluate whether the plan needs adversarial review.
   - **Skip plan-challenger** if ALL of: every plan step is [LOW] risk, AND the task_type is `docs` or `config`. Proceed directly to step 5.
   - **Fallback**: If the architect's plan does not include a `## Task Classification:` section, treat risk_level as `medium` and task_type as `feature` — do NOT skip the plan-challenger.
   - **Otherwise**, launch the `plan-challenger` agent (subagent_type: "general-purpose", **tier: balanced**) with this prompt:
   ```
   You are an adversarial plan reviewer. Read .claude/agents/plan-challenger.md for your full instructions.

   Task: "<task description>"

   DESIGN QUESTION ANSWERS from the architect:
   <paste the architect's Design Question Answers section>

   Implementation plan:
   <paste architect's plan>

   Verification Question Mapping:
   <paste the architect's Verification Question Mapping table>

   New Questions Discovered by architect:
   <paste if any>

   Your PRIMARY job: verify the architect's answers to design questions by reading
   the cited code yourself. If an answer is wrong, the plan built on it is wrong.

   Then stress-test the plan. Focus on:
   - Wrong or incomplete design question answers (check the cited evidence)
   - Verification questions mapped to steps that do not actually cover them
   - Failure modes and missing rollback strategies
   - Hidden dependencies between plan steps
   - Missing Cases Matrix scenarios for MED/HIGH steps
   - Validation strategy gaps — is the proposed validation actually sufficient?

   Return structured findings with severity (must_fix, should_fix, nice_to_fix),
   design question answer verification, and a verdict (SOUND, NEEDS_WORK, RISKY).
   ```
   - If risk_level is `high`, verify the plan-challenger's output includes a Pre-Mortem section. If the challenger was skipped (should not happen for high-risk), the orchestrator must perform its own pre-mortem and present it in APPROVE.
4. **Resolve findings** (if plan-challenger was run): If the plan-challenger returns must_fix or should_fix findings:
   - Revise the plan to address all must_fix findings (these are blocking)
   - If any design question answer was refuted, re-answer with correct evidence and adjust the plan accordingly
   - Address should_fix findings where practical
   - Note any nice_to_fix items for the user's awareness in APPROVE
5. **Merge new questions**: If the architect or plan-challenger discovered new questions:
   - Add them to `progress.md` under the appropriate section (Design or Verification)
   - Tag each with `[plan-phase]` to indicate when it was discovered
6. Update `progress.md`: `## Steps Completed: analyze, plan`
7. Save the (possibly revised) plan in `progress.md` under `## Plan:`

### Step 3: APPROVE

> **HARD GATE — You MUST stop here and wait for user input before proceeding to Step 4.**

1. **Output the APPROVE phase banner** (Phase 3/6, 50% — see Phase Banner section).
2. Present the plan to the user clearly:
   - **Design Question Answers**: Show each question and its answer (this is the reasoning behind the plan)
   - Numbered steps with file targets and risk levels
   - Highlight any high-risk steps
   - Show the Verification Question Mapping (which questions get checked during REVIEW)
   - Show the **Validation Strategy** (what will be run to prove the change works)
   - Show any flagged decisions needing input
   - Show any new questions discovered during PLAN phase
   - Show strategic concerns from the architect (if any)
   - Show pre-mortem findings (if HIGH-risk)
   - Note any vision.md invariants that are affected
3. **Use the `AskUserQuestion` tool** to ask the user to choose one of:
   - **Approve** — proceed with implementation as planned
   - **Edit** — user wants to modify the plan (ask what to change)
   - **Abort** — cancel the task entirely
4. **DO NOT output any further text or call any other tools until `AskUserQuestion` returns the user's choice** (or `ACO_AUTO_APPROVE=true` is set — see Non-Interactive Mode).
5. Based on the user's response:
   - If **Approve**: update `progress.md` with `## Steps Completed: analyze, plan, approve` and proceed to Step 4
   - If **Edit**: ask the user what to change, update the plan in `progress.md`. If the edit adds new steps, changes risk levels, or modifies the approach (not just wording), re-run the plan-challenger on the revised plan before re-presenting. Trivial edits (reorder, rename, drop a step) do not need re-challenge. Then re-present and re-ask for approval (repeat from item 2 above).
   - If **Abort**: reset `progress.md` to idle and **stop execution completely — do not proceed to any further steps**

### Step 4: IMPLEMENT

> **Pre-check: Only proceed if Step 3 returned "Approve" via `AskUserQuestion`. If approval was not explicitly granted, STOP and go back to Step 3.**

1. **Output the IMPLEMENT phase banner** (Phase 4/6, 67% — see Phase Banner section).

**Pre-implementation baseline:**
1. Launch the `test-runner` agent in **baseline mode** (subagent_type: "general-purpose", **tier: fast**): run the full test suite before any code changes.
   ```
   You are the test-runner agent. Read .claude/agents/test-runner.md for your full instructions.

   Run a BASELINE test run. Execute the full test suite BEFORE any code changes.
   Test command: <detect from package.json, Makefile, etc., or use common defaults>
   Report: full results — this establishes the pre-existing failure baseline.
   ```
2. Record baseline results in `progress.md` under `## Baseline Failures:` (count and summary — list up to 20 failures; if more, store count only and note "N+ pre-existing failures").
3. If no test framework is detected, note this and skip baseline (warn the user).

**Per-step loop** (repeat for each plan step):

1. **Output the IMPLEMENT sub-step banner** (see Phase Banner section) showing the current step number, total steps, and step description.
2. Update `progress.md`: `## Current Step: <step number> - <description>`
3. **Repo-wide impact search** (mandatory for any step that modifies existing code):
   Before making changes, search the entire repo for all occurrences of the pattern being modified. Use multiple keyword variants — function names, class names, string literals, error messages, config keys, enum values. Use `Grep` with at least 3 different keyword variants per concept. This ensures you do not fix something in one place while the same issue persists elsewhere.
   Record the search results (file:line for each occurrence) in your working context. If occurrences exist outside the plan's scope, flag them for the user during REVIEW.
4. **TDD cycle** (when this step involves testable behavior and a test framework exists):
   a. Write or update tests first — define expected behavior before implementation.
   b. Run the new tests — they should fail (red phase).
   c. Write the implementation code (green phase).
   d. Refactor if needed (refactor phase).
   If TDD is impractical for this step (e.g., config-only change, pure documentation, refactoring with full existing coverage), note why and write implementation first, then tests.
5. After writing/editing, hooks will auto-lint (if configured)
6. If the step involves testable code, launch the `test-runner` agent in **regression mode** (subagent_type: "general-purpose", **tier: fast**).
   For large test suites (>4 test files or >30s expected), run in background (`run_in_background: true`) and proceed to the next plan step while tests execute. Check background results before starting any step that depends on test output, and always before the end-of-phase escalation.
   ```
   You are the test-runner agent. Read .claude/agents/test-runner.md for your full instructions.

   Run a REGRESSION test run. Execute the full test suite for the changes just made.
   Test command: <detect from package.json, Makefile, etc., or use common defaults>
   Focus on: <specific test files if known>
   Baseline failures: <paste baseline failure list from progress.md>
   Compare against baseline and classify every failure per the categorization table
   in the test-runner agent definition.
   Report: pass/fail, failure classification, suggested actions.
   If running in background, write results to a timestamped file in .claude/memory/ and output a notification when complete.
   ```
7. **Handle failures by category:**
   - **NEW_REGRESSION**: Fix immediately. Up to 2 fix attempts, then escalate to user.
   - **PRE_EXISTING (related to task scope)**: Attempt to fix as part of this step.
   - **PRE_EXISTING (unrelated to task)**: Record for end-of-phase escalation.
   - **FLAKY/DEPRECATED/DUPLICATE**: Record for end-of-phase escalation with suggested next steps.
8. **Question evolution** (optional but encouraged): If implementation reveals a new question the ANALYZE phase missed, add it to `progress.md` with tag `[implement-phase]`. Examples:
   - "While implementing step 3, discovered that `normalize_result()` has a different code path for empty lists — does this need the same change?" `[implement-phase, verification]`
   - "The API contract in the docstring says field X is required, but the code treats it as optional — which is correct?" `[implement-phase, design]`
9. Update `progress.md`: append step number to `## Steps Completed:`

**End-of-phase escalation** (after all plan steps complete):
1. If any test failures remain unresolved (pre-existing unrelated, flaky, obsolete, duplicate):
   - Compile a failure report listing each unresolved failure with: test name, file, category, suggested action, impact of not resolving.
   - **Use `AskUserQuestion`** to present the report and ask the user to acknowledge or provide direction for each item (or auto-acknowledge if `ACO_AUTO_APPROVE=true`).
   - User must respond before proceeding to VALIDATE.
2. If all tests pass (or all failures are resolved/acknowledged), proceed directly to VALIDATE.

**VALIDATE sub-phase** (after all plan steps and test escalation):

The validation step proves the change actually works beyond unit tests. The right validation depends on the task:

| Task Type | Validation Examples |
|-----------|-------------------|
| LLM integration | Make a test LLM call, verify response structure |
| Tracing/observability | Push a dummy trace to the tracing backend, query it back |
| Docker/build | Build the Docker image, verify it starts |
| API changes | Curl the endpoint (locally or staging), verify response |
| Config changes | Load the config, verify values are picked up |
| Database/migration | Run migration on test DB, verify schema |
| CLI tools | Run the command with test args, verify output |
| Pure refactor | Run the full test suite, verify no behavioral change |

**Validation protocol:**
1. Determine the appropriate validation from the plan's **Validation Strategy** (set by architect in PLAN phase).
2. Run the validation. If it requires infrastructure (Docker, staging, external APIs), check availability first.
3. If validation **passes**: record results in `progress.md` under `## Validation Results:` and proceed to REVIEW.
4. If validation **fails**: fix the issue within IMPLEMENT context (you still have full edit access). Max 2 fix-validate cycles, then escalate to user via `AskUserQuestion`.
5. Pass validation evidence to reviewers in REVIEW (so they can see proof the change works).

3. Update `progress.md`: `## Steps Completed: analyze, plan, approve, implement`

### Step 5: REVIEW (Risk-Proportionate, Triple Reviewers Available)

1. **Output the REVIEW phase banner** (Phase 5/6, 83% — see Phase Banner section).

2. **Compile the full question list**: Merge all questions from all phases:
   - Design Questions (from ANALYZE)
   - Verification Questions (from ANALYZE)
   - New questions from PLAN phase `[plan-phase]`
   - New questions from IMPLEMENT phase `[implement-phase]`

3. **Determine review tier** from the task classification stored in `progress.md`:
   - **Tier 1** (LOW risk + docs/config/chore task_type): Run quality reviewer only. Skip compliance and adversarial reviewers. Skip Question Resolution table. Skip Cases Matrix Verification. Co-Founder Filter not needed.
   - **Tier 2** (MEDIUM risk or feature/refactor/bugfix): Run quality + adversarial reviewers in parallel. Skip compliance reviewer. Question Resolution required. Co-Founder Filter required.
   - **Tier 3** (HIGH risk or security task_type): Run all three reviewers in parallel. Full Question Resolution + Cases Matrix Verification + Co-Founder Filter.
   - **Fallback**: If no task classification exists in progress.md, treat as Tier 2.

4. Launch reviewers according to the tier:

   **Tier routing for quality reviewer**: Check the architect's task classification from the plan.
   - If risk_level is `high` OR the diff is >= 100 lines OR the task involves security/auth: **tier: strong**
   - Otherwise (low/medium risk, small diff, no security concerns): **tier: balanced**

   **Tier routing for adversarial reviewer**: Default **tier: balanced**. If the task involves security/auth changes, **tier: strong**.

   **a) Quality Reviewer** (subagent_type: "general-purpose", **tier: see routing above**):
   ```
   You are a code quality reviewer. Read .claude/agents/reviewer.md for your full instructions.

   Review the code changes made for this task:
   "<task description>"

   Review as a senior engineer, a distinguished engineer, AND a principal engineer.
   Focus ONLY on code quality — not plan compliance.

   Use `git diff` to see all changes.

   Check for correctness, edge cases, security (OWASP top 10), performance,
   style, tests, scalability, robustness, code smells, and first principles.

   Validation evidence:
   <paste validation results from IMPLEMENT phase>

   Rate each issue: critical / high / medium / low
   Return a structured review with Summary, Issues list, and Verdict (PASS, PASS_WITH_NOTES, or FAIL).
   ```

   **b) Compliance Reviewer** (subagent_type: "general-purpose", **tier: balanced**) — only in Tier 3:
   ```
   You are a plan compliance reviewer. Read .claude/agents/reviewer-compliance.md for your full instructions.

   Task: "<task description>"

   Approved plan:
   <paste the approved plan from progress.md>

   Use `git diff` to see all changes.

   Verify that every plan step was implemented, all planned tests were written,
   no unplanned scope drift occurred, and risk mitigations are in place.
   Also verify that the Validation Strategy was executed and passed.

   Return a structured compliance report with Step-by-Step Verification table,
   Issues (non-compliant items, scope drift, test gaps), and Verdict
   (COMPLIANT, PARTIAL, or NON_COMPLIANT).
   ```

   **c) Adversarial Developer Reviewer** (subagent_type: "general-purpose", **tier: see routing above**) — Tier 2 and Tier 3:
   ```
   You are an adversarial developer reviewer. Read .claude/agents/reviewer-adversarial.md for your full instructions.

   Your job is to find what is MISSING and BREAK what is there: unanswered questions, broken assumptions, blast-radius misses, design challenges, security holes, and unnecessary changes.

   Task: "<task description>"

   DESIGN QUESTIONS + ARCHITECT ANSWERS:
   <paste design questions and the architect's answers from the plan>

   VERIFICATION QUESTIONS:
   <paste all verification questions>

   EVOLVED QUESTIONS (added during PLAN and IMPLEMENT):
   <paste any questions tagged [plan-phase] or [implement-phase]>

   Use `git diff` to see all changes. Then perform the full audit per
   reviewer-adversarial.md:
   1. Unanswered Questions Audit (PRIMARY) — for each question, mark ANSWERED / PARTIALLY_ANSWERED / UNANSWERED / INVALIDATED with file:line evidence.
   2. Broken Assumptions Audit — for each Design Question Answer, check if reality matches.
   3. Blast Radius Analysis — grep ENTIRE repo for callers/consumers of changed code.
   4. Edge Case Stress Test — concrete edge case tables per changed function.
   5. Design Challenge Checklist — challenge every non-trivial implementation choice with concrete alternatives.
   6. Security Hunt — beyond OWASP top 10 (data exposure, injection vectors, auth/access, supply chain).
   7. Unnecessary Change Detection — classify each diff hunk: ESSENTIAL, SUPPORTING, COSMETIC, DRIVE-BY, SUSPICIOUS.
   8. System-Level Bug Pattern Check — read .claude/memory/bug-patterns.md (if present) and check each pattern.

   Return findings in the format from reviewer-adversarial.md.
   ```

5. **Co-Founder Filter** (Tier 2 + Tier 3 only, after reviewers return):
   Apply the co-founder filter to the adversarial reviewer's findings (see pipeline.md for full protocol).
   For each adversarial finding:
   - **Verify the claim** with a fresh code read — do not trust the adversarial reviewer blindly
   - **Classify**: ACCEPTED (fix now), ACCEPTED_DEFERRED (valid but out of scope), DECLINED (false positive or pedantic), CHALLENGED (valid point but wrong solution — counter-propose)
   - **Push back on bad ideas**: If the adversarial reviewer suggests over-engineering (strategy pattern for 2 cases, abstraction with 1 caller), decline it with evidence. If it conflicts with established patterns in `patterns.md`, decline it.
   - **Accept genuine improvements**: Real edge cases that crash, real security leaks, genuinely better approaches (structured output over regex, stdlib over hand-rolled) — accept them.
   Output the **Co-Founder Filter table** to the user for transparency.

6. **Question Resolution Table** (Tier 2 + Tier 3 — the key verification gate):
   Build a unified resolution table for ALL questions from ALL phases. For EACH question:
   - **Re-read the relevant code** (file:line) fresh — do NOT rely on memory or prior reads from earlier phases
   - **Repo-wide verification**: Use `Grep` with multiple keyword variants to confirm the fix is complete across the entire repo, not just the files in the plan
   - Cross-reference with the adversarial reviewer's Unanswered Questions audit
   - Mark status: **RESOLVED** (with code evidence), **PARTIALLY_RESOLVED**, or **UNRESOLVED**

   Output the table:
   ```
   ## Question Resolution
   | # | Question | Type | Phase Added | Status | Evidence |
   |---|----------|------|-------------|--------|----------|
   | DQ1 | <question> | design | analyze | RESOLVED | <file:line — what was verified> |
   | VQ1 | <question> | verification | analyze | RESOLVED | <file:line — verified across repo> |
   | VQ3 | <question> | verification | plan-phase | UNRESOLVED | <why — what is still missing> |
   | EQ1 | <question> | verification | implement-phase | PARTIALLY_RESOLVED | <what is done, what is not> |
   ```

7. **Cases Matrix Verification** (Tier 3 only — see pipeline.md for protocol):
   For each case in the Cases Matrix, verify against actual code:
   - VERIFIED: Code handles this AND a test covers it
   - IMPLEMENTED_UNTESTED: Code handles it but no test
   - UNVERIFIED: Cannot confirm

8. **Merge findings**: Combine all reviewer outputs, the co-founder filter table, question resolution, AND cases matrix (where applicable). The overall verdict is:
   - **PASS**: Quality is PASS/PASS_WITH_NOTES AND (Tier 3) compliance is COMPLIANT/PARTIAL AND (Tier 2+) all questions RESOLVED AND (Tier 3) no UNVERIFIED cases on MED/HIGH steps AND no ACCEPTED adversarial findings with critical/high severity
   - **FAIL**: Quality is FAIL OR (Tier 3) compliance is NON_COMPLIANT OR (Tier 2+) any question UNRESOLVED OR (Tier 3) any MED/HIGH case UNVERIFIED OR any ACCEPTED adversarial finding with critical/high severity
   - If any reviewer identifies critical/high issues (after co-founder filter for adversarial), the overall verdict is FAIL
9. If overall verdict is FAIL:
   - Fix all critical and high issues from quality reviewer
   - Fix all ACCEPTED critical/high findings from adversarial reviewer
   - Fix all UNRESOLVED/PARTIALLY_RESOLVED questions
   - Re-run the relevant reviewer(s) if significant changes were made
10. Update `progress.md`: `## Steps Completed: analyze, plan, approve, implement, review`

### Step 6: COMMIT

> **HARD GATE — You MUST get user approval before creating the commit** (unless `ACO_AUTO_APPROVE=true`).

1. **Output the COMMIT phase banner** (Phase 6/6, 100% — see Phase Banner section).
2. If `ACO_SKIP_COMMIT=true`, skip this entire phase. Inform the user that REVIEW completed and changes remain uncommitted.
3. Run `git diff --stat` to show the user what changed.
4. Generate a conventional commit message:
   - Prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`
   - Concise subject line (< 72 chars)
   - Body with summary of changes if needed
   - **Never add AI authorship metadata.** Do not include `Co-Authored-By`, `Generated by`, or any other trailer/footer that attributes the commit to an AI assistant.
5. **Use the `AskUserQuestion` tool** to present the commit message and ask the user to:
   - **Commit** — proceed with this commit message
   - **Edit message** — user wants to change the commit message
   - **Abort** — do not commit (leave changes staged)
6. **DO NOT create the commit until the user explicitly approves via `AskUserQuestion`** (or `ACO_AUTO_APPROVE=true`).
7. Based on the user's response:
   - If **Commit**: stage relevant files (prefer specific files over `git add -A`), create the commit, then **output the completion banner** (see Phase Banner section).
   - If **Edit message**: ask for the new message, then re-present for approval
   - If **Abort**: skip the commit and inform the user that changes remain uncommitted
8. Update `progress.md`:
   ```
   ## Status: idle
   ## Last Task: <description>
   ## Last Completed: <timestamp>
   ## Steps Completed: all
   ```

### Telemetry (automatic — no action needed)

Telemetry is handled automatically by the `telemetry-emit.sh` Stop hook. It fires when the session ends, reads `progress.md` for review verdicts and task classification, and writes one JSONL line to `.claude/memory/logs/sessions-YYYY-MM-DD.jsonl`. The pipeline does NOT need to call any telemetry scripts explicitly. This is invisible to the user.

### Auto-Logging for Self-Improvement

To feed the self-improvement loop (`/update-system`), auto-log these pipeline events to `.claude/memory/logs/errors.md`:
- If the plan-challenger returns verdict `RISKY`: log category `plan-quality`, description of the primary concern
- If any reviewer returns verdict `FAIL` (quality) or `DESTROYED` (adversarial): log category `code-quality`, description of the primary critical finding
- Same shape as `/log-error` entries, with `[auto]` prefix to distinguish from manual logs

Do NOT auto-log `NEEDS_WORK`, `BRUISED`, or `PASS_WITH_NOTES` — these are normal outcomes, not patterns worth tracking.

### Error Handling

- If any phase fails unexpectedly, update `progress.md` with the failure details
- Suggest the user run `/log-error` to record the issue
- Do NOT leave `progress.md` in a stale state — always update status
- Max 2 IMPLEMENT-REVIEW cycles before escalating to user

### Detailed Phase Reference

See `.claude/skills/task/pipeline.md` for expanded guidance on each phase: deeper rationale for DISCOVER and QUESTION, plan format, validation protocol, co-founder filter, question evolution, and more.
