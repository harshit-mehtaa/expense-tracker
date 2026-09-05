# Task Progress

## Status: analyze
## Task: Close two remaining cash-account gaps: (1) statementImportService.persistParsedStatement
## doesn't route CASH-paymentMode imported rows to the user's cash account; (2)
## transactionService.updateTransaction has no CASH auto-resolve when paymentMode is edited
## to/from CASH (bankAccountId is currently immutable on update — needs a design decision).
## Started: 2026-09-06
## Steps Completed: analyze, plan, approve, implement, review (FAIL→DESTROYED, fixed, verified PASS)
## Baseline: 2378 backend tests pass pre-change (same 2 pre-existing coverage gaps).
## Post-implement: 2396 backend tests pass (18 new), 100% coverage on statementImportService.ts
## and transactionService.ts, same 2 pre-existing gaps only (loanService.ts:457,
## subscriptionService.ts:402-403). tsc clean. No frontend changes needed — confirmed
## the "Cash Withdrawal" label logic renders generically for any transferPairId pair
## with a cash-account leg (this was the plan's linchpin claim, verified by plan-challenger).
## Task Classification: risk_level=high, task_type=bugfix

## Plan (revised, folding in plan-challenger's 4 should_fix items):
1. [LOW] Import ensureCashAccount into statementImportService.ts. Inside the existing
   $transaction callback, before the row-creation loop: if any toCreate row has
   paymentMode==='CASH', call ensureCashAccount(tx, ownerUserId) once.
2. [MED] Per-row bankAccountId/transferPairId routing in the create loop:
   - Unlinked (!accountId) + CASH row -> bankAccountId: cashAccount.id, no transferPairId
     (single-leg, matches manual CASH expense).
   - Linked (accountId truthy) + CASH row -> original row keeps bankAccountId: accountId,
     gets a fresh transferPairId (crypto.randomUUID()); a synthetic row is created with
     opposite type, bankAccountId: cashAccount.id, same transferPairId, categoryId: null,
     its own distinct deterministic importHash (derived from the original hash + a
     stable suffix so re-import dedup works for both legs, never collides with the
     original). Doc comment here: this is a forward-only fix — re-importing an
     already-imported pre-fix statement will NOT retroactively add the cash leg, since
     dedup keys off the unchanged original row's hash (should_fix #4).
   - All other rows: unchanged.
3. [MED] Second aggregate cashNetDelta (same two-stage round2 as existing netDelta) from
   unlinked-CASH rows + synthetic legs. One additional bankAccount.update for the cash
   account when cashNetDelta !== 0. Existing netDelta calc for the linked account is
   UNCHANGED. ALSO: increment `imported`/`importedCount` by the number of synthetic legs
   created, so the reported count matches actual DB rows (should_fix #1).
   ensureCashAccount's AppError.conflict (rare concurrent-provisioning race) will be
   caught by the existing blanket catch and surfaced as the generic "Import failed"
   message — accepted as-is (still isOperational, tells the user nothing was saved;
   not special-cased) rather than adding new error-branching (should_fix #2, resolved
   by accepting the generic message deliberately, documented in a code comment).
4. [LOW] Extend statementImportService.test.ts: Scenario A, Scenario B (pair created,
   both balances move, importedCount includes the synthetic leg), mixed CASH+non-CASH,
   re-import dedup of both legs, zero-CASH-rows (no ensureCashAccount call).
5. [MED] In updateTransaction, after loading `original`: effectivePaymentMode =
   data.paymentMode ?? original.paymentMode; effectiveType = data.type ?? original.type.
   If !original.bankAccountId && effectivePaymentMode==='CASH' && effectiveType!=='TRANSFER',
   call ensureCashAccount(ptx, original.userId) [NOT the requester's userId — verified
   critical]. Write bankAccountId only when newly resolved; never touch an already-set one.
6. [MED] Widen balance-recalc guard to
   (amountChanged || typeChanged || cashAccountNewlyLinked) && (original.bankAccountId || cashAccountNewlyLinked);
   oldDelta = 0 when cashAccountNewlyLinked (no prior impact); target
   cashResolvedBankAccountId for the bankAccount.update.
7. [MED] updateTransaction tests: paymentMode-only edit to CASH on unlinked txn (full
   delta applied); same + simultaneous amount change; non-CASH edit stays unlinked;
   existing cosmetic no-op case re-verified; TRANSFER-original still rejected; explicit
   ADMIN-edits-MEMBER's-unlinked-CASH-transaction case asserting the MEMBER's (not
   ADMIN's) cash account is used (should_fix #3 — the single highest-risk case).
8. [LOW] Full backend test suite + coverage gate.
9. [LOW] Repo-wide grep to confirm no third call site missed, and fresh grep confirming
   bulkImportTransactions still has zero callers (known pitfall from errors.md).
10. [LOW] Doc comment on synthetic-leg importHash derivation.

## Design Questions:
1. [Gap 1 - unlinked import] Today, in `statementImportService.persistParsedStatement`,
   when a statement has no linked `accountId`, EVERY row (including CASH-paymentMode
   rows) gets `bankAccountId: accountId ?? null` (:83) and the balance-sync block is
   skipped entirely since it's gated on `accountId` (:97). CASH rows here are structurally
   identical to a manual CASH expense with no account — should they resolve to the user's
   cash account exactly like `createTransaction` does?
2. [Gap 1 - linked import, e.g. ATM withdrawal] When a statement IS linked to a real
   account and a row is classified `paymentMode: CASH` (e.g. an "ATM WDL" line, detected
   by `importService.ts:69-76`'s regex), that row already correctly debits the linked
   account via the aggregate `netDelta` (:104-115) — money leaves the bank correctly.
   But nothing credits the cash account, so the withdrawn cash vanishes. Should this
   become a true double-entry pair (matching how a manual cash withdrawal is a TRANSFER
   with `transferPairId`, and get the "Cash Withdrawal" UI label for free), or a simpler
   independent single-leg credit to the cash account (no `transferPairId`, no UI label)?
   Evidence: `transactionService.ts`'s TRANSFER path (createTransaction) is the
   established idiom for "money moves between two of the user's own accounts" — but
   retrofitting that into a per-row bulk-insert loop (currently one `tx.transaction.create`
   per row, one aggregate `bankAccount.update` per statement) is structurally different
   from the single-transaction case `createTransaction` handles.
3. [Gap 2] `updateTransaction` (transactionService.ts:584-674) treats `bankAccountId` as
   fully immutable — `accountChanged` is hardcoded `false` with a comment: "does not
   support changing bankAccountId". TRANSFER edits are rejected outright with "Delete and
   re-create them" (:590). Editing `paymentMode` alone (UPI→CASH or CASH→UPI) on a
   transaction that already has a real `bankAccountId` is legal today and correctly has
   NO balance effect (it's cosmetic once an account is linked) — that part is fine.
   The actual gap: a transaction with `bankAccountId: null` (any payment mode with no
   linked account is legal today — not CASH-specific) whose `paymentMode` is edited TO
   'CASH' does not resolve to the cash account, unlike a freshly-created CASH transaction.
   Given the existing "bankAccountId is immutable, full stop" invariant and the TRANSFER
   precedent of outright rejecting an edit that would need to move accounts (rather than
   inventing new balance-mutation-on-edit machinery), should editing `paymentMode` in a
   way that would change which account (if any) a transaction resolves to simply be
   REJECTED (mirroring the TRANSFER-edit rejection, "delete and re-create"), rather than
   silently doing nothing (current, confusing) or silently starting to move money on an
   edit (new, invasive)?
4. [Gap 1] Should the import fix apply per-row balance updates for CASH rows, or can it
   stay aggregate (compute a second `netDelta` scoped to CASH rows, one additional
   `bankAccount.update` on the cash account per statement) consistent with the existing
   single aggregate-update-per-statement design for the linked account?

## Verification Questions:
1. Are BOTH import scenarios (no linked account, linked account) covered, not just one?
2. Does the import fix call `ensureCashAccount` (self-healing, consistent with
   `createTransaction`/`recurringService`) rather than a bare `findFirst` that could
   permanently fail for a not-yet-backfilled user?
3. Is the existing import dedup/idempotency (`importHash`) and atomic-batch-failure
   behavior preserved for the new CASH-account balance logic (no partial writes)?
4. Does `updateTransaction`'s new rejection path (if chosen) have a clear, actionable
   error message, and does it NOT break the existing "paymentMode-only edit with a real
   bankAccountId is a no-op cosmetic change" behavior which must keep working?
5. Do the new/changed branches maintain the CI-enforced 100% backend branch coverage gate?
6. Does the fix avoid touching `transactionService.bulkImportTransactions` (confirmed
   dead code, zero callers) or any other unrelated code path?
