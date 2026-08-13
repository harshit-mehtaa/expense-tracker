---
name: docs
description: Generate Diataxis-compliant documentation for a file, module, or feature using a multi-agent pipeline.
---

# /docs - Documentation Pipeline

Generate high-quality documentation using the Diataxis framework, Google style guide, and multi-agent generation.

## Usage
```
/docs <target>                    # Auto-classify and generate docs for a file, module, or feature
/docs <target> tutorial           # Generate a tutorial
/docs <target> how-to             # Generate a how-to guide
/docs <target> reference          # Generate a reference page
/docs <target> explanation        # Generate an explanation page
```

## Instructions

You are the documentation orchestrator. Follow this pipeline exactly. Never skip phases.

### Phase Banner (Output at Every Phase Transition)

At the start of **every phase**, output a visible banner:
```
========================================
  DOCS — PHASE <N>/5: <PHASE_NAME>
  [<progress_bar>]  <percent>%
  <one-line description>
========================================
```

**Phase mapping:**

| Step | Phase Name | Progress Bar | % | Description |
|------|-----------|-------------|---|-------------|
| 1 | CLASSIFY | `[=====-------------------]` | 20% | Determining documentation type... |
| 2 | ANALYZE | `[===========--------------]` | 40% | Exploring code to understand the target... |
| 3 | GENERATE | `[===============---------]` | 60% | Writing documentation... |
| 4 | VERIFY | `[====================----]` | 80% | Reviewing for style and accuracy... |
| 5 | APPROVE | `[========================]` | 100% | Presenting docs for your approval... |

**Completion banner:**
```
========================================
  DOCS COMPLETE
  [========================]  100%
  Documentation written successfully.
========================================
```

### Step 0: Initialize

1. **Output a pipeline-start banner:**
   ```
   ========================================
     DOCS PIPELINE STARTED
     CLASSIFY → ANALYZE → GENERATE → VERIFY → APPROVE
     Target: <target>
   ========================================
   ```
2. Parse arguments:
   - `$ARGUMENTS` contains the target and optional type
   - First argument: the target (file path, module name, or feature description)
   - Second argument (optional): one of `tutorial`, `how-to`, `reference`, `explanation`
   - If second argument is provided but not one of the four valid types, output an error and stop:
     ```
     Error: Invalid doc type "<type>". Valid types: tutorial, how-to, reference, explanation
     ```
3. Read `.claude/memory/architecture.md` and `.claude/memory/patterns.md` for context
4. **Determine output path early.** Propose a sensible default based on the target:
   - If a `docs/` directory exists in the project root, propose `docs/<type>/<target-name>.md`
   - Otherwise, propose `<target-directory>/<target-name>.md` (alongside the source)
   - Tell the user the proposed path. They can override it in the APPROVE phase.

### Step 1: CLASSIFY

1. **Output the CLASSIFY phase banner** (Phase 1/5, 20%).
2. **If the user provided a type argument**, use it directly. Skip the classifier agent. Output:
   ```
   Doc type: <type> (user-specified)
   ```
3. **If no type was provided**, launch the `doc-classifier` agent (subagent_type: "general-purpose", **tier: fast**) with:
   ```
   You are a documentation type classifier. Read .claude/agents/doc-classifier.md for your full instructions.

   Target to document: "<target>"

   Read the target file(s) to understand their nature, then classify what type of
   documentation would be most valuable using the Diataxis framework.

   Consider:
   - Is this an API, library, or tool that needs a reference page?
   - Is there a common workflow or task that needs a how-to guide?
   - Is this a concept or architecture that needs an explanation?
   - Is this something a newcomer needs to learn step-by-step (tutorial)?

   Return your classification in the structured format specified in your agent definition.
   ```
4. Capture the classification result: the primary Diataxis type and rationale.

### Step 2: ANALYZE

1. **Output the ANALYZE phase banner** (Phase 2/5, 40%).
2. **Staleness check**: Apply the Architecture Staleness Protocol from `pipeline.md`. If the target is a file path explicitly described in `architecture.md`, skip the researcher — read the target file directly and pass its content to GENERATE. If the target is not in `architecture.md` or is a module/feature name requiring exploration, launch the researcher.
3. **If the researcher IS needed**, launch the `researcher` agent (subagent_type: "Explore", **tier: fast**) with:
   ```
   Explore the codebase to gather documentation context for this target:
   "<target>"

   This will be used to generate a <doc_type> document.

   Focus on:
   - The target's public interface: exported functions, types, classes, constants
   - Parameters, return values, error conditions for each public symbol
   - Dependencies: what this target imports and depends on
   - Usage examples: how the target is used elsewhere in the codebase (grep for imports/calls)
   - Configuration: any config files, environment variables, or setup required
   - For reference docs: enumerate ALL public symbols exhaustively
   - For how-to docs: identify common tasks and workflows involving the target
   - For tutorials: identify prerequisite knowledge and a logical learning path
   - For explanations: identify architectural decisions, trade-offs, and design rationale

   Return a structured analysis with all findings.
   ```
4. **Always read the target file(s) directly** — even if the researcher was launched, read the source to have the raw code available for the doc-writer.
5. If the researcher reveals architecture not captured in `architecture.md`, update it (respect 150-line cap).

### Step 3: GENERATE

1. **Output the GENERATE phase banner** (Phase 3/5, 60%).
2. Launch the `doc-writer` agent (subagent_type: "general-purpose", **tier: balanced**) with:
   ```
   You are a documentation writer. Read .claude/agents/doc-writer.md for your full instructions.

   Task: Generate a <doc_type> document for:
   "<target>"

   Source code of the target:
   <paste the raw source code of the target file(s)>

   Code analysis:
   <paste researcher results or direct file analysis>

   Existing architecture context:
   <paste relevant sections from architecture.md>

   Doc type: <doc_type>
   Output path: <proposed_path>

   Follow the embedded template for this doc type exactly.
   Generate the complete documentation as markdown.
   Read the source code carefully — every public symbol must be documented for reference docs,
   every step must be verified for tutorials and how-tos.
   ```
3. Capture the generated documentation text. Do NOT write it to disk yet.

### Step 4: VERIFY

1. **Output the VERIFY phase banner** (Phase 4/5, 80%).
2. Launch the `doc-reviewer` agent (subagent_type: "general-purpose", **tier: balanced**) with:
   ```
   You are a documentation reviewer. Read .claude/agents/doc-reviewer.md for your full instructions.

   Review this generated documentation:

   Doc type: <doc_type>
   Target: <target>

   Generated documentation:
   <paste the generated documentation>

   Source code of the target (for accuracy verification):
   <paste the raw source code>

   Apply all review criteria from your agent definition.
   Return your structured review.
   ```
3. **Handle review results:**
   - If verdict is **PASS** or **PASS_WITH_NOTES**: proceed to APPROVE. Include any notes in the APPROVE presentation.
   - If verdict is **FAIL** with critical/high issues: attempt one revision loop.
     - Send the reviewer's findings back to the doc-writer with a revision prompt:
       ```
       Revise the documentation to address these issues:
       <paste critical and high findings>

       Original documentation:
       <paste original>

       Return the revised documentation.
       ```
     - Re-run the doc-reviewer on the revised output.
     - If still FAIL after one retry, proceed to APPROVE with unresolved issues flagged prominently. The user decides whether to accept, edit, or abort.

### Step 5: APPROVE

> **⛔ HARD GATE — You MUST stop here and wait for user input before writing the file.**

1. **Output the APPROVE phase banner** (Phase 5/5, 100%).
2. Present to the user:
   - The doc type and classification rationale
   - The proposed output path
   - The generated documentation (full text)
   - Review verdict and any notes/unresolved issues
   - Word count and section count
3. **Use the `AskUserQuestion` tool** to ask the user:
   - **Write** — write the documentation to the proposed path
   - **Edit** — user wants to modify the content or path (ask what to change, revise, re-present)
   - **Abort** — discard the generated documentation
4. **DO NOT write the file until the user explicitly approves via `AskUserQuestion`.**
5. Based on the user's response:
   - If **Write**: write the file to the approved path. Output the completion banner.
   - If **Edit**: ask what to change, apply edits (re-run doc-writer if substantial, or edit directly if minor), then re-present and re-ask.
   - If **Abort**: inform the user that no files were written and stop.

### Error Handling

- If the target file does not exist, inform the user and stop gracefully
- If the classifier cannot determine a type, ask the user to specify one
- If the doc-writer produces empty output, retry once then escalate to the user
- Never leave the user without feedback — always output what went wrong and suggest next steps
