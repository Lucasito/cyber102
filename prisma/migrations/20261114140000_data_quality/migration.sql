ALTER TABLE "Venue" ADD COLUMN "locationLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "locationVerifiedAt" TIMESTAMP(3), ADD COLUMN "buildingId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Существующие точные адреса сохраняем при последующих сборах. Дату проверки человеком не придумываем.
UPDATE "Venue" SET "locationLocked" = true WHERE "address" IS NOT NULL AND NOT "approx" AND "lat" IS NOT NULL AND "lon" IS NOT NULL;
CREATE TABLE "VenueAlias" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "key" TEXT NOT NULL,
  "city" TEXT NOT NULL, "cityKey" TEXT NOT NULL, "venueId" TEXT NOT NULL,
  CONSTRAINT "VenueAlias_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VenueAlias_key_cityKey_key" ON "VenueAlias"("key", "cityKey");
CREATE INDEX "VenueAlias_venueId_idx" ON "VenueAlias"("venueId");
-- Ключи совпадают с normalizeTitle. Неоднозначные старые названия оставляем для ручного объединения.
CREATE FUNCTION pg_temp.venue_key(value TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT trim(regexp_replace(regexp_replace(replace(lower(value), 'ё', 'е'), '[^[:alnum:][:space:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))
$$;
WITH names AS (
  SELECT id, name, city, pg_temp.venue_key(name) AS key, pg_temp.venue_key(city) AS city_key FROM "Venue"
), unique_names AS (SELECT key, city_key FROM names GROUP BY key, city_key HAVING count(*) = 1)
INSERT INTO "VenueAlias" (id,name,key,city,"cityKey","venueId")
SELECT md5(n.id || n.key || n.city_key),n.name,n.key,n.city,n.city_key,n.id FROM names n JOIN unique_names u USING(key,city_key);
-- Сохраняем исправленные города: повторный импорт старого названия не создаёт дубль в прежнем городе.
INSERT INTO "VenueAlias" (id,name,key,city,"cityKey","venueId")
SELECT DISTINCT ON (pg_temp.venue_key(v.name), pg_temp.venue_key(a.diff->'city'->>0))
  md5(a.id || v.id),v.name,pg_temp.venue_key(v.name),a.diff->'city'->>0,pg_temp.venue_key(a.diff->'city'->>0),v.id
FROM "AuditLog" a JOIN "Venue" v ON a."entityId"=v.id
WHERE a.entity='venue' AND a.diff->'city'->>0 IS NOT NULL AND a.diff->'city'->>0 <> v.city
ORDER BY pg_temp.venue_key(v.name),pg_temp.venue_key(a.diff->'city'->>0),a."createdAt" DESC
ON CONFLICT (key,"cityKey") DO NOTHING;
-- Объединения, выполненные до появления справочника вариантов.
INSERT INTO "VenueAlias" (id,name,key,city,"cityKey","venueId")
SELECT DISTINCT ON (pg_temp.venue_key(a.diff->'record'->0->>'name'), pg_temp.venue_key(a.diff->'record'->0->>'city'))
  md5(a.id || v.id),a.diff->'record'->0->>'name',pg_temp.venue_key(a.diff->'record'->0->>'name'),
  a.diff->'record'->0->>'city',pg_temp.venue_key(a.diff->'record'->0->>'city'),v.id
FROM "AuditLog" a JOIN "Venue" v ON a.diff->'mergedInto'->>1=v.id
WHERE a.entity='venue' AND a.action='merge' AND a.diff->'record'->0->>'name' IS NOT NULL AND a.diff->'record'->0->>'city' IS NOT NULL
ORDER BY pg_temp.venue_key(a.diff->'record'->0->>'name'),pg_temp.venue_key(a.diff->'record'->0->>'city'),a."createdAt" DESC
ON CONFLICT (key,"cityKey") DO NOTHING;
UPDATE "Venue" v SET "locationVerifiedAt"=(SELECT max(a."createdAt") FROM "AuditLog" a WHERE a.entity='venue' AND a."entityId"=v.id AND a.summary LIKE 'По запросу пользователя уточнена площадка%');
CREATE TABLE "DataChange" (
  "id" TEXT NOT NULL PRIMARY KEY, "entity" TEXT NOT NULL, "entityId" TEXT NOT NULL,
  "source" TEXT NOT NULL, "url" TEXT, "before" JSONB NOT NULL, "after" JSONB NOT NULL,
  "fingerprint" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DataChange_fingerprint_key" ON "DataChange"("fingerprint");
CREATE INDEX "DataChange_status_createdAt_idx" ON "DataChange"("status", "createdAt");
CREATE INDEX "DataChange_entity_entityId_idx" ON "DataChange"("entity", "entityId");
ALTER TABLE "SourceItem" ADD COLUMN "contentHash" TEXT, ADD COLUMN "feedHash" TEXT, ADD COLUMN "checkedAt" TIMESTAMP(3);
