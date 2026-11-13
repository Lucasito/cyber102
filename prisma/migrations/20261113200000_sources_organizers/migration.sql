-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'ORGANIZER';

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "organization" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "createdById" TEXT;

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "adapter" TEXT,
    "city" TEXT,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalHours" INTEGER NOT NULL DEFAULT 6,
    "maxItems" INTEGER NOT NULL DEFAULT 20,
    "note" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastMessage" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "link" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_code_key" ON "Source"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SourceItem_sourceId_guid_key" ON "SourceItem"("sourceId", "guid");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceItem" ADD CONSTRAINT "SourceItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
