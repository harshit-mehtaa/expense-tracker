-- Backfill: free the importHash slot on rows that were already soft-deleted before
-- softDeleteTransaction started nulling it on delete. @@unique([importHash]) is
-- enforced regardless of deletedAt (Postgres/Prisma only treat NULL as
-- non-conflicting, not deletedAt), so a pre-existing soft-deleted row still occupies
-- its hash — without this backfill, statementImportService.ts's now-deletedAt-aware
-- dedup query would stop recognizing such a row as "already seen", let it reach
-- createMany, and hard-fail the whole import batch on a P2002 unique-constraint
-- violation. This affects only rows deleted before this migration runs; the app-level
-- fix already covers every soft-delete from here forward.
UPDATE "Transaction"
SET "importHash" = NULL
WHERE "deletedAt" IS NOT NULL AND "importHash" IS NOT NULL;
