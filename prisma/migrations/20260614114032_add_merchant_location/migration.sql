-- Replace the free-text store fields with Merchant + Location.
-- No data backfill: applied on empty offers tables (prod empty; dev/staging reset).

-- AlterEnum
ALTER TYPE "ModerationAction" ADD VALUE 'VERIFY_MERCHANT';
ALTER TYPE "ModerationAction" ADD VALUE 'VERIFY_LOCATION';
ALTER TYPE "ModerationAction" ADD VALUE 'MERGE_MERCHANT';

-- AlterEnum
ALTER TYPE "ModerationTargetType" ADD VALUE 'MERCHANT';
ALTER TYPE "ModerationTargetType" ADD VALUE 'LOCATION';

-- AlterTable
ALTER TABLE "offers" DROP COLUMN "storeName",
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "merchantId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchants_nameNormalized_idx" ON "merchants"("nameNormalized");

-- CreateIndex
CREATE INDEX "locations_merchantId_idx" ON "locations"("merchantId");

-- CreateIndex
CREATE INDEX "locations_latitude_longitude_idx" ON "locations"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "offers_merchantId_idx" ON "offers"("merchantId");

-- CreateIndex
CREATE INDEX "offers_locationId_idx" ON "offers"("locationId");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
