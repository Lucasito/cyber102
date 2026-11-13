-- CreateEnum
CREATE TYPE "Publication" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MANUAL', 'IMPORT', 'RSS', 'API', 'PAGE');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "durationMin" INTEGER,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "normalizedTitle" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "orgUrl" TEXT,
ADD COLUMN     "originalStartsAt" TIMESTAMP(3),
ADD COLUMN     "publication" "Publication" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EventSource" ADD COLUMN     "sourceHash" TEXT,
ADD COLUMN     "sourceType" "SourceType" NOT NULL DEFAULT 'IMPORT';

-- CreateTable
CREATE TABLE "RawRecord" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "importId" TEXT,
    "eventId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL,
    "userLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userLogin" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawRecord_eventId_idx" ON "RawRecord"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "RawRecord_source_hash_key" ON "RawRecord"("source", "hash");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Event_publication_needsReview_idx" ON "Event"("publication", "needsReview");

-- AddForeignKey
ALTER TABLE "RawRecord" ADD CONSTRAINT "RawRecord_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Нормализованное название для уже загруженных событий (дальше его считает код: lib/server/normalize.ts)
UPDATE "Event" SET "normalizedTitle" = trim(regexp_replace(replace(lower("title"), 'ё', 'е'), '[^[:alnum:][:space:]]+', ' ', 'g'));
