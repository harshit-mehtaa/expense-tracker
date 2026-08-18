# Task Progress

## Status: idle

Last completed: let a subscription's start date be edited (abf841d).

## QUEUED NEXT (unrelated)
1. Credit card statement import [BLOCKED — needs a sample file]. Bank statements only
carry the bill payment (transfer, excluded from reports); card spend (~Rs29,689 Apr-May
2026) is invisible. Trap: two existing CC BillPay transfers have no importHash — dedup
won't catch a re-import.
2. Native date pickers in Firefox/Safari — only if those browsers matter.

## Tech debt noted
- Asset.value/RealEstate.currentValue can drift. Category delete needs 2 round trips.
- Transaction.isRecurring written, never read. NetWorthSnapshot.creditCards NULL pre-08-17.
- Loan prepayment: 2 bounded non-atomicity/race windows (see f2890d7 commit msg); no
  edit/delete for a logged prepayment (would need a new hard delete).
- Subscription startDate edit (abf841d): same bounded race class as loan prepayment — a
  concurrent recordPriceChange between the guard's read and write could stale its
  decision. Never corrupts data, worst case a wrong-but-recoverable rejection. 2-user app;
  not worth transaction isolation hardening.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
