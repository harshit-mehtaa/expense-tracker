# Task Progress

## Status: idle

Last completed: subscription payment method + credit card debt as a liability (087108f).

## QUEUED NEXT

### 1. Credit card statement import  [BLOCKED — needs a sample file]
Bank statements carry only the monthly card bill payment, which is stored as a transfer
pair and excluded from every report (`transferPairId IS NULL`). So card spend is a hole:
~Rs29,689 across Apr+May 2026 left the bank with no record of what was bought. Recurring
rules on a card (the YouTube subscription) are currently the only thing filling it.

User wants BOTH formats; build CSV first, it reuses the existing pipeline.
- CSV path: `importService.parseCSV` dispatches per bank (HDFC/SBI/ICICI/AXIS/KOTAK) on
  Withdrawal/Deposit/Closing-Balance layouts. Card statements differ; needs its own parser
  plus detection. No `accountType` restriction anywhere, so a card can already be the
  import target.
- PDF path: `parsePDF` + `detectBankFromText`. Card statements are usually
  password-protected — no password handling exists today.
- Sign mapping is unchanged from banks: card purchase = Debit = EXPENSE (balance goes more
  negative); bill payment credit = INCOME. Pair the credit with the bank-side debit.

**Trap to handle before importing Apr/May 2026.** The two existing "CC BillPay" transfers
were paired with hand-created card-side legs that carry no `importHash`. Dedup
(`makeImportHash`, scoped by bankAccountId) will not catch them, so re-importing those
months duplicates the payment.

### 2. Native date pickers in Firefox/Safari
`lang="en-IN"` fixes Chromium only; Firefox and Safari read OS regional settings. The
cross-browser fix is a custom picker across 26 inputs, which costs the native mobile
date UI. Only worth doing if those browsers matter.

## Tech debt noted
- `Asset.value` and `RealEstate.currentValue` hold the same number in two columns and can
  drift. RealEstate is authoritative for net worth now, but nothing keeps them in step.
- Category delete guards run children -> budgets -> transactions, so a category with both
  children and transactions needs two round trips to remove. Correct precedence, mildly
  annoying; surface all blockers at once if it becomes a nuisance.
- `Transaction.isRecurring` is now written but never read. It was the (unreliable) proxy
  for "is a template"; templates are no longer transactions, so nothing filters on it.
  It stays user-settable via the API. Drop it when next touching that schema area.
- `NetWorthSnapshot.creditCards` is NULL for the 4 pre-2026-08-17 rows. No record exists
  of past card balances; NULL reads honestly as "not tracked then". Do not backfill.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
