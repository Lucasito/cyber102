-- AlterTable
ALTER TABLE "QueryLog" ADD COLUMN     "costRub" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "dialogKey" TEXT,
ADD COLUMN     "eventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "latencyMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'ai',
ADD COLUMN     "tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trace" JSONB,
ADD COLUMN     "userKey" TEXT;

-- CreateIndex
CREATE INDEX "QueryLog_userKey_createdAt_idx" ON "QueryLog"("userKey", "createdAt");

-- CreateIndex
CREATE INDEX "QueryLog_dialogKey_idx" ON "QueryLog"("dialogKey");
