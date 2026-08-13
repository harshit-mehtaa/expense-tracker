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
| `pi` | `qwen3.5:9b` | `qwen3.5:9b` | `qwen3.5:9b` |
| `codex` | `gpt-5.4-mini` | `gpt-5.4` | `gpt-5.5` |
| `cursor` | `cursor-small` | `cursor-medium` | `cursor-large` |

The IDs must match entries in `~/.pi/agent/models.json` (start from
`.pi/models.example.json`); `ollama list` shows what is pulled. Nothing else needs to
change when you swap a model: the skills only ever ask for a tier, and
`.claude/bin/aco-agent` reads this table.

### Why all three `pi` tiers point at one model

Sized for the target machine: a laptop RTX 5070 Ti, **12 GB VRAM**, already running
`qwen3.5:9b`.

| Model (q4_K_M) | Weights | Native context | Verdict |
|---|---|---|---|
| **`qwen3.5:9b`** | **6.6 GB** | **256K** | chosen — ~5 GB headroom on a 12 GB card |
| `qwen3.5:4b` | 3.4 GB | 256K | fallback if 9b is too slow |
| `qwen3.5:27b` | 17 GB | 256K | too large |
| `qwen2.5-coder:14b` | 9.0 GB | 32K | superseded: bigger *and* 8× less context |

qwen3.5 uses a hybrid `8×(3×DeltaNet→FFN→1×Attention→FFN)` stack, so only one block in
four is full attention and the DeltaNet blocks carry a fixed-size recurrent state rather
than a growing KV cache. Long context therefore costs far less memory here than on a
conventional dense transformer, which is what makes 256K viable on a laptop GPU.

**The tiers share one model** because `aco-agent` spawns `pi -p` while the parent session
is still resident. Two different tier models means two sets of weights loaded at once —
a spill into system RAM, or a load/unload cycle on every sub-agent call. With one model
the weights stay hot across the whole pipeline.

`qwen3.5:4b` (3.4 GB) is small enough to sit alongside 9b within 12 GB if you ever want a
genuinely cheaper `fast` tier, but it leaves little room for context on both. Prefer a
per-run override:

```sh
ACO_MODEL_FAST=qwen3.5:4b .claude/bin/aco-agent fast - <<'PROMPT'
...
PROMPT
```

### Setup on the 12 GB machine

```sh
ollama pull qwen3.5:9b                 # 6.6 GB — all three tiers
export OLLAMA_MAX_LOADED_MODELS=1      # never hold two models at once
```

`OLLAMA_KV_CACHE_TYPE=q8_0` is optional here rather than required — it buys extra headroom
if you push context very high, at some quality cost.

**Set the context explicitly.** Ollama does not serve a model's native window by default;
it applies its own (small) default unless told otherwise, and pi talks to it over the
OpenAI-compatible API, which has no field for it. Bake it into a derived tag:

```sh
printf 'FROM qwen3.5:9b\nPARAMETER num_ctx 65536\n' > Modelfile
ollama create qwen3.5:9b-64k -f Modelfile
```

then set the `pi` row above to `qwen3.5:9b-64k`. 64k is a deliberate starting point, not a
limit — the model goes to 256K, but VRAM is what constrains it. Raise it and watch
`ollama ps`: once the reported size approaches 12 GB you are about to spill into system
RAM, and throughput collapses when you do.

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

- **Context — no longer the binding constraint.** This section originally advised skipping
  the adversarial review because a short window would silently truncate the brief. With
  `qwen3.5:9b` at a 64k `num_ctx` (256K native) that no longer applies: the largest brief
  in the pipeline is `reviewer-adversarial.md` plus the diff, the questions and
  `bug-patterns.md`, which fits comfortably. Run the full REVIEW tier. Do still check that
  `num_ctx` was actually applied — if it silently fell back to Ollama's small default, a
  long brief gets truncated and the agent still answers confidently, which reads as a pass.
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

Suggested profile when `ACO_PLATFORM=pi` on the 12 GB machine: run the full pipeline
including `plan-challenger` and `reviewer-adversarial`, but treat their *findings* as
leads rather than conclusions — verify each against the code before acting, which the
Co-Founder Filter in the REVIEW phase already requires. For genuinely high-risk work
(auth, money handling, migrations), still take the adversarial pass on a frontier-model
machine before merging: the failure mode there is a missed finding, which is invisible.
