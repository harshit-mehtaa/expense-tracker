# Project Vision

<!-- Cap: 100 lines. Updated by /initialize, /update-system, or manually. -->
<!-- Last updated: 2026-09-06 -->

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
  CASH auto-resolve) were closed 2026-09-06. Residual: (1) the auto-resolve is one-way —
  editing paymentMode CASH→other on an already-cash-linked transaction doesn't unlink it.
  (2) Any row with a non-null `transferPairId` (import pairs, `convertTransactionToTransfer`
  legs) can still have amount/type changed via `PATCH /transactions/:id` — only
  `type==='TRANSFER'` is rejected, not "has a transferPairId" — silently desyncing the
  pair. Frontend hides Edit for these but the API doesn't enforce it. (3) `'CASH'` is a
  bare string literal in ~5 places instead of `PaymentMode.CASH`/`AccountType.CASH` — P1 risk.
  (4) A linked-import CASH row (correctly or wrongly classified by `importService.ts`'s
  `/\bcash\b/i` rule, which matches before the CARD rule) is excluded from ALL expense
  reporting (`dashboardService.ts`, `utils/refundReporting.ts` filter `transferPairId IS
  NULL`) for as long as it exists — correct for a real withdrawal, silent data loss for a
  false positive (e.g. "POS PURCHASE CASH N CARRY"). Deleting it is now possible (see
  above) but re-importing the same statement won't recreate it — dedup ignores
  `deletedAt`. (5) Two identical CASH rows in ONE statement (same date/amount/desc) hash
  the same and hard-fail the whole import via P2002 — pre-existing, same "please try
  again → can never succeed" class as the once-broken synthetic-leg hash.
- [medium] 43 raw `prisma.` calls remain in route handlers (`documents.ts` 19,
  `categories.ts` 11, `budgets.ts` 8, one each in `auth.ts`/`reports.ts`/
  `transactions.ts`/`loans.ts`/`health.ts`) — push into owning services when touched.
  `resolveTargetUserId` logic is similarly hand-duplicated in `transactions.ts:56`,
  `loans.ts:40`, `budgets.ts:63` instead of calling the shared util; only checks
  `deletedAt`, not `isActive`, everywhere it's used.
- [medium] Import insert loop (`statementImportService.ts`) serial/unbounded in one open
  `$transaction` — large statement can throw P2028.
- [low] `axios.create()` (`api.ts:32`) sets no `timeout` (bug-pattern P2). No backend
  lint AND no `typecheck:tests` (unlike frontend) — a type-only stale import in a
  backend test file is invisible to every gate. Dashboard snapshot month key uses UTC
  not IST; `netWorth` ignores `selectedFY`.
  `accountFormat.ts:46` owner-name branch untested; `spendingByCat` (Reports.tsx) has no
  isError handling, unlike siblings. `Transactions.tsx:2138`'s `?tab=bogus` renders
  neither tab (`?? 'transactions'`, unlike `Assets.tsx`'s explicit membership guard).
- [medium] Primary transaction CRUD mutations (edit/delete/import/bulk/recurring-apply)
  don't invalidate dashboard/profit-and-loss/report-spending/accounts query caches.
- [low] `CashflowMonth`/`UpcomingAlert`/`useAccounts`/`useCategories`/`selectedMemberName`
  each duplicated instead of shared; `computeTotalLiabilities` has an undocumented endDate
  filter excluding overdue loans; `!isViewingFamilyWide` gates create buttons across 10
  pages. No modal has role="dialog"/focus-trap/Escape; `Sidebar.tsx` `<nav>` lacks
  aria-label; BUDGET_ALERT shows LIMIT as "due".
- [low] Gold/RealEstate (`/assets`) and Transactions/RecurringRules both had a per-tab
  `viewUserId` desync; both fixed 2026-09-08 (shared owner in the tab-bar parent, as a
  prop; RecurringRulesPage's is REQUIRED — no standalone route/test unlike Gold/RE).
  Unlinked `assetType:'GOLD'` Assets still render on Vehicles & Other. `recurring.ts`'s
  `targetUserId ?? userId` fallback makes an admin's "no selection" own-data-only there
  (unlike Transactions' family-wide) — masked by a tab-aware label, not backend-fixed.
- [low] `''`-coerces-to-0 Zod bug in RealEstate.tsx, Accounts.tsx, TaxCentre.tsx — only
  the user-CLEARS-a-field half remains (2026-09-06 fixed the server-null half in
  TaxCentre via a hydration mapper). Needs backend `.nullable()` + tests in all 3 files;
  a frontend-only `''->undefined` fix would silently revert an intentional clear.

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
