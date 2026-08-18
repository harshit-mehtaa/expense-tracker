-- Track when a loan was actually closed, distinct from when it was scheduled to end.
--
-- Nothing on Loan records closure today. A fully paid-off loan sits in the list forever,
-- indistinguishable from an active one. `closedAt` is set exactly once, by
-- recordLoanPrepayment, when a prepayment brings outstandingBalance to 0.
--
-- `endDate` is deliberately left untouched by that write: it is the ORIGINALLY scheduled
-- end, and closedAt < endDate is how "closed early" gets computed, forever, without ever
-- overwriting the one fact that comparison needs.
--
-- NULL for every existing row: nothing in the live data is closed yet, so there is
-- nothing to backfill and no ambiguity in leaving it NULL.

ALTER TABLE "Loan" ADD COLUMN "closedAt" TIMESTAMP(3);
