# Project Vision

<!-- Cap: 100 lines. Updated by /initialize, /update-system, or manually. -->
<!-- Last updated: 2026-09-18 -->

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
- Bank statement imports are deduplicated via `importHash` and safe to re-run. Since
  2026-09-09, `persistParsedStatement` ALSO runs an additive fuzzy check (date/amount/
  type + normalized-description suffix/equality match, min-length-guarded on both
  paths, userId- not accountId-scoped) for the same transaction re-imported from a
  different source/account-link. Excludes synthetic cash-leg rows by cash-account id
  (NOT `transferPairId` — the real paired row carries that too). Degrades gracefully
  (silent miss, not a false positive) once a description is manually edited.
- API responses always use the `{ success, data, message?, pagination? }` envelope from
  `utils/response.ts` — never a hand-built response shape.
- `BankAccount.openingBalance`/`openingBalanceDate` (since 2026-09-18): a user-asserted
  closing balance as of a date. `currentBalance == openingBalance + Σ(non-superseded
  deltas since the anchor)` is the invariant — only `accountService.applyAnchor` may
  write these two fields or `Transaction.balanceSupersededByAnchor`. Every balance-
  reversal site must gate on `contributesToBalance()`, never `balanceImpactApplied`
  alone. Anchor cutoff has exactly one definition: `financialYear.ts`'s `anchorCutoff()`.

## Operational Notes
- A failed migration takes the whole stack down (backend `depends_on` migrate completing).
  Recovery from P3009 is documented and tested in DEPLOY.md.

## Tech Debt Inventory
- [medium] PDF/CSV import gaps found 2026-09-09 fixing ICICI multi-line parsing
  (`importService.ts`/`routes/import.ts`), none fixed here (real scope beyond a parser
  bugfix): (1) import persists straight to the DB, mutates `bankAccount.currentBalance`
  in-request — no dry-run, no bulk undo, only per-row `DELETE /:id`. (2)
  `detectBankFromText` picks the first keyword hit in FIXED order, not first occurrence
  — a real ICICI statement mislabeled "HDFC" via a beneficiary IFSC code in a remark.
  (3) block accumulator can't rejoin a pdf.js mid-digit split large amount, or a
  narrow/wide amount-regex ambiguity on one line — surfaced via an aggregate warning,
  not recovered. (4) date-parsing local-vs-UTC fixed 2026-09-09 for month-name branches
  (`parseUTCDateFromDayMonthYear`); the free-form `new Date(dateStr)` fallback stays
  locale-dependent, deliberately not fixed.
- [medium] 43 raw `prisma.` calls remain in route handlers (`documents.ts` 19,
  `categories.ts` 11, `budgets.ts` 8, one each in 5 others) — push into services when
  touched. `resolveTargetUserId` is hand-duplicated in 3 route files instead of using
  the shared util; only checks `deletedAt`.
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
- [medium] Opening-balance anchor (2026-09-18): `currentBalance` is a cached aggregate
  with NO verifier — 14 write sites keep it correct by convention, nothing cross-checks.
  `NetWorthSnapshot` deliberately left stale after a past-dated anchor (no per-account
  breakdown to correct from; matches import/recurring precedent). Run
  `backend/scripts/validate-opening-balance.ts` (manual, not CI) after touching any
  balance-write path — it's the only drift audit that exists.

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
- CI (`quality` job) gates every other job on every PR/push to `main`.
