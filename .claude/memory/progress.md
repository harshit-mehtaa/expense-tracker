# Task Progress

## Status: idle

Last completed: transactions page search cursor fix (89ca087).

## QUEUED NEXT

### 1. Credit card statement import  [BLOCKED — needs a sample file]
Bank statements carry only the monthly card bill payment, stored as a transfer pair and
excluded from every report (`transferPairId IS NULL`). Card spend is a hole: ~Rs29,689
across Apr+May 2026. User wants BOTH CSV and PDF; build CSV first.
- CSV: `importService.parseCSV` dispatches per bank on Withdrawal/Deposit/Closing-Balance
  layouts. Card statements differ; needs its own parser + detection.
- PDF: `parsePDF` + `detectBankFromText`. Card statements are usually password-protected;
  no password handling exists.
- Sign mapping is unchanged: card purchase = Debit = EXPENSE; bill payment credit = INCOME.
**Trap:** the two existing "CC BillPay" transfers were paired with hand-created card-side
legs carrying no `importHash`, so dedup (`makeImportHash`, scoped by bankAccountId) will
NOT catch them. Re-importing Apr/May 2026 duplicates the payment.

### 2. Native date pickers in Firefox/Safari
`lang="en-IN"` fixes Chromium only. Cross-browser fix is a custom picker across 26 inputs
and costs the native mobile date UI. Only worth doing if those browsers matter.

## Tech debt noted
- `Asset.value` and `RealEstate.currentValue` hold the same number in two columns and can
  drift. RealEstate is authoritative for net worth; nothing keeps them in step.
- Category delete guards run children -> budgets -> transactions, so a category with both
  needs two round trips to remove.
- `Transaction.isRecurring` is written but never read. Drop it when next touching schema.
- `NetWorthSnapshot.creditCards` is NULL for the 4 pre-2026-08-17 rows. Do not backfill.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
