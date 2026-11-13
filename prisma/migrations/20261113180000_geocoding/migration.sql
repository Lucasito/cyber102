-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "geocodedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GeoCache" (
    "query" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "region" TEXT,
    "display" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoCache_pkey" PRIMARY KEY ("query")
);

