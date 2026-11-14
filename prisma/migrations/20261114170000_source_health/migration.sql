-- Здоровье источников: число записей последнего сбора, обычный уровень, ошибки подряд и текущая проблема
ALTER TABLE "Source" ADD COLUMN "lastCount" INTEGER;
ALTER TABLE "Source" ADD COLUMN "avgCount" DOUBLE PRECISION;
ALTER TABLE "Source" ADD COLUMN "failStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Source" ADD COLUMN "healthIssue" TEXT;
ALTER TABLE "Source" ADD COLUMN "healthSince" TIMESTAMP(3);
