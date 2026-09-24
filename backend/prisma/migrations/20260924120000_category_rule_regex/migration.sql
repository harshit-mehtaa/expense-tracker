-- Regex category rules. Hand-written: Prisma's generated diff would DROP + ADD the
-- renamed column, deleting every existing keyword rule.

-- CreateEnum
CREATE TYPE "CategoryRuleMatchType" AS ENUM ('KEYWORD', 'REGEX');

-- Rename keyword -> pattern, preserving existing rows
ALTER TABLE "CategoryRule" RENAME COLUMN "keyword" TO "pattern";

-- Existing rules are all keyword rules
ALTER TABLE "CategoryRule" ADD COLUMN "matchType" "CategoryRuleMatchType" NOT NULL DEFAULT 'KEYWORD';

-- RENAME COLUMN does not rename or re-scope the old unique index
DROP INDEX "CategoryRule_userId_keyword_key";
CREATE UNIQUE INDEX "CategoryRule_userId_matchType_pattern_key" ON "CategoryRule"("userId", "matchType", "pattern");
