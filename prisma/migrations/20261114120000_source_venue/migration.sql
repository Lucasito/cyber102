-- Площадка источника: все события источника проходят в одном здании (театр, музей) — адрес и координаты здесь
ALTER TABLE "Source" ADD COLUMN "venueName" TEXT;
ALTER TABLE "Source" ADD COLUMN "venueAddress" TEXT;
ALTER TABLE "Source" ADD COLUMN "venueLat" DOUBLE PRECISION;
ALTER TABLE "Source" ADD COLUMN "venueLon" DOUBLE PRECISION;
