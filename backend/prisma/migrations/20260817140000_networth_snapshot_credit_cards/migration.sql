-- Record credit card debt in the net worth snapshot.
--
-- Card balances were summed into `bankBalances` on the asset side, so a card you owed on
-- showed as a negative bank balance: the cash figure was understated by the debt and the
-- debt itself appeared under no liability line. The net worth TOTAL was unaffected — a
-- card at -5000 reduced assets by 5000, which nets the same as raising liabilities by
-- 5000 — so this changes the breakdown, not the headline number.
--
-- Existing rows stay NULL rather than being backfilled. There is no stored history of
-- what each past month's card balance was, and inventing one would make four snapshots
-- look authoritative about a number nobody recorded. NULL reads honestly as "not tracked
-- then". The `loans` column in those rows also carried the loans-only total, which is
-- what it means going forward, so it needs no correction.

ALTER TABLE "NetWorthSnapshot" ADD COLUMN "creditCards" DECIMAL(15,2);
