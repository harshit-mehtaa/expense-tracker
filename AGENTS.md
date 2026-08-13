# Project Instructions

Self-hosted family finance manager for Indian households — TypeScript throughout:
Express + Prisma + PostgreSQL on the backend, React + Vite on the frontend, all run via
Docker Compose. See `README.md` for setup and `.claude/memory/architecture.md` for the
codebase map.

This file is the entry point for harnesses that read `AGENTS.md` (pi and others). Claude
Code reads `.claude/CLAUDE.md`; pi discovers both `AGENTS.md` and `CLAUDE.md`. The
orchestrator rules below apply regardless of which one you are.

## The orchestrator

This project carries an AI coding orchestrator in `.claude/`, tracked in git so it travels
between machines. Read these before starting work:

- `.claude/CLAUDE.md` — orchestrator overview and the technical-cofounder mindset
- `.claude/rules/orchestrator.md` — behavioural rules (35 of them; they are not optional)
- `.claude/memory/architecture.md` — tech stack, layout, build and test commands
- `.claude/memory/patterns.md` — naming, error handling, API contract, testing conventions
- `.claude/memory/progress.md` — current task state and the standing backlog
- `.claude/memory/cost-routing.md` — which model each tier maps to **on this machine**

`.claude/skills/*/SKILL.md` are the pipelines (`task`, `plan`, `review`, `docs`, `design`).
`.claude/agents/*.md` are the sub-agent briefs.

## Running the pipeline without a sub-agent tool

The pipeline delegates to independent sub-agents. Claude Code has a Task tool for this;
pi does not, so use the shim, which resolves the tier to a model and runs a one-shot pi:

```sh
.claude/bin/aco-agent balanced - <<'PROMPT'
You are an adversarial plan reviewer. Read .claude/agents/plan-challenger.md for your
full instructions.
...
PROMPT
```

It runs `pi -p --no-session --no-context-files --model <model>` under the hood and prints
the sub-agent's reply to stdout. Tiers are `fast`, `balanced`, `strong`; the mapping lives
in `.claude/memory/cost-routing.md`.

**Never name a model in a skill or agent file.** Ask for a tier. A hardcoded model name
breaks the pipeline on every machine that does not run that model.

## Non-negotiables for this codebase

- **Money is `Decimal`, never a float.** `Decimal(15,2)` for INR, `Decimal(15,4)` for
  rates and NAV. A rounding bug here is a real financial error.
- **No Prisma calls in route handlers.** Routes are thin; business logic lives in
  `backend/src/services/`. No raw SQL.
- **Errors are `AppError`** (`backend/src/utils/AppError.ts`), thrown from services and
  formatted by the error middleware. Routes never build error payloads.
- **Async route handlers are wrapped in `asyncHandler()`.**
- **Financial records are soft-deleted** (`deletedAt`), never hard-deleted. Queries must
  filter it out.
- **Shared DTOs live in `shared/types/`** so frontend and backend cannot drift.
- **Indian financial year** is Apr 1 – Mar 31 across all tax and reporting logic.
- **Statement imports are idempotent** via `importHash`.

## Verification

Run these before claiming a change works — CI runs the same set:

```sh
cd backend  && npx tsc --noEmit && npm run test      # 1226 tests
cd frontend && npm run lint && npx tsc --noEmit && npm run test
```

`make start` brings the stack up at http://localhost:8080; `make restart` recreates it.

Two lessons this project learned the hard way:

- **Unit tests do not render React components.** A conditional hook shipped past `tsc` and
  a green suite and would have crashed a page. `react-hooks/rules-of-hooks` caught it —
  frontend lint is load-bearing, not cosmetic.
- **Backend coverage is ~93%, not the 100% `vitest.config.ts` asks for.**
  `routes/documents.ts`, `routes/categoryRules.ts` and `services/categoryRuleService.ts`
  are at 0%. CI gates on `npm run test`, not `test:coverage`, until that is backfilled.
