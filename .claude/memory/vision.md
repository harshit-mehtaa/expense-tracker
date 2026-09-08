# Project Vision

<!-- Cap: 100 lines. Updated by /initialize, /update-system, or manually. -->
<!-- Last updated: 2026-09-08 -->

## Design Principles
- Money handling is correctness-first: `Decimal` everywhere, never a float, because a
  rounding bug in a finance app is a real error, not a cosmetic one.
- Thin routes, fat services — routes are validation + delegation, business logic and all
  DB access live in `services/`.
- Idempotency where users can plausibly repeat an action (bank statement re-import).
- Prefer a shared source of truth (`shared/types/`) over parallel definitions that drift.

## Architectural Invariants
- No Prisma calls in route handlers — routes call a `services/*.ts` function. No raw SQL.
- Every currency field is `Decimal(15,2)`; rates/NAV/unit prices are `Decimal(15,4)`.
- Every thrown error is an `AppError`; the central `errorHandler` middleware is the only
  place that formats an error response. Every async route handler wraps in `asyncHandler()`.
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
- A failed migration takes the whole stack down (backend `depends_on` migrate completing).
  Recovery from P3009 is documented and tested in DEPLOY.md.

## Tech Debt Inventory
- [medium] Both remaining cash-account gaps (import CASH routing, `updateTransaction`
  CASH auto-resolve) were closed 2026-09-06. Residual: (1) auto-resolve is one-way — no
  unlink on paymentMode CASH→other. (2) A non-null `transferPairId` row can still have
  amount/type changed via `PATCH /transactions/:id` (only `type==='TRANSFER'` is
  rejected), silently desyncing the pair — API doesn't enforce what the UI hides. (3)
  `'CASH'` is a bare string literal in ~5 places instead of the enum — P1 risk. (4) A
  linked-import CASH row is excluded from ALL expense reporting for as long as it exists
  (correct for a real withdrawal, silent loss for a false-positive match); deletable now
  but re-import won't recreate it (dedup ignores `deletedAt`). (5) Two identical CASH
  rows in one statement hash the same and hard-fail the whole import via P2002.
- [medium] 43 raw `prisma.` calls remain in route handlers (`documents.ts` 19,
  `categories.ts` 11, `budgets.ts` 8, one each in `auth.ts`/`reports.ts`/
  `transactions.ts`/`loans.ts`/`health.ts`) — push into services when touched.
  `resolveTargetUserId` is hand-duplicated in `transactions.ts:56`/`loans.ts:40`/
  `budgets.ts:63` instead of using the shared util; only checks `deletedAt`.
- [medium] Import insert loop (`statementImportService.ts`) serial/unbounded in one open
  `$transaction` — large statement can throw P2028.
- [low] No backend lint AND no `typecheck:tests` (unlike frontend). Dashboard snapshot
  month key uses UTC not IST; `netWorth` (Reports.tsx) ignores `selectedFY` AND
  conflates loading/error into a permanent "Loading net worth data..." — no banner.
  Dashboard's `cashflow`/`alerts`/`budgetActuals`/`netWorthHistory` are eager+ungated
  with no `isError` (same defect class as the just-fixed `spendingByCat`); `summary`
  is the largest instance — a failed fetch paints ₹0 across every StatCard.
- [low] Transaction CRUD cache invalidation gaps fixed 2026-09-08 via a shared
  `invalidateTransactionMutationCaches` helper (`queryInvalidation.ts`) covering all 8
  mutation sites + `['budgets-actuals']` (a key distinct from `['budgets','vs-actuals']`,
  missed on first pass, caught by review). Residual, same bug class: `trial-balance`
  (Reports.tsx) is invalidated by nothing; Loans/Categories/Accounts reconciliation
  mutations don't invalidate dashboard/reports either — neither fixed here.
- [low] `CashflowMonth`/`UpcomingAlert`/`useAccounts`/`useCategories`/`selectedMemberName`
  each duplicated instead of shared; `computeTotalLiabilities` has an undocumented endDate
  filter excluding overdue loans; `!isViewingFamilyWide` gates create buttons across 10
  pages. No modal has role="dialog"/focus-trap/Escape/aria-live on errors; `Sidebar.tsx`
  `<nav>` lacks aria-label; BUDGET_ALERT shows LIMIT as "due".
- [low] Gold/RealEstate (`/assets`) and Transactions/RecurringRules both had a per-tab
  `viewUserId` desync; both fixed 2026-09-08 (shared owner in the tab-bar parent, as a
  prop; RecurringRulesPage's is REQUIRED — no standalone route/test unlike Gold/RE).
  Unlinked `assetType:'GOLD'` Assets still render on Vehicles & Other. `recurring.ts`'s
  `targetUserId ?? userId` fallback makes an admin's "no selection" own-data-only there
  (unlike Transactions' family-wide) — masked by a tab-aware label, not backend-fixed.
- [low] `''`-coerces-to-0 / can't-clear-a-set-field Zod+Prisma bug fixed 2026-09-08
  across RealEstate.tsx, Accounts.tsx, TaxCentre.tsx + backend routes/accountService.ts's
  null-swallowing normalize helpers. Residual: Accounts.tsx's `interestRate` has zero
  rendered `<input>` — write-path unreachable, display-only — needs a UI input added,
  deliberately left out here. Investments.tsx's `optionalString`/`optionalPositiveNumber`/
  `optionalExchange`/`optionalDate` still swallow `''`→`undefined` (same bug class,
  unaudited whether any maps to a nullable column) — out of this task's stated scope.

## What We Will NOT Do
- No controllers layer — routes call services directly; an unrequested abstraction.
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
