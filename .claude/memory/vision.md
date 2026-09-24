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
- A categorized transaction's category has the transaction's own type; transfers (incl. paired
  legs) are never categorized. Every caller-chosen category goes through
  `categoryService.assertCategoryMatchesTransactionType`; in-use categories can't be retyped.
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
- [medium] PDF/CSV import gaps (2026-09-09, `importService.ts`/`routes/import.ts`): (1) persists
  straight to DB + mutates balances in-request — no dry-run/bulk undo. (2) `detectBankFromText`
  takes first keyword in FIXED order (ICICI mislabeled HDFC via a remark IFSC). (3) can't rejoin
  a pdf.js mid-digit split amount (aggregate warning only). (4) free-form `new Date(dateStr)`
  fallback stays locale-dependent (month-name branches fixed).
- [medium] 43 raw `prisma.` calls remain in route handlers (`documents.ts` 19,
  `categories.ts` 11, `budgets.ts` 8, one each in 5 others) — push into services when
  touched. `resolveTargetUserId` is hand-duplicated in 3 route files instead of using
  the shared util; only checks `deletedAt`.
- [low] No backend lint/`typecheck:tests`. Dashboard snapshot month key is UTC not IST; Reports
  `netWorth` ignores `selectedFY` and shows loading forever on error; Dashboard `summary`/`cashflow`/
  `alerts`/`budgetActuals`/`netWorthHistory` have no `isError` (a failed fetch paints ₹0).
- [low] Residual cache-invalidation gaps: `trial-balance` invalidated by nothing; Loans/
  Accounts reconciliation don't invalidate dashboard/reports (see `queryInvalidation.ts`).
- [medium] Pre-existing schema drift (`migrate diff`, 2026-09-24): CategoryType enum, Category
  idx/FK, Asset.updatedAt default, RecurringRule FK. No CI drift check. Separate task.
- [low] Category rules: timed-out regex rules tracked in-process only, not shown in UI;
  recurring catch-up loads rules per due template (N+1, only when due).
- [low] Nav cleanup (2026-09-25): FamilyMembers mutations invalidate ['admin-users'] only, not
  ['family-members'] → new member missing from selectors ≤5 min; ErrorBoundary keyed on pathname only
  (a crash in one ?tab= persists across tabs); embedded tab pages keep their own <h1> (→ PageHeader).
- [low] Category↔type invariant (2026-09-24) is app-level only: retype-vs-create race (check and
  write not atomic; no DB trigger); other deployments may hold legacy categorized TRANSFER
  rules/legs (local DB: 0). Any MEMBER can retype/merge/delete shared categories (pre-existing).
- [low] `CashflowMonth`/`UpcomingAlert`/`useAccounts`/`useCategories`/`selectedMemberName`
  each duplicated instead of shared; `computeTotalLiabilities` has an undocumented endDate
  filter excluding overdue loans; `!isViewingFamilyWide` gates create buttons across 10
  pages. No modal has role="dialog"/focus-trap/Escape/aria-live on errors; BUDGET_ALERT
  shows LIMIT as "due".
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
  test:coverage` green — **enforced in CI** at PER-DIRECTORY thresholds plus a
  project-wide floor (Vitest 3 applies global numbers to every file); pages gated in
  aggregate, not per file. Keep globs as `'**/src/x/**'` (never bare `'src/x/**'`).
- CI (`quality` job) gates every other job on every PR/push to `main`.
