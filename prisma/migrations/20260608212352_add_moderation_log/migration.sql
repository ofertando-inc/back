-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('HIDE_COMMENT', 'DISMISS_COMMENT', 'RESTORE_COMMENT', 'DISABLE_OFFER', 'DISMISS_OFFER', 'RESTORE_OFFER', 'DISABLE_USER', 'RESTORE_USER');

-- CreateEnum
CREATE TYPE "ModerationTargetType" AS ENUM ('COMMENT', 'OFFER', 'USER');

-- CreateTable
CREATE TABLE "moderation_logs" (
    "id" TEXT NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "targetType" "ModerationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "moderation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_logs_createdAt_idx" ON "moderation_logs"("createdAt");

-- CreateIndex
CREATE INDEX "moderation_logs_targetType_targetId_idx" ON "moderation_logs"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "moderation_logs" ADD CONSTRAINT "moderation_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
