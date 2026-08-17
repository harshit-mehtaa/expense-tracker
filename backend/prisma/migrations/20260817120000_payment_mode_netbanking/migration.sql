-- Add NETBANKING to PaymentMode.
--
-- The enum covered UPI, cards and the individual NEFT/RTGS/IMPS rails but had no value
-- for a plain netbanking mandate, which is how a good many Indian subscriptions are
-- actually billed. Anyone paying that way had to pick a rail that was not what happened.
--
-- ALTER TYPE ... ADD VALUE inside a transaction was an error before PostgreSQL 12 and is
-- the classic cause of a P3009 half-applied migration (see DEPLOY.md). It is permitted
-- from 12 onward provided the new value is not USED in the same transaction; this file
-- only adds it, and the deployment runs PostgreSQL 16. Nothing here writes the value.
--
-- IF NOT EXISTS makes re-running harmless, since an enum value cannot be dropped and a
-- failed retry would otherwise be unrecoverable without hand-editing _prisma_migrations.

ALTER TYPE "PaymentMode" ADD VALUE IF NOT EXISTS 'NETBANKING' AFTER 'UPI';
