-- The original Document model used one relatedEntityId column with several
-- foreign keys to different entity tables. That makes a polymorphic attachment
-- impossible because one id would have to exist in every target table.
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "doc_transaction";
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "doc_insurance";
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "doc_fd";
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "doc_gold";
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "doc_realestate";

CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CategoryRule_userId_keyword_key" ON "CategoryRule"("userId", "keyword");
CREATE INDEX "CategoryRule_userId_idx" ON "CategoryRule"("userId");
CREATE INDEX "CategoryRule_categoryId_idx" ON "CategoryRule"("categoryId");

ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
