---
name: design
description: Generate technical architecture documents (C4, Arc42, ADR, RFC) from an idea, spec, or existing code.
---

# /design - Technical Architecture Pipeline

Generate technical architecture documents from an initial idea, PRD/spec, or existing code. Grounded in C4 Model, Arc42, ADR, and RFC/Design Doc frameworks.

## Usage
```
/design <idea or description>                    # Generate architecture from an idea
/design <file-path>                              # Generate extension architecture for existing code
/design <idea> --pointers file1.ts,file2.ts      # Idea with reference files
```

## Instructions

You are the architecture design orchestrator. Follow this pipeline exactly. Never skip phases.

### Phase Banner (Output at Every Phase Transition)

At the start of **every phase**, output a visible banner:
```
========================================
  DESIGN — PHASE <N>/5: <PHASE_NAME>
  [<progress_bar>]  <percent>%
  <one-line description>
========================================
```

**Phase mapping:**

| Step | Phase Name | Progress Bar | % | Description |
|------|-----------|-------------|---|-------------|
| 1 | UNDERSTAND | `[=====-------------------]` | 20% | Parsing input and detecting mode... |
| 2 | RESEARCH | `[===========--------------]` | 40% | Gathering context and constraints... |
| 3 | DESIGN | `[===============---------]` | 60% | Generating architecture document... |
| 4 | CRITIQUE | `[====================----]` | 80% | Adversarial review of the design... |
| 5 | APPROVE | `[========================]` | 100% | Presenting design for your approval... |

**Completion banner:**
```
========================================
  DESIGN COMPLETE
  [========================]  100%
  Architecture document written successfully.
========================================
```

### Step 0: Initialize

1. **Output a pipeline-start banner:**
   ```
   ========================================
     DESIGN PIPELINE STARTED
     UNDERSTAND → RESEARCH → DESIGN → CRITIQUE → APPROVE
     Input: <first 80 chars of arguments>
   ========================================
   ```
2. Read `.claude/memory/architecture.md` and `.claude/memory/patterns.md` for context.
3. Read `.claude/memory/vision.md` for architectural invariants to respect.

### Step 1: UNDERSTAND

1. **Output the UNDERSTAND phase banner** (Phase 1/5, 20%).

2. **Detect input mode** by analyzing `$ARGUMENTS`:
   - **Extend mode**: The argument is a file path that exists on disk. The user wants to design an extension to existing code.
   - **PRD/spec mode**: The argument contains structured sections (e.g., "Goals:", "Requirements:", "User stories:", "Acceptance criteria:") suggesting a formal spec.
   - **Idea mode** (default): A natural language description of what to build, possibly with `--pointers` referencing existing files for context.

3. **Disambiguate file paths**: If the first token of `$ARGUMENTS` looks like a path (contains `/` or `.`), verify it exists on disk using the Read tool. If it does not exist, treat as idea mode regardless of path-like format. Note: `--pointers` must follow the idea text, not appear alone.

4. **Extract structured context** based on detected mode:

   **Idea mode:**
   - Goals: what the user wants to achieve (extract from description)
   - Constraints: any mentioned technology, scale, or compatibility requirements
   - Pointers: if `--pointers` was provided, read those files and summarize their relevance
   - Scope gaps: what is NOT mentioned but likely matters (flag for DESIGN phase)

   **PRD/spec mode:**
   - Goals: extract from spec
   - Non-Goals: extract if present; if absent, flag as "missing — will be generated in DESIGN"
   - Requirements: functional and non-functional
   - Constraints: technical, organizational, timeline
   - Success criteria: how "done" is defined

   **Extend mode:**
   - Read the target file(s) directly
   - Extract: current architecture, public interface, dependencies, integration points
   - Extension goal: what the user wants to add/change (from the description portion of the argument)

5. **Confirm mode AND extracted context with the user.** Use `AskUserQuestion`:
   ```
   Detected input mode: <mode>
   Rationale: <why this mode was detected>

   Extracted context:
   - Goals: <extracted goals>
   - Constraints: <extracted constraints>
   - Scope gaps: <what is missing from the input>
   ```
   Options: Correct / Switch to [other modes]
   The user must see and verify the extraction before proceeding.

6. **Determine output path** (after mode is confirmed):
   - **Idea/PRD mode**: If a `docs/` directory exists, propose `docs/architecture/<slug>.md`. Otherwise, propose `architecture-<slug>.md` in the project root.
   - **Extend mode**: Propose `<target-directory>/ARCHITECTURE.md` alongside the source.
   - Slugify the target name: lowercase, hyphens, no spaces or special characters.
   - Tell the user the proposed path. They can override in APPROVE.

### Step 2: RESEARCH

1. **Output the RESEARCH phase banner** (Phase 2/5, 40%).

2. **Route by mode:**

   **Idea mode:**
   - Do NOT launch the researcher. There is no existing code to explore for a greenfield idea.
   - If `--pointers` files were provided, read them and extract relevant patterns, interfaces, and constraints.
   - If `.claude/memory/architecture.md` describes relevant existing systems the idea must integrate with, include that context.
   - If no pointer files and no relevant architecture.md context exist, explicitly note in the context summary: "Greenfield design — no existing codebase context. All technology choices are speculative and must be flagged as ADRs."
   - Output: structured context summary for the design-writer.

   **PRD/spec mode:**
   - Do NOT launch the researcher unless the spec references existing code modules.
   - Parse the spec for technology choices, scale requirements, and integration points.
   - If the spec references existing systems described in `architecture.md`, include that context.
   - Output: structured context summary.

   **Extend mode:**
   - Launch the `researcher` agent (subagent_type: "Explore", **tier: fast**) with:
     ```
     Explore the codebase to understand the architecture around this target:
     "<target file path>"

     The user wants to extend this with: "<extension goal>"

     Focus on:
     - Current architecture of the target module
     - Public interfaces and contracts
     - Dependencies (what it imports, what depends on it)
     - Integration points where the extension would connect
     - Test infrastructure for this area
     - Any architectural constraints or patterns that the extension must follow

     Return a structured analysis.
     ```
   - Also read the target file(s) directly for raw source context.
   - Output: structured context summary including both researcher findings and raw source.

3. **Check vision.md invariants**: If `.claude/memory/vision.md` defines architectural invariants, list any that are relevant to this design. These must be respected in the DESIGN phase.

### Step 3: DESIGN

1. **Output the DESIGN phase banner** (Phase 3/5, 60%).

2. Launch the `design-writer` agent (subagent_type: "general-purpose", **tier: balanced**) with:
   ```
   You are a technical architecture designer. Read .claude/agents/design-writer.md for your full instructions.

   Input mode: <mode>
   Target: <idea description / spec summary / file path>

   Structured context from UNDERSTAND phase:
   <paste goals, constraints, scope gaps, non-goals>

   Research context:
   <paste pointer analysis / spec parsing / researcher results>

   Architectural invariants from vision.md (must respect):
   <paste relevant invariants, or "none">

   Existing architecture context:
   <paste relevant sections from architecture.md>

   Output path: <proposed path>

   Use the <mode> template from your embedded templates.
   Generate the complete architecture document section by section.
   Every section must have substantive content — do not leave placeholders.

   CRITICAL requirements:
   - Non-Goals: at least 3 explicit scope exclusions with rationale
   - Alternatives Considered: at least 2 alternatives with honest rejection rationale AND one scenario where each alternative would have been the better choice
   - Risks & Open Questions: at least 3 risks with stated mitigation or acceptance, plus a pre-mortem ("18 months later, this failed because...")
   - C4 diagrams: use Mermaid flowchart syntax (flowchart TD) styled as C4 levels. Focus on L1 (System Context) and L2 (Container). Do NOT generate L4 (Code-level) diagrams.
   - ADRs: 1 per significant architectural choice (where a real alternative existed), maximum 7. Each ADR must include at least one negative consequence.
   ```

3. Capture the generated architecture document. Do NOT write to disk yet.

### Step 4: CRITIQUE

1. **Output the CRITIQUE phase banner** (Phase 4/5, 80%).

2. Launch the `design-critic` agent (subagent_type: "general-purpose", **tier: balanced**) with:
   ```
   You are an adversarial architecture reviewer. Read .claude/agents/design-critic.md for your full instructions.

   Review this generated architecture document:

   Input mode: <mode>
   Original input: <idea / spec summary / target>

   Generated architecture document:
   <paste the generated document>

   Research context (for accuracy verification):
   <paste research context>

   Architectural invariants (must be respected):
   <paste relevant invariants>

   Apply all review criteria from your agent definition.
   Return your structured review.
   ```

3. **Handle critique results:**

   - **SOUND**: Proceed to APPROVE.

   - **NEEDS_WORK**: Attempt one revision.
     - Send the critic's findings to the design-writer with a revision prompt:
       ```
       Revise the architecture document to address these findings:
       <paste critic's must_fix and should_fix findings>

       Original document:
       <paste original>

       Address all must_fix findings. Address should_fix where practical.
       Return the revised document.
       ```
     - Re-run the design-critic on the revised output.
     - If still NEEDS_WORK after one retry, proceed to APPROVE with unresolved findings flagged.

   - **RISKY**: Do NOT attempt auto-revision. Proceed directly to APPROVE with all findings prominently flagged and a warning banner:
     ```
     [WARNING] CRITIC VERDICT: RISKY
     The design has significant structural concerns.
     Review the findings carefully before accepting.
     ```

### Step 5: APPROVE

> **⛔ HARD GATE — You MUST stop here and wait for user input before writing the file.**

1. **Output the APPROVE phase banner** (Phase 5/5, 100%).

2. Present to the user:
   - Input mode and target summary
   - Proposed output path
   - The generated architecture document (full text)
   - Critique verdict and **full findings** (if NEEDS_WORK or RISKY, paste the complete must_fix and should_fix findings so the user sees exactly what the critic flagged)
   - Section count, ADR count, diagram count
   - Any vision.md invariants that were affected

3. **Use `AskUserQuestion`** to ask the user:
   - **Write** — write the architecture document to the proposed path
   - **Edit** — modify the content or path
   - **Abort** — discard the generated document

4. **DO NOT write the file until the user explicitly approves.**

5. Based on the user's response:
   - If **Write**: write the file. Output the completion banner.
   - If **Edit**: ask what to change. For substantial changes, re-run the design-writer with feedback. For minor changes, edit directly. Re-present and re-ask.
   - If **Abort**: inform the user no files were written. Stop.

### Error Handling

- If the target file does not exist in extend mode, inform the user and stop
- If mode detection is ambiguous, the UNDERSTAND phase asks the user (never guess silently)
- If the design-writer produces empty or truncated output, retry once then escalate
- If vision.md invariants are violated in the design, flag them prominently in APPROVE — the user must explicitly override
- Never leave the user without feedback — always output what went wrong and suggest next steps
