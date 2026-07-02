-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationAction" ADD VALUE 'APPROVE_MERCHANT_CLAIM';
ALTER TYPE "ModerationAction" ADD VALUE 'REJECT_MERCHANT_CLAIM';
ALTER TYPE "ModerationAction" ADD VALUE 'CREATE_ACCOUNT';
ALTER TYPE "ModerationAction" ADD VALUE 'UPDATE_ACCOUNT';

-- AlterEnum
ALTER TYPE "ModerationTargetType" ADD VALUE 'MERCHANT_CLAIM';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ROOT';

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "clickCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "official" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "accountType" "AccountType" NOT NULL DEFAULT 'INDIVIDUAL';

-- CreateTable
CREATE TABLE "merchant_claims" (
    "id" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "reviewedById" TEXT,

    CONSTRAINT "merchant_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_claims_status_idx" ON "merchant_claims"("status");

-- CreateIndex
CREATE INDEX "merchant_claims_userId_idx" ON "merchant_claims"("userId");

-- CreateIndex
CREATE INDEX "merchant_claims_merchantId_idx" ON "merchant_claims"("merchantId");

-- CreateIndex
CREATE INDEX "merchants_ownerId_idx" ON "merchants"("ownerId");

-- AddForeignKey
ALTER TABLE "merchant_claims" ADD CONSTRAINT "merchant_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_claims" ADD CONSTRAINT "merchant_claims_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_claims" ADD CONSTRAINT "merchant_claims_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
