# Project Vision

<!-- Cap: 100 lines. Updated by /initialize, /update-system, or manually. -->
<!-- Last updated: 2026-09-06 -->

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

## Operational Notes
- A failed migration takes the whole stack down: backend `depends_on` migrate completing
  successfully. Recovery from P3009 is documented and tested in DEPLOY.md.

## Tech Debt Inventory
- [medium] Bank-statement-imported transactions with `paymentMode=CASH` bypass the
  per-user cash-account balance logic added 2026-09. Live path is
  `statementImportService.persistParsedStatement` (via `routes/import.ts`) — NOT
  `transactionService.bulkImportTransactions`, which is dead (zero callers). Already
  writes per-row inside one `$transaction`, so wiring in the auto-resolve is a small fix.
  Deferred at task approval (2026-09-06) on a since-corrected premise (originally cited
  the wrong, dead function). `recurringService.ts`'s equivalent gap was fixed same-day,
  but `updateTransaction` still has none — editing paymentMode to/from CASH doesn't move
  the balance to/from the cash account.
- [medium] 43 raw `prisma.` calls remain in route handlers (`documents.ts` 19,
  `categories.ts` 11, `budgets.ts` 8, one each in `auth.ts`/`reports.ts`/
  `transactions.ts`/`loans.ts`/`health.ts`) — push into owning services when touched.
- [low] Three hand-rolled duplicates of `resolveTargetUserId`'s logic (`transactions.ts:56`,
  `loans.ts:40`, `budgets.ts:63`) should call the shared util.
- [medium] The import insert loop (`statementImportService.ts`) is serial/unbounded
  inside one open `$transaction` — a large statement can throw P2028. Fix with
  `createMany` or chunking; both change dedup/atomicity semantics, needs its own plan.
- [medium] `transactionService.bulkImportTransactions` (~:1171) is DEAD (zero non-test
  callers) yet fully tested. Writes `bankStatementImport.filename` UNSANITIZED, and its
  `buildImportHash` disagrees with the live `makeImportHash`. Delete it and its tests.
- [medium] Frontend has no ERROR BOUNDARY wired in (`shared/ErrorBoundary.tsx` exists,
  zero importers) — one-line fix in `AppShell.tsx`. `PageHeader.tsx` is likewise dead.
- [low] `pages/Dashboard.tsx:72` builds the snapshot month key from UTC while the app
  runs IST — skips the new month's net-worth snapshot for ~5.5h after midnight IST.
- [low] `pages/Transactions.tsx` `?add=1` deep link broken for ADMIN (mount effect races
  `user` resolving). Works for MEMBER. Pinned by a "known bug" test.
- [low] `!isViewingFamilyWide` gates create buttons across 10 pages — confirm intended.
- [medium] `frontend/src/lib/api.ts:32` `axios.create()` sets no `timeout` (bug-pattern P2).
- [medium] No backend lint at all — `tsc --noEmit` and tests are the only backend gates.
- [low] `frontend/src/lib/accountFormat.ts:46` owner-name-shown branch has zero test
  coverage anywhere — needs an accounts fixture with a distinguishable userName.
- [low] `resolveTargetUserId` (backend) only checks `deletedAt`, not `isActive`.
  `spendingByCat` query in Reports.tsx has no isError handling, unlike siblings.
- [medium] Primary transaction CRUD mutations (edit/delete/import/bulk/recurring-apply)
  don't invalidate dashboard/profit-and-loss/report-spending/accounts query caches.
- [low] `CashflowMonth`/`UpcomingAlert` types, `useAccounts`/`useCategories` (5-way), and
  `selectedMemberName` (Dashboard/Transactions) are each duplicated instead of shared.
- [low] `computeTotalLiabilities` has an undocumented endDate filter excluding overdue loans.
- [low] No modal has role="dialog"/focus-trap/Escape-to-close; chart click-handlers are
  mouse-only — systemic a11y gap. `viewUserId` is local useState, not shared context/URL.
- [low] BUDGET_ALERT rows display the budget LIMIT as "amount due". 80C/80D bar-color
  threshold duplicated 4x. taxApi/insuranceApi/investmentsApi/loansApi mostly `Promise<any>`.
- [low] Backend branch-coverage gate tight spots: loanService.ts:457, subscriptionService.ts:402-403.
- [low] `''`-coerces-to-0 Zod bug class unfixed in RealEstate.tsx, Accounts.tsx, TaxCentre.tsx.
- [low] Dashboard's `netWorth` always shows today's live figure regardless of `selectedFY`.

## What We Will NOT Do
- No controllers layer — routes call services directly; adding one would be an
  unrequested abstraction over a small, working layering.
- No hand-built response shapes — always go through `utils/response.ts`.
- No float/JS `number` for money, ever, even "just for display."
- No NEW hard deletes on financial records (8 already exist — see Invariants; don't add more).

## Quality Thresholds
- Backend: `tsc --noEmit` clean, `npm run test:coverage` green at **100%
  statements/branches/functions/lines — enforced in CI**. Only exclusion:
  `src/config/prisma.ts` (third-party singleton, no branches).
- Frontend: `npm run lint` clean (0 warnings), `tsc --noEmit` clean, `npm run
  test:coverage` green — **enforced in CI** at PER-DIRECTORY thresholds (not one global
  number). Threshold globs MUST be `'**/src/x/**'` — Vitest matches absolute paths, so
  `'src/x/**'` silently matches nothing and still exits 0.
- CI (`quality` job) runs all of the above on every PR/push to `main`; every other CI
  job depends on it passing.
