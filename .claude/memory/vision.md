# Project Vision

<!-- Cap: 100 lines. Updated by /initialize, /update-system, or manually. -->
<!-- Last updated: 2026-08-10 -->
<!-- DRAFT: sections below were inferred from the codebase. Review and correct — -->
<!-- items marked [?] are guesses that need your confirmation. -->

## Design Principles
- **Correctness over speed for money.** Every amount is a `Decimal`, never a float. A rounding
  bug here is a real financial error, not a cosmetic one.
- **Thin routes, fat services.** HTTP concerns stay at the boundary; business logic is testable
  without an HTTP layer.
- **Test what can break.** Backend holds a hard 100% coverage line — the codebase treats
  untested branches as unshipped.
- **Self-hosted and private.** Family financial data never leaves the home server. [?]
- **India-first, not India-configurable.** FY dates, tax slabs, and number formatting are
  encoded directly rather than abstracted behind a locale layer. [?]

## Architectural Invariants
- No Prisma calls in route handlers — DB access goes through a service.
- No raw SQL; all persistence via `@prisma/client`.
- Every currency field is `Decimal(15,2)`; rates/NAV `Decimal(15,4)`. Never `number`.
- Every error thrown is an `AppError`; routes never construct error responses directly.
- Every async route handler is wrapped in `asyncHandler()`.
- Financial records are soft-deleted (`deletedAt`), never hard-deleted — audit trail is permanent.
- Request/response DTOs live in `shared/types/` so frontend and backend cannot drift.
- Statement imports are idempotent via `importHash`.
- Member-scoped data must be filtered by role: MEMBER sees only their own rows, ADMIN sees all.

## Tech Debt Inventory
- [medium] **No CI quality gate.** `.github/workflows/docker-publish.yml` builds and pushes
  images but runs no tests, type check, or lint. A red build ships. Coverage/lint are local-only.
- [high] **Linting is entirely non-functional.** `frontend/package.json` has a `lint` script and
  the ESLint 8.57 toolchain installed, but there is no config file anywhere — the script fails
  on invocation, so it has never linted anything. The backend has no lint setup at all. Net
  effect: `tsc --strict` is the only static analysis running on this codebase.
  Fix = add `frontend/.eslintrc.cjs` (the installed plugins imply the intended config).
- [low] **No formatter.** No Prettier config anywhere — formatting is convention-only, which
  makes diffs noisier than they need to be.
- [low] **Large service files.** `transactionService.ts` (~46KB), `dashboardService.ts` (~34KB),
  and `investmentService.unit.test.ts` (~57KB) are approaching the point where they're hard to
  navigate. Not urgent; worth splitting when a feature next touches them.
- Note: zero TODO/FIXME/HACK/XXX markers across `backend/src` and `frontend/src`.

## What We Will NOT Do
<!-- Placeholder — please fill in. Explicit anti-goals prevent scope creep and give the -->
<!-- orchestrator grounds to push back on a task. Candidates based on the code: -->
- [?] No multi-tenancy — this is one family's deployment, not a SaaS.
- [?] No live brokerage/bank API integration — statement import is the ingestion path.
- [?] No mobile app — responsive web only.

## Quality Thresholds
- Backend test coverage: **100%** statements/branches/functions/lines
  (enforced, `backend/vitest.config.ts`; excludes `src/index.ts`, `src/config/prisma.ts`)
- Frontend lint: **0 warnings** (`eslint --max-warnings 0`)
- TypeScript: `strict: true` both packages; frontend also `noUnusedLocals` +
  `noUnusedParameters` + `noFallthroughCasesInSwitch`
- Frontend test coverage: collected, no threshold enforced [?] — set one?
