-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "approx" BOOLEAN NOT NULL DEFAULT false;

-- Площадки без координат — искать заново по новой схеме (варианты названия, затем центр города с пометкой)
UPDATE "Venue" SET "geocodedAt" = NULL WHERE "lat" IS NULL;
