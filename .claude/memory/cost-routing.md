# Cost Routing — Tier to Model Mapping

<!-- Read by the pipeline skills to map tiers to concrete models. -->
<!-- Overrides the platform plugin's built-in defaults. -->
<!-- Updated: 2026-08-13 -->

Skills never name a model. They request a **tier** — `fast`, `balanced`, or `strong` —
and this file maps tiers to whatever the current machine actually runs. That is what
lets the same orchestrator drive Claude Code on one laptop and pi/Qwen on another.

## Selecting the active platform

Resolution order:

1. `ACO_PLATFORM` environment variable, if set. This wins outright and is the reliable
   way to name a harness whose env vars we cannot autodetect.
2. Otherwise `aco_detect_platform()` in `.claude/hooks/portable.sh` sniffs known vars.

On any machine where autodetection is not proven, set it explicitly in the shell profile:

```sh
export ACO_PLATFORM=pi
```

The value must match a **Platform** row below.

## Tier map

| Platform | `fast` | `balanced` | `strong` |
|---|---|---|---|
| `claude-code` | `haiku` | `opus` | `opus` (omit the param to inherit the session model) |
| `pi` | `qwen2.5-coder:7b` | `qwen2.5-coder:32b` | `qwen2.5-coder:32b` |
| `codex` | `gpt-5.4-mini` | `gpt-5.4` | `gpt-5.5` |
| `cursor` | `cursor-small` | `cursor-medium` | `cursor-large` |

**The `pi` model IDs above are examples.** Replace them with whatever that machine
actually serves — `ollama list` shows what is pulled, and the IDs must match entries in
`~/.pi/agent/models.json` (start from `.pi/models.example.json`). Nothing else needs to
change: the skills only ever ask for a tier, and `.claude/bin/aco-agent` reads this table.

If the machine can only run one model, point all three tiers at it and read the
degradation notes at the end of this file before running the full pipeline.

## Sub-agents on pi

pi has no sub-agent primitive — the docs suggest tmux, but its one-shot print mode is a
better fit. `.claude/bin/aco-agent` wraps it:

```sh
.claude/bin/aco-agent balanced - <<'PROMPT'
<the agent brief>
PROMPT
```

which resolves the tier against the table above and runs:

```sh
pi -p --no-session --no-context-files --model <model> "<prompt>"
```

`--no-session` keeps sub-agent turns out of the parent session history. `--no-context-files`
stops every sub-agent re-loading `AGENTS.md`/`CLAUDE.md`, which would duplicate the
orchestrator rules into each one and waste context a local model cannot spare — the brief
passed in is already complete.

Override a single run without editing this file: `ACO_MODEL_BALANCED=... aco-agent ...`.

**Status: untested.** The runner and `.pi/extensions/aco.ts` were written from pi's
documentation without a live install to verify against. Expect the first run on the pi
machine to need small corrections — most likely to event payload field names in the
extension. Both are written to fail silently rather than break the agent loop.

Tier meanings, so a substitution can be judged:

- `fast` — structured exploration, test execution, deterministic transforms. Follows a
  fixed output format; does not need to reason about trade-offs.
- `balanced` — planning, reviewing, adversarial reasoning. The default.
- `strong` — high-risk reasoning, security/auth code, large diffs.

## Constraint: Sonnet is disabled (claude-code only)

Sonnet 5 is unavailable on this account. **Never pass `model: "sonnet"`.** The
`balanced` tier therefore maps to `opus`, collapsing `balanced` and `strong` onto one
model. The tier distinction is retained so the mapping can be restored if Sonnet returns.
On `claude-code`, only `haiku` on the mechanical agents actually reduces cost.

This constraint is platform-scoped and does not apply to `pi`, `codex` or `cursor`.

## Running the pipeline on a smaller model

The agent definitions in `.claude/agents/` were written against a frontier model. A local
Qwen — especially a quantised 7B on modest hardware — has a shorter context window and
weaker long-instruction adherence. Expect degradation, and prefer a smaller pipeline over
a pipeline that silently truncates:

- **Context.** `reviewer-adversarial.md` is the largest agent definition, and the REVIEW
  phase additionally pastes the diff, every design/verification question, and
  `bug-patterns.md`. On a short-context model this overflows and the tail is dropped —
  which is worse than not running it, because the output still looks complete. Prefer
  Tier 1 review (quality only) unless the model has ≥64k usable context.
- **Structured output.** The pipeline depends on agents returning specific section
  headings and verdict tokens (`SOUND` / `NEEDS_WORK` / `RISKY`, `PASS` / `FAIL`). Smaller
  models drift from these. If verdict parsing misbehaves, that is the cause.
- **Fan-out.** Parallel agents multiply memory pressure on a single local server. Run
  reviewers sequentially rather than in parallel when serving from one GPU.
- **What degrades gracefully.** `researcher` and `test-runner` are `fast`-tier and
  mechanical; they are the safest agents to run on a small model.
- **What does not.** `plan-challenger` and `reviewer-adversarial` are the agents whose
  entire value is catching what the primary pass missed. A weak model here produces
  confident, empty findings — worse than skipping the agent, because it reads as a pass.

Suggested profile when `ACO_PLATFORM=pi` with a small local model: run ANALYZE, PLAN,
IMPLEMENT and a Tier 1 REVIEW; skip `plan-challenger` and `reviewer-adversarial`; do the
adversarial pass later on a frontier-model machine before merging.
