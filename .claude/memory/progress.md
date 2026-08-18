# Task Progress

## Status: analyze
## Task: Transactions page — search input loses the cursor after one keystroke
## Started: 2026-08-18
## Baseline Failures: 0 (811 passed)
## Validation Results: 816/816 frontend tests pass (5 new), tsc clean, lint clean. Reverting the fix (queryKey back to filters, drop keepPreviousData) fails exactly VQ1 and VQ2 as predicted.
## Review Verdict: PASS (self-reviewed, Tier 2 — quality + fresh-read verification, no adversarial findings)
## Steps Completed: analyze, plan, approve, implement, review

## Design Questions

**DQ1. What actually unmounts the input?**
`Transactions.tsx:2487` `queryKey: ['transactions', selectedFY, filters, viewUserId]` —
`filters` contains `search`. `:2603-2604` the input writes `filters.search` on every
keystroke, so every letter produces a NEW query key. React Query v5 (`package.json:31`
^5.20.0) defines `isLoading = isPending && isFetching`; a new key has no cached data, so
status is `pending` and `isLoading` flips true. `:2501` `if (isLoading) return
<PageLoader />` then replaces the ENTIRE page — search input included. When data lands a
fresh input mounts, unfocused. Hence: exactly one letter, then the cursor is gone.

**DQ2. Must `search` stay in the query key (i.e. is it server-side)?**
Yes. `:191` sends `search: filters.search` to `GET /transactions`. The list is cursor
paginated at 50/page (`:189`), so filtering client-side would only search the loaded page
and silently return wrong results. The key must keep it.

**DQ3. Options and trade-offs.**
- (a) Debounce alone — cuts one request per letter, but when the debounced value finally
  lands the key still changes and the page still unmounts. Fixes the request storm, NOT
  the cursor. Insufficient on its own.
- (b) `placeholderData: keepPreviousData` — on a key change the previous data is reused,
  so status stays `success`, `isLoading` stays false, and the page never unmounts. This
  is the actual cursor fix and is one line.
- (c) Move the input above the loading guard / into its own component — works, but leaves
  the whole page flashing to a spinner on every filter change.
- (d) Drop the early return and render the loader inside the list region only — better UX
  but a much wider diff through a 2,700-line component.
Chosen: (b) + (a). (b) fixes the defect; (a) stops ~1 request per letter hitting the API.

**DQ4. Blast radius of `keepPreviousData` here.**
`isLoading` is consumed only at `:2501`. `isFetchingNextPage`/`hasNextPage` (`:2483-2485`)
drive infinite scroll and are unaffected. Stale rows remain visible while the new search
is in flight, which is the intended trade.

## Verification Questions

**VQ1.** Does the input keep focus across a whole word, not just the second letter?
**VQ2.** Is exactly one request issued per settled search term, and does the result match
the final term (not a stale in-flight one)?
**VQ3.** Does a genuine first load still show `PageLoader`? (Guard must not be dead.)
**VQ4.** Do the other filters — type/category/payment-mode chips, date range, FY, member
— still refetch correctly and not regress?
**VQ5.** Does infinite scroll still work after searching (cursor resets, no page bleed
from the previous term)?
**VQ6.** Any other page with a free-typed input feeding a query key?
Scanned: only `Transactions.tsx`. The three other early-return guards
(`admin/Reports.tsx:125`, `tax/ITR2Summary.tsx:18`, `subscriptions/Subscriptions.tsx:368`)
key on dropdowns (`selectedFY`, `viewUserId`) only — no cursor to lose. Re-verify at REVIEW.

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
