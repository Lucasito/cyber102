-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "distinctFrom" TEXT[] DEFAULT ARRAY[]::TEXT[];
