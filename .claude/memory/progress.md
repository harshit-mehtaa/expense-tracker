# Task Progress

## Status: idle
## Last Task: Make the orchestrator portable; add pi/Qwen support
## Last Completed: 2026-08-13
## Steps Completed: all
## Commits pushed to origin/main: b738193, dab4c40, aad140d, e6a7488, c8f1658

## pi harness — verified facts (from pi.dev docs, 2026-08-13)
- NO sub-agent primitive. Workaround: `pi -p --no-session --no-context-files
  --model <id> "<prompt>"` via .claude/bin/aco-agent. Better than the tmux the docs suggest.
- NO hook config. Extensions are TypeScript, auto-discovered from `.pi/extensions/*.ts`
  (project-local, travels in git) or `~/.pi/agent/extensions/`. Events used:
  session_start, tool_result, turn_end, agent_end. Full list also has tool_call,
  before_agent_start, session_shutdown, before_provider_request, model_select, etc.
- READS BOTH AGENTS.md AND CLAUDE.md (`--no-context-files` disables exactly those two).
  The pi.dev landing page claiming no CLAUDE.md support is wrong.
- Models: `~/.pi/agent/models.json` (NOT in-repo). Ollama via baseUrl
  http://localhost:11434/v1, api "openai-completions". Qwen thinking needs
  thinkingFormat "qwen-chat-template".
- Flags: -p/--print, --model, --provider, --thinking, --no-session,
  --no-context-files/-nc, --tools/-t, --exclude-tools/-xt, --no-builtin-tools/-nbt,
  --no-tools/-nt, --mode json|rpc.
- No documented session env vars -> ACO_PLATFORM override is the reliable detection path.
  The PI_* sniffing in portable.sh is a labelled guess behind that override.

## UNTESTED — first thing to check on the pi machine
.claude/bin/aco-agent and .pi/extensions/aco.ts were written from docs with no live pi.
Most likely break: event payload field names in aco.ts (file path / tool name extraction).
Debug by logging JSON.stringify(event) in the handler. Both fail silently by design.

## Key learning — validation gap that mattered
The member-avatar change passed `tsc`, 156 unit tests, and a grep of the served module,
yet contained a conditional `useMemo` (placed after `if (isLoading) return`) that would
have crashed the transactions page the moment loading finished. NONE of those checks
render the component, so none could catch it. `react-hooks/rules-of-hooks` caught it
within minutes of ESLint first having a config.
Lesson: for React changes, static hook rules are load-bearing; unit tests that never
mount the component prove very little about render-time correctness.
No headless browser is installed (no playwright/puppeteer), so visual confirmation
still depends on the user.

## CI gate (new, .github/workflows/docker-publish.yml)
`quality` job: backend tsc + tests, frontend lint + tsc + tests. All publish jobs now
`needs: [quality]`. Workflow also runs on pull_request, where publish jobs are skipped
via `if: github.event_name != 'pull_request'`. All 5 steps verified passing locally
before push, so the first CI run should be green.

## Backend coverage is NOT 100% (verified by running test:coverage)
Actual: 93.66% stmts / 89.41% branches / 96.91% funcs / 93.66% lines. 1226 tests pass.
Zero-coverage files, all added while untracked so never covered:
  routes/documents.ts (0%, 1-257), routes/categoryRules.ts (0%, 1-51),
  services/categoryRuleService.ts (0%, 1-95), services/auditService.ts (53%)
User's decision: keep the 100% target in vitest.config.ts, gate CI on `npm run test`
only. Switch the CI step to `test:coverage` once the gap is backfilled.

## ESLint config (new, frontend/.eslintrc.cjs)
no-explicit-any deferred OFF (180 sites, report/chart mapping).
react-refresh/only-export-components OFF (contexts export hooks by design).
react-hooks/rules-of-hooks ERROR, exhaustive-deps WARN — these are the value.
no-unused-vars honours the `^_` prefix convention.
Backend still has NO lint config at all.

## Remaining backlog (verified, unfixed)
- [medium] FamilyMembers.tsx:164 `user.name[0]` throws on empty name; admin.ts:54 PUT
  has `name: z.string().optional()` with no .min(1) (POST at :35 has it). Reachable.
- [medium] backend/.dockerignore absent -> Dockerfile:14 `COPY . .` copies the host's
  346MB node_modules (incl. libquery_engine-darwin-arm64.dylib.node) into the Linux image.
- [medium] admin.ts:40,59 colorTag unvalidated (guarded in UI only).
- [medium] Five different colorTag-less fallback colours: Header.tsx:143 '#7c3aed',
  FamilyMembers.tsx:162 '#666', dashboardService.ts:665 '#6366f1', lib/memberAvatar.ts.
- [medium] Backfill tests for the 4 zero/low-coverage files to restore real 100%.
- [low] `make build` overdue — dev image dated 2026-05-02 07:51, stale in src/ and prisma/.
- [low] vision.md "What We Will NOT Do" still holds my guesses, not the user's intent.
- [note] Docker Desktop had quit; `open -a Docker` restarts it.
