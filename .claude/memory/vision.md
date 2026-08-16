# Project Vision

<!-- Cap: 100 lines. Updated by /initialize, /update-system, or manually. -->
<!-- Last updated: 2026-08-16 -->

## Design Principles
- Money handling is correctness-first: `Decimal` everywhere, never a float, because a
  rounding bug in a finance app is a real error, not a cosmetic one.
- Thin routes, fat services — routes are validation + delegation, business logic and all
  DB access live in `services/`.
- Idempotency where users can plausibly repeat an action (bank statement re-import).
- Prefer a shared source of truth (`shared/types/`) over parallel definitions that can
  drift between frontend and backend.

## Architectural Invariants
- No Prisma calls in route handlers — routes call a `services/*.ts` function.
- No raw SQL.
- Every currency field is `Decimal(15,2)`; rates/NAV/unit prices are `Decimal(15,4)`.
- Every thrown error is an `AppError`; the central `errorHandler` middleware is the only
  place that formats an error response.
- Every async route handler is wrapped in `asyncHandler()`.
- Transactions and tax records are soft-deleted (`deletedAt`). **But this is NOT universal:
  investments, FDs, RDs, SIPs, gold, real estate, insurance policies and loans are HARD
  deleted** (8 `.delete({` calls in `services/`). For those, the `*ForAudit` snapshot in
  `auditLog.oldValueJson` is the only record of what was destroyed — treat it as
  load-bearing for recovery, not just for the trail.
- Two roles only (`Role.ADMIN` | `Role.MEMBER`) — ADMIN can act family-wide, MEMBER is
  scoped to their own data. No finer-grained permission model exists; don't assume one.
- Bank statement imports are deduplicated via `importHash` and safe to re-run.
- API responses always use the `{ success, data, message?, pagination? }` envelope from
  `utils/response.ts` — never a hand-built response shape.

## Tech Debt Inventory
- [medium] 43 raw `prisma.` calls remain in route handlers, violating the "no Prisma in
  route handlers" rule: `documents.ts` 19, `categories.ts` 11, `budgets.ts` 8, and one
  each in `auth.ts`, `reports.ts`, `transactions.ts`, `loans.ts` (the target-user lookup
  Step 3f deliberately preserved) and `health.ts`. The 2026-08-16 refactor fixed only the
  28 `isTest`-gated audit-snapshot sites in `routes/{investments,tax,admin,insurance,
  loans}.ts`; the rest were deliberately out of scope. Push each into its owning service
  when next touching those files.
- [low] Three hand-rolled duplicates of `resolveTargetUserId`'s logic:
  `transactions.ts:56`, `loans.ts:40`, `budgets.ts:63`. Should call the shared util.
- [low] `auditService.ts:20`'s `if (isTest) return null` could now go — route tests observe
  the payload by mocking the module. Declined 2026-08-16: too wide a blast radius.
- [medium] The import insert loop (`services/statementImportService.ts`) is serial and
  unbounded inside one open `$transaction`. Prisma's default interactive-transaction
  timeout is 5s, so a large statement throws P2028 — which now surfaces as a clear 500
  rather than the old silent "201, imported: 0". Fix with `createMany` or chunking; both
  change dedup/atomicity semantics, so it needs its own plan.
- [medium] `transactionService.bulkImportTransactions` (~:1133) is DEAD (zero non-test
  callers) yet fully tested, inflating the coverage denominator. It writes
  `bankStatementImport.filename` UNSANITIZED (~:1169), bypassing `utils/sanitizeFilename`
  which the other writer applies, and its `buildImportHash` (~:34) disagrees with the live
  `makeImportHash` (omits `type`, applies `Math.abs`). No live vector — nothing calls it.
  Delete it and its ~50 lines of tests as its own task.
- [medium] Frontend has no ERROR BOUNDARY. `shared/ErrorBoundary.tsx` exists with zero
  importers (grep-verified), so any render throw blanks the whole app instead of one
  panel. One-line wiring fix in `AppShell.tsx`. `PageHeader.tsx` is likewise dead; both
  are coverage-excluded rather than tested.
- [low] `pages/Dashboard.tsx:72` builds the snapshot month key from
  `new Date().toISOString()` (UTC) while the app runs IST, so between 00:00-05:29 IST on
  the 1st the new month's net-worth snapshot is skipped (00:30 IST 1-Apr yields "2026-03").
- [low] `pages/Transactions.tsx` `?add=1` deep link broken for ADMIN: the mount effect
  runs BEFORE `user` resolves (`isAdmin` false), takes its first branch and strips the
  param; the ADMIN fallback is dead code. Works for MEMBER. Pinned by a "known bug" test.
- [low] `!isViewingFamilyWide` gates create buttons across 10 pages — an ADMIN with no
  member selected cannot create anything anywhere. Consistent; confirm it is intended.
- [medium] `frontend/src/lib/api.ts:32` `axios.create()` sets no `timeout` — bug-pattern
  P2 (external I/O without a bound). A hung backend leaves every query pending forever
  with no client-side limit. Pre-existing; the file is now at 100% coverage, which
  certifies the absence of a timeout. Add `timeout: 30_000`.
- [medium] No backend lint at all — `tsc --noEmit` and tests are the only backend gates.
  Style/quality issues that ESLint would catch on the frontend go unchecked here.
- [note] Zero TODO/FIXME markers in either tree — the debt is structural, not flagged.

## What We Will NOT Do
- No controllers layer — routes call services directly; adding one would be an
  unrequested abstraction over a small, working layering.
- No hand-built response shapes — always go through `utils/response.ts`.
- No float/JS `number` for money, ever, even "just for display."
- No NEW hard deletes on financial records (8 already exist — see Invariants; don't add more).

## Quality Thresholds
- Backend: `tsc --noEmit` clean, `npm run test:coverage` green (1720 tests as of last
  scan) at **100% statements/branches/functions/lines — enforced in CI**, not aspirational.
  The only remaining coverage exclusion is `src/config/prisma.ts` (a third-party singleton
  with no branches). `src/index.ts` used to be excluded too, which hid the entire bank-
  statement import handler, the multer upload filter and the filename sanitizer at 0% —
  that was fixed by extracting `app.ts` / `routes/import.ts` / `statementImportService.ts`.
  The 100% figure no longer carries an asterisk.
- Frontend: `npm run lint` clean (0 warnings), `tsc --noEmit` clean, and
  `npm run test:coverage` green — **enforced in CI** at PER-DIRECTORY thresholds
  (api/lib/hooks/contexts ~95%, components ~88%, pages ~60%), not one global number,
  because a single figure lets 100% in the logic layers mask a near-zero page.
  Measured 69.31% statements overall. NOTE: threshold globs MUST be written
  `'**/src/x/**'` — Vitest matches absolute paths, so `'src/x/**'` silently matches
  nothing, enforces nothing, and still exits 0.
- CI (`quality` job) runs all of the above on every PR and push to `main`; every other
  CI job depends on it passing.
