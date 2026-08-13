# Pipeline Phase Reference

Expanded guidance for each phase of the `/task` pipeline. See `SKILL.md` for the canonical step sequence and Mode Detection rules; this file goes deeper on the reasoning and examples behind each phase.

## Secrets Safety

When reading `.env`, `.secret`, `credentials.*`, `*.key`, or any file matching common secrets patterns:
- **NEVER output raw secret values to the user.** Show key names only with values masked as `***`.
- When passing content to agents, strip or mask secret values.
- If a file read is needed for implementation context, extract only the key names and structure, not the values.
- This applies to ALL phases — ANALYZE, IMPLEMENT, REVIEW, VALIDATE, and any agent prompts.

## Phase Banners — Transparency Guidelines

Every phase transition MUST begin with a visible banner output to the user. This is the orchestrator's primary transparency mechanism.

### Why banners matter:
- The pipeline can take several minutes end-to-end. Without banners, the user sees a stream of agent calls and file edits with no sense of progress.
- Banners give the user a clear mental model: "I am at step 3 of 6, halfway done."
- They also help with session recovery — if the user sees "PHASE 4/6: IMPLEMENT" before a disconnect, they know exactly where they left off.

### Banner rules:
1. Output the banner FIRST. Before any agent call, file read, or tool invocation for that phase.
2. Use the exact template from SKILL.md. Do not improvise the format — consistency matters.
3. IMPLEMENT sub-step banners are mandatory. For each plan step within IMPLEMENT, output a sub-step banner showing N/total and the step description.
4. Resume indicator. When resuming from a previous session, append `(RESUMED)` to the phase name in the banner.
5. Completion banner. After a successful commit, output the completion banner. Do NOT show it if the user aborted the commit.
6. Do not suppress banners. Even if a phase is trivial or fast, always show the banner.

### IMPLEMENT sub-step example:
During the IMPLEMENT phase, the user should see granular progress as each plan step executes:
```
----------------------------------------
  IMPLEMENT — Step 3/5: Update routes.ts
----------------------------------------
```
This helps the user understand which part of the plan is currently being worked on, especially for large plans with many steps.

## ANALYZE Phase — Deep Dive

The ANALYZE phase has two sub-phases: DISCOVER and QUESTION.

### Sub-phase 1a: DISCOVER

#### Architecture staleness check (PROJECT mode):
Before launching the researcher, evaluate whether `.claude/memory/architecture.md` already provides sufficient context:
- Skip researcher if: architecture.md has a detailed overview AND the task touches areas already documented there. Pass existing content directly to the QUESTION sub-phase.
- Launch researcher if: architecture.md is empty/minimal, OR the task touches undocumented areas.

In AD-HOC mode (no `.claude/memory/`), always launch the researcher.

The researcher uses **tier: fast** — structured exploration, not complex reasoning. (See the Cost Routing section in SKILL.md for the tier-to-model mapping.)

#### What the researcher agent should explore (when launched):
- Project root: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Makefile` — understand the tech stack
- Source structure: `src/`, `lib/`, `app/`, `cmd/` — map the codebase layout
- Test structure: `test/`, `tests/`, `__tests__/`, `*_test.*`, `*.spec.*` — find test patterns
- Config files: `.eslintrc`, `tsconfig.json`, `rustfmt.toml`, `.prettierrc` — understand tooling
- CI/CD: `.github/workflows/`, `Jenkinsfile`, `.gitlab-ci.yml` — understand pipeline constraints

#### Architecture.md update rules (PROJECT mode only):
- Only update if the researcher found something not already captured
- Summarize, do not dump — each module gets 2-3 lines max
- Group by: tech stack, directory layout, key modules, test setup, build commands
- Respect the 150-line cap; evict the least relevant sections first

### Sub-phase 1b: QUESTION

After DISCOVER, generate two types of questions that will drive the rest of the pipeline.

#### Design Questions — What a Developer Asks Before Planning

Design questions are the questions a developer needs answered BEFORE they can form an approach. The answer to each question should change the plan — if it does not, it belongs in Verification Questions instead.

Categories of good design questions:

1. **Current behavior**: "What does the code do today and why was it built this way?"
   - Trace the actual code paths, not just grep counts
   - Understand the intent behind the current design, not just the mechanics

2. **Constraints**: "What can I not violate?"
   - API contracts with downstream consumers (other services, external APIs)
   - Performance budgets, SLAs, resource limits

3. **Options**: "What are my implementation options and their tradeoffs?"
   - Only generate this when there are genuinely multiple viable approaches
   - Each option should be concrete (not "we could refactor" — "we could add a field to ResultModel vs create a new model")

4. **Blast radius**: "Where exactly does the change go, and what else does it touch?"
   - Trace dependencies in both directions (what this code depends on, what depends on this code)
   - Map all assembly paths, all consumers, all callers

5. **Simplicity**: "What is the simplest thing that could work?"
   - This is a forcing function against over-engineering
   - If the simplest approach has known downsides, state them so the architect can weigh them

Evidence depth — the key bar:

Every question must include DEEP evidence that traces what the code DOES, not just where it IS.

Shallow evidence (NOT acceptable):
> `grep -rn "routing_decision" src/` shows 3 files.

Deep evidence (required):
> - `workflow_manager.py:340` reads `routing_decision` and branches: SINGLE calls `run_single_patch()`, DEPENDENT calls `run_dependent_pipeline()`. Change here means both branches must handle the new value.
> - `endpoint.py:498` serializes it into the API response body. Downstream consumer parses this field — change here means that consumer sees different values.
> - `state_models.py:270` defines the enum as the source of truth. All other occurrences derive from this.

Why deep evidence matters: Shallow evidence tells you WHERE to look. Deep evidence tells you WHAT to think about. The architect cannot make good decisions from grep counts — they need to understand behavior.

#### Verification Questions — What a Reviewer Checks After Code Is Written

Verification questions are audit/consistency checks that can only be evaluated after the implementation exists. They do not shape the plan — they verify it.

Categories:
- Cross-repo consistency: "Are all callers/consumers of X updated?"
- Contract preservation: "Does the output still satisfy downstream expectations?"
- Pattern completeness: "Are there other locations with the same pattern that need the same fix?"
- Test coverage: "Are the new code paths tested?"

Each verification question must have a concrete pass/fail criterion:
- NOT: "Is the API contract preserved?"
- YES: "Does `endpoint.py` still return `routing_decision` as a string enum value matching one of [SINGLE, DEPENDENT, MIXED]? Verify by reading the response serialization at endpoint.py:498."

#### Example questions:

```
## Design Questions:
DQ1. What is the current output assembly flow for ResultModel, and how many distinct code paths exist?
   Evidence: `workflow_manager.py:260-370` assembles output for single-item. `parallel_processor.py:180` assembles for independent multi-item. `dependent_processor.py:220` assembles for dependent multi-item. `normalize_result()` at `utils.py:45` is a shared normalizer called by all three paths. That is 4 distinct assembly touchpoints — any new field must be added to all 4.

DQ2. Can we add the new field to ResultModel directly, or does the Pydantic model validation reject unknown fields?
   Evidence: `state_models.py:285` defines `ResultModel(BaseModel)` with `model_config = ConfigDict(extra="forbid")`. Adding a field requires modifying the model definition — we cannot just set it ad-hoc.

## Verification Questions:
VQ1. After adding the new field, do all 4 output assembly paths populate it?
   Pass/fail: grep for the field name across all 4 files (workflow_manager, parallel_processor, dependent_processor, utils/normalize). All 4 must set it.

VQ2. Do existing tests still pass with the new field in ResultModel?
   Pass/fail: full test suite green with no new regressions.
```

#### Storage:
Store in the progress file under `## Design Questions:` and `## Verification Questions:` as separate numbered lists. Each question is 2-5 lines: the question itself, then the deep evidence.

### Question Evolution — Living Questions Across Phases

Questions are NOT frozen after ANALYZE. They evolve as understanding deepens:

| Phase | Who adds questions | Tag | Example |
|-------|-------------------|-----|---------|
| ANALYZE | Orchestrator | (no tag — original) | "What are the output assembly paths?" |
| PLAN | Architect | `[plan-phase]` | "The architect discovered that `normalize_result` has a legacy code path for v1 responses — does this need updating?" |
| PLAN | Plan-challenger | `[plan-phase]` | "The challenger found that the architect's answer to DQ2 is incomplete — `extra='forbid'` only applies to __init__, not to direct attribute assignment" |
| IMPLEMENT | Orchestrator | `[implement-phase]` | "While implementing step 3, found that `endpoint_v2.py` also serializes ResultModel — not in the original grep results" |

Rules for evolved questions:
- Tag with the phase where they were discovered
- Tag as `[design]` or `[verification]` based on type
- Design questions added mid-pipeline should be answered before the step that depends on them
- Verification questions added mid-pipeline get checked in REVIEW alongside the originals
- All evolved questions appear in the final Question Resolution Table

## PLAN Phase — Deep Dive

### The architect's primary job: Answer questions, then plan

Key principle: the architect ANSWERS design questions before planning. The plan is a consequence of those answers, not a separate artifact.

- Architect receives questions → answers each with code evidence → answers determine the approach → plan follows from answers
- NOT: produces plan first → maps questions to steps after the fact

### Good plan characteristics:
- Each step traces back to a Design Question answer or task requirement
- Verification Questions are mapped to specific steps (not just "covered somewhere")
- High-risk steps come with rollback strategies
- Dependencies between steps are explicit
- Steps that can run in parallel are marked
- New questions discovered during planning are surfaced

### Risk assessment criteria:
- Low: Additive changes, new files, adding tests
- Medium: Modifying existing logic, changing interfaces, database changes
- High: Refactoring core modules, changing auth/security, modifying build/deploy

### Plan example:
```
1. [LOW] Create `src/handlers/hello.ts` - new endpoint handler
   Answers: DQ1 (simplest approach is a new handler)
2. [LOW] Add route in `src/routes.ts` - register the handler
3. [MED] Update `src/middleware/auth.ts` - add new permission check
   Answers: DQ3 (existing auth middleware needs extension, not replacement)
4. [LOW] Create `tests/handlers/hello.test.ts` - unit tests
5. [LOW] Run full test suite - verify no regressions
```

## Plan Challenge — Deep Dive

After the architect produces a plan, the plan-challenger agent stress-tests it — starting with verifying the architect's answers.

### The challenger's primary job: Verify answers

The plan-challenger's most important function is checking whether the architect's Design Question Answers are correct. A plan built on wrong answers is wrong regardless of how well-structured the steps are.

For each answer, the challenger:
1. Reads the cited code evidence (file:line) independently
2. Confirms or refutes the architect's interpretation
3. If refuted, flags as must_fix — the plan needs to change

### When to skip plan-challenger:
- All plan steps are [LOW] risk AND the task_type is `docs` or `config`
- This saves ~8,000-12,000 tokens on trivial tasks

### Context efficiency:
The plan-challenger receives the architect's answers and plan — NOT the raw researcher output. The challenger can read individual files to verify claims, but should not re-explore the entire codebase.

### What the plan-challenger checks (in priority order):
1. Design question answer accuracy: Are the cited code paths correct? Are there paths the architect missed?
2. Plan follows from answers: If the answer says "4 assembly paths," does the plan update all 4?
3. Verification question coverage: Are mapped steps actually sufficient?
4. Failure modes: What happens if a step fails? Is there a recovery path?
5. Hidden dependencies: Implicit ordering constraints, shared state, external dependencies
6. Cases Matrix calibration: Over-engineered (unrealistic cases) or under-engineered (missing realistic failures)?

### Severity levels:
- must_fix: Blocking — the plan should not proceed. Examples: wrong design question answer, plan contradicts its own answers, missing critical assembly path.
- should_fix: Important — the plan is weaker without these. Examples: incomplete verification question mapping, missing rollback strategy.
- nice_to_fix: Minor improvements — not blocking but would improve quality.

### How findings are resolved:
1. If a design question answer is REFUTED → re-answer correctly, revise the plan
2. All must_fix findings are addressed by revising the plan
3. Missing Cases Matrix scenarios → add cases or add plan steps
4. should_fix findings are addressed where practical
5. nice_to_fix items are noted for user's awareness during APPROVE

### Cases Matrix storage:
After the plan is finalized (post-challenger revisions), store the Cases Matrix in the progress file under `## Cases Matrix:`. This is loaded during REVIEW for verification.

### Integration with APPROVE:
- The plan presented to the user in APPROVE includes the Design Question Answers (so the user sees the reasoning)
- If the challenger caught wrong answers, briefly note what was corrected
- Verification Question Mapping shows the user which checks happen during REVIEW

## APPROVE Phase — Deep Dive

> This is a HARD GATE. You must use `AskUserQuestion` and stop until the user responds.

### How to present the plan:

Show the reasoning, not just the steps.

1. Design Question Answers — show each question and answer. This is the "why" behind the plan.
2. Numbered steps with risk levels, file targets, and which questions each step addresses
3. Verification Question Mapping — show which questions get checked in REVIEW
4. Any new questions discovered during PLAN phase
5. Decisions the architect flagged for user input
6. Estimated scope (small: 1-3 files, medium: 4-8 files, large: 9+)

### How to get approval:
- Use the `AskUserQuestion` tool with options: Approve, Edit, Abort
- Do NOT proceed to IMPLEMENT until `AskUserQuestion` returns
- Do NOT treat printing the plan as implicit approval

### Handling user edits:
- If the user changes steps, re-validate the plan for consistency
- If the user challenges a Design Question Answer, investigate and update
- Save the edited plan back to the progress file
- Re-present and re-ask for approval

## IMPLEMENT Phase — Deep Dive

### Repo-wide impact search (mandatory)

Before modifying any existing code, you MUST search the entire repo for all occurrences of the pattern being changed.

#### Search protocol:
1. Identify the concept being changed
2. Search with at least 3 keyword variants per concept
3. Record every occurrence (file:line)
4. Classify each occurrence: IN_SCOPE, NEEDS_SAME_FIX, DIFFERENT_CONTEXT, TEST_REFERENCE
5. If NEEDS_SAME_FIX occurrences exist: expand the plan step or flag for REVIEW

### Question evolution during IMPLEMENT

As you implement, you may discover things the ANALYZE phase missed. Add new questions to the progress file with `[implement-phase]` tag:

When to add a question:
- You discover a code path not in the original analysis
- You find a contradiction between the code and the documentation
- You realize a Design Question answer was incomplete
- You encounter a pattern that might need the same change elsewhere

Format:
```
## Evolved Questions:
EQ1. [implement-phase, verification] While implementing step 3, discovered that `normalize_result()` has a legacy code path at utils.py:67 that handles v1 responses differently — does this need the same field addition?
   Evidence: utils.py:67-89 branches on `response_version == "v1"` and skips the new normalization logic.
```

These questions get checked in the Question Resolution Table during REVIEW.

### Step execution rules:
- Read the target file before editing (never blind-edit)
- Follow existing code style — match indentation, naming, patterns
- If `patterns.md` (PROJECT mode) has relevant conventions, follow them
- After each write/edit, let the lint hook run (if configured)
- If lint fails, fix before moving on

### Test strategy:

#### Baseline
- At the START of IMPLEMENT (before any code changes), run the full test suite as a baseline run
- Record all failures as the baseline — these are pre-existing, not caused by this task
- Store baseline failure count and list in the progress file under `## Baseline Failures:`

#### TDD Approach
- For each plan step involving testable behavior: write tests first, then implement
- TDD cycle: Red (write failing test) → Green (make it pass) → Refactor (clean up)
- Skip TDD only when impractical (config-only changes, pure documentation, refactoring with full existing coverage)

#### Background Execution for Large Suites
- If the test suite has >4 test files or is expected to take >30 seconds, run tests in background
- The orchestrator may proceed to the next plan step while background tests run
- Background results MUST be checked before starting any dependent step and always before end-of-phase escalation

#### Failure Handling After Each Step
- Run tests after each step that modifies logic (not after docs/config changes)
- Compare results against baseline to classify every failure:
  - NEW_REGRESSION: Test passed in baseline, fails now. Fix immediately — up to 2 attempts, then escalate.
  - PRE_EXISTING (related to task): Test failed in baseline, but in code touched by this task. Own it and fix it.
  - PRE_EXISTING (unrelated): Test failed in baseline, unrelated to current task. Carry forward for escalation.
  - FLAKY: Inconsistent across runs. Re-run once to confirm. Flag for user.
  - DEPRECATED: References obsolete or renamed APIs. Flag for user.
  - DUPLICATE: Duplicates another passing test's coverage. Flag for user.

#### Ownership policy:
- Own all non-lint failures in code you are touching
- Pre-existing lint in untouched files: Ignore
- Pre-existing lint in touched files: Fix only if the lint hook flags it
- Pre-existing test failures in touched code: Fix them
- Pre-existing bugs discovered while working: Flag; fix if trivial (< 5 lines), document otherwise

#### End-of-Phase Escalation
- After all plan steps, compile unresolved failure report
- Present via `AskUserQuestion` before entering VALIDATE
- Never enter VALIDATE with silent, unclassified, or unacknowledged failures

### Progress tracking:
- Update the progress file after EACH step, not just at phase boundaries
- Include what was done and any issues encountered
- This enables precise session recovery

## VALIDATE Sub-Phase — Deep Dive

The VALIDATE sub-phase runs at the end of IMPLEMENT, after all plan steps and test escalation, but before REVIEW. Its purpose is to prove the change actually works beyond unit tests — the right validation depends on the task.

### Why validation lives in IMPLEMENT, not REVIEW

- IMPLEMENT is where you have full edit access and context — if validation fails, you fix immediately
- Reviewers receive validation evidence, strengthening their analysis
- REVIEW stays read-only analysis (its proper role)

### Validation type selection

The architect defines a Validation Strategy during PLAN. The orchestrator executes it here.

| Task Type | Validation Examples |
|-----------|-------------------|
| LLM integration | Make a test LLM call, verify response structure and token counts |
| Tracing/observability | Push a dummy trace to the tracing backend, query it back to verify propagation |
| Docker/build | Build the Docker image, verify it starts and health endpoint responds |
| API changes | Curl the endpoint (local or staging), verify request/response contract |
| Config/env changes | Load the config in a test harness, verify values are resolved |
| Database/migration | Run migration on test DB, verify schema state |
| CLI tools | Run the command with test args, verify stdout/stderr/exit code |
| Pure refactor | Run the full test suite, diff behavior before/after (no functional change) |
| Infrastructure | Verify deployment manifests parse correctly (helm template, oc process) |
| Security/auth | Verify auth flow end-to-end with test credentials |

### Validation protocol

1. Read the Validation Strategy from the approved plan in the progress file
2. Check prerequisites: Does validation need Docker, staging access, API keys, etc.? If unavailable, note it and ask the user whether to skip or provide access.
3. Execute validation: Run the appropriate commands/scripts. Use the `test-runner` agent for execution.
4. Record results in the progress file under `## Validation Results:`:
   ```
   ## Validation Results:
   - Type: <validation type>
   - Command: <what was run>
   - Result: PASS / FAIL
   - Evidence: <output summary, response codes, trace IDs, etc.>
   ```
5. If PASS: Proceed to REVIEW, passing validation evidence to all reviewers.
6. If FAIL: Fix within IMPLEMENT (you still have full edit access). Max 2 fix-validate cycles. If still failing, escalate to user via `AskUserQuestion` with the failure details and ask: Continue to REVIEW anyway, Fix manually, or Abort.
7. If skipped (prerequisites unavailable): Note in the progress file and inform reviewers that validation was skipped with reason.

### Secrets safety during validation

When validation involves `.env` files, API keys, or credentials:
- Never log raw secret values in the progress file or to the console
- Use `***` masking for values: `API_KEY=***`, `DB_PASSWORD=***`
- If a validation command outputs secrets in its response, redact before recording

## REVIEW Phase — Deep Dive

The REVIEW phase uses three parallel reviewers with separated concerns, cost-optimized model routing, a co-founder filter for adversarial findings, and a unified question resolution table that verifies all questions from all phases.

### Quality Reviewer
Focuses exclusively on code quality — correctness, security, performance, maintainability, and engineering best practices. Does NOT check plan compliance.
- Tier: balanced for low-risk/small diffs; strong tier for high-risk or large diffs (100+ lines) or security/auth code

### Compliance Reviewer
Focuses exclusively on plan compliance — verifies every plan step was implemented, all promised features exist, risk mitigations are coded, and tests match the test strategy. Does NOT assess code quality.
- Tier: always balanced

### Adversarial Developer Reviewer
A hostile reviewer that checks: (1) which questions are actually answered by the code, (2) which architect assumptions are broken by the implementation, (3) what blast radius the developer missed. Also generates edge cases and (in PROJECT mode) checks bug patterns.
- Tier: balanced by default; strong tier for security-sensitive changes

### Why three reviewers?
Each reviewer has a distinct, non-overlapping mandate:
- Quality: "Is this code correct, performant, and maintainable?"
- Compliance: "Does this match what was planned?"
- Adversarial: "Are the questions answered? Are the assumptions correct? What was missed?"

### Co-Founder Filter (post-adversarial triage)

After all three reviewers return, the orchestrator applies a co-founder filter to the adversarial reviewer's findings.

#### Why a filter is necessary:
Adversarial reviewers are deliberately aggressive. Some findings will be false positives, pedantic, context-blind, or scope-inappropriate. The co-founder filter applies distinguished judgment.

#### Filter protocol:
1. Load adversarial findings
2. For each finding, evaluate:
   - Is this real? Verify with a fresh code read.
   - Is this worth fixing now? Even if real, does it serve the current task?
3. Classify each finding:
   - ACCEPTED: Valid, evidenced, worth addressing. Add to merged findings.
   - ACCEPTED_DEFERRED: Valid but out of scope. Log as follow-up.
   - DECLINED: False positive or pedantic. Explain WHY.
   - CHALLENGED: Valid point but wrong solution. Counter-propose.
4. Output the filter table (transparency):

```
## Co-Founder Filter: Adversarial Findings Triage
| # | Finding | Adversarial Verdict | Co-Founder Decision | Reasoning |
|---|---------|--------------------|--------------------|-----------|
| 1 | VQ2 unanswered: endpoint_v2 not updated | DESTROYED | ACCEPTED | Confirmed: endpoint_v2.py:120 still uses old field name |
| 2 | Edge case: empty list crashes | BRUISED | ACCEPTED | Traced: endpoint.py:120 raises TypeError on [] |
| 3 | Assumption drift: auth middleware changed | BRUISED | DECLINED | Auth change is unrelated to this task; pre-existing |
```

#### Blocking rules:
- ACCEPTED with critical/high severity → overall verdict FAIL
- ACCEPTED with medium → PASS_WITH_NOTES
- ACCEPTED_DEFERRED → never blocking, presented as follow-up
- DECLINED/CHALLENGED → visible to user, not counted toward verdict

### Question Resolution Table (unified verification gate)

This is the core verification mechanism. Build a unified table for ALL questions from ALL phases.

#### Protocol:
1. Compile all questions: Design (ANALYZE) + Verification (ANALYZE) + evolved (PLAN, IMPLEMENT)
2. For each question, perform a fresh verification — re-read code at file:line. Do NOT trust earlier reads.
3. Repo-wide search: For cross-cutting questions, run `Grep` with the same keyword variants used during ANALYZE. Compare current results against ANALYZE-phase results — any new or unaddressed occurrences are a finding.
4. Cross-reference with adversarial reviewer: The adversarial reviewer's Unanswered Questions audit provides an independent check. If the adversarial reviewer found a question UNANSWERED that you think is RESOLVED, investigate the discrepancy.
5. Classify each question:
   - RESOLVED: Code fully addresses the concern. Cite file:line and what was verified.
   - PARTIALLY_RESOLVED: Some aspects addressed, others remain. List what is done and what is not.
   - UNRESOLVED: Not addressed by the changes. Explain what is missing.
6. Blocking rule: Any UNRESOLVED or PARTIALLY_RESOLVED question → overall verdict FAIL.

#### Output format:
```
## Question Resolution
| # | Question | Type | Phase Added | Status | Evidence |
|---|----------|------|-------------|--------|----------|
| DQ1 | What are the output assembly paths? | design | analyze | RESOLVED | All 4 paths updated: workflow_manager.py:340, parallel_processor.py:180, dependent_processor.py:220, utils.py:45 |
| VQ1 | Do all assembly paths populate the new field? | verification | analyze | RESOLVED | grep confirms field present in all 4 files |
| VQ3 | Does endpoint_v2 need updating? | verification | implement-phase | UNRESOLVED | endpoint_v2.py:120 still uses old field — needs fix |
```

### Cases Matrix Verification (post-review gate)

After Question Resolution, verify the Cases Matrix from the PLAN phase.

#### Protocol:
1. Load Cases Matrix from the progress file
2. For each case, perform a fresh verification — read implementation code and tests
3. Classify each case:
   - VERIFIED: Code handles this AND a test covers it. Cite file:line for both.
   - IMPLEMENTED_UNTESTED: Code handles it but no test. Flag.
   - UNVERIFIED: Cannot confirm. Explain what is missing.
4. Blocking rule: Any UNVERIFIED case on a MED/HIGH step → FAIL.

#### Output format:
```
## Cases Matrix Verification
| Case | Scenario | Status | Implementation Evidence | Test Evidence |
|------|----------|--------|------------------------|---------------|
| H1 | Normal patch generation | VERIFIED | workflow_manager.py:340 | test_workflow.py:55 |
| S1 | Missing CL metadata | IMPLEMENTED_UNTESTED | endpoint.py:120 handles KeyError | No test — edge case caught by upstream validation |
| E1 | Empty patch list | UNVERIFIED | No handling found | — |
```

### Merged verdict logic:
- PASS: Quality PASS/PASS_WITH_NOTES AND Compliance COMPLIANT/PARTIAL AND all questions RESOLVED AND no UNVERIFIED MED/HIGH cases AND no ACCEPTED adversarial findings with critical/high severity
- FAIL: Quality FAIL OR Compliance NON_COMPLIANT OR any question UNRESOLVED/PARTIALLY_RESOLVED OR any MED/HIGH case UNVERIFIED OR any ACCEPTED adversarial finding with critical/high severity

### Engineering perspectives (for quality reviewer):

#### Senior engineer:
- Does the code work correctly?
- Are error cases handled?
- Is the code readable and maintainable?
- Do tests cover the important paths?
- Are failure paths tested?
- Are tests deterministic?

#### Distinguished engineer:
- Does this fit the overall architecture?
- Performance implications at scale?
- API design consistency?
- Security implications?
- Simplest solution that works?
- Time/space complexity at 10x/100x data?
- Concurrency/thread safety?
- Unbounded growth patterns?

#### Principal engineer:
- Root problem or symptom?
- Hidden assumptions?
- Correct data model?
- Coupling vs cohesion?
- Separation of concerns?
- YAGNI?
- Principle of least surprise?

### Review outcome handling:
- PASS: Proceed to commit
- PASS_WITH_NOTES: Proceed but log the notes
- FAIL: Fix all critical/high issues, then re-review

## COMMIT Phase — Deep Dive

> This is a HARD GATE. You must use `AskUserQuestion` and stop until the user approves the commit.

### Conventional commit format:
```
<type>(<optional scope>): <subject>

<optional body>

<optional footer>
```

### Type selection:
- `feat`: New feature or functionality
- `fix`: Bug fix
- `refactor`: Code restructuring without behavior change
- `docs`: Documentation only
- `chore`: Build, tooling, dependencies
- `test`: Adding or fixing tests

### How to get commit approval:
- Show `git diff --stat` output and the proposed commit message
- Use the `AskUserQuestion` tool with options: Commit, Edit message, Abort
- Do NOT run `git commit` until the user explicitly approves

### Commit message rules:
- Never add AI authorship metadata.

### Staging rules:
- Stage only files that were changed as part of this task
- Never stage `.env`, credentials, or secret files
- If unsure about a file, ask the user
- Prefer `git add <specific files>` over `git add -A`
