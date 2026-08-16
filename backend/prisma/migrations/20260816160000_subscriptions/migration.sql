-- Subscriptions: a managed recurring service that OWNS its RecurringRule.
--
-- One file, because Prisma wraps each migration file in a single transaction. Every
-- statement here is transactional (CREATE TYPE is; ALTER TYPE ADD VALUE and
-- CREATE INDEX CONCURRENTLY are not, and neither appears below), so a failure at any
-- point rolls the whole thing back rather than leaving a half-migrated database that
-- blocks backend startup.

-- ── Status ───────────────────────────────────────────────────────────────────
-- No PAUSED: nothing writes it, and cancel/resume already covers pausing. Adding an enum
-- value later is a one-line migration; removing one in use is not.
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'CANCELLED');

-- ── Subscription ─────────────────────────────────────────────────────────────
CREATE TABLE "Subscription" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "vendor"          TEXT,
    "status"          "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancellationUrl" TEXT,
    "startDate"       TIMESTAMP(3) NOT NULL,
    "trialEndDate"    TIMESTAMP(3),
    "cancelledAt"     TIMESTAMP(3),
    "cancelReason"    TEXT,
    "notes"           TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    -- Soft delete. vision.md forbids NEW hard deletes on financial records: the price
    -- history is the proof of what past charges were billed at, and cascading it away
    -- would leave historical spend unexplainable.
    "deletedAt"       TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "Subscription_trialEndDate_idx" ON "Subscription"("trialEndDate");
CREATE INDEX "Subscription_deletedAt_idx" ON "Subscription"("deletedAt");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Price history ────────────────────────────────────────────────────────────
-- Amount is DECIMAL(15,2) per the project-wide currency invariant. A percentage-shaped
-- narrower type is what bit the loans prepayment column, where 2% of Rs 50,00,000 did
-- not fit in DECIMAL(5,2).
CREATE TABLE "SubscriptionPrice" (
    "id"             TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount"         DECIMAL(15,2) NOT NULL,
    "effectiveFrom"  TIMESTAMP(3) NOT NULL,
    "note"           TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPrice_pkey" PRIMARY KEY ("id")
);

-- One price per subscription per instant: two rows sharing an effectiveFrom would make
-- "the price on that date" ambiguous, and generation would pick arbitrarily.
-- The UNIQUE index also serves lookups by (subscriptionId, effectiveFrom), so a separate
-- non-unique index on the same columns would be a second identical btree to maintain.
CREATE UNIQUE INDEX "SubscriptionPrice_subscriptionId_effectiveFrom_key"
ON "SubscriptionPrice"("subscriptionId", "effectiveFrom");

ALTER TABLE "SubscriptionPrice" ADD CONSTRAINT "SubscriptionPrice_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RecurringRule ownership ──────────────────────────────────────────────────
-- The FK lives on the rule, not on Subscription, so that deleting a subscription
-- cascades to the rule it owns. A FK pointing the other way could not cascade in that
-- direction. UNIQUE enforces at most one rule per subscription.
ALTER TABLE "RecurringRule" ADD COLUMN "subscriptionId" TEXT;

CREATE UNIQUE INDEX "RecurringRule_subscriptionId_key" ON "RecurringRule"("subscriptionId");

ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Transaction attribution ──────────────────────────────────────────────────
-- Mirrors the existing loanId / sipId / insurancePolicyId columns: nullable, SET NULL on
-- delete, indexed. A subscription charge stays an ordinary expense in reports; only the
-- attribution is new.
ALTER TABLE "Transaction" ADD COLUMN "subscriptionId" TEXT;

-- NOTE: non-concurrent, so this takes ACCESS EXCLUSIVE on Transaction — the largest
-- table — for its duration. Milliseconds at personal-finance scale, and it MUST stay
-- non-concurrent here because CREATE INDEX CONCURRENTLY cannot run inside the
-- transaction Prisma wraps this file in. Do not copy this onto a large table without
-- moving it to its own concurrent migration.
CREATE INDEX "Transaction_subscriptionId_idx" ON "Transaction"("subscriptionId");

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
