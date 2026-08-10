CREATE TABLE "RealEstateOwner" (
    "id" TEXT NOT NULL,
    "realEstateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealEstateOwner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RealEstateOwner_realEstateId_userId_key" ON "RealEstateOwner"("realEstateId", "userId");

CREATE INDEX "RealEstateOwner_userId_idx" ON "RealEstateOwner"("userId");

ALTER TABLE "RealEstateOwner" ADD CONSTRAINT "RealEstateOwner_realEstateId_fkey"
FOREIGN KEY ("realEstateId") REFERENCES "RealEstate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RealEstateOwner" ADD CONSTRAINT "RealEstateOwner_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "RealEstateOwner" ("id", "realEstateId", "userId", "sharePercent", "createdAt")
SELECT 'reo_' || substr(md5("id"), 1, 20), "id", "userId", 100.00, CURRENT_TIMESTAMP
FROM "RealEstate"
ON CONFLICT ("realEstateId", "userId") DO NOTHING;
