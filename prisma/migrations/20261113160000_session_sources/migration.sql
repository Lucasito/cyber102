-- DropIndex
DROP INDEX "EventSource_source_url_key";

-- CreateIndex
CREATE INDEX "EventSource_source_url_idx" ON "EventSource"("source", "url");

-- CreateIndex
CREATE INDEX "EventSource_source_externalId_idx" ON "EventSource"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "EventSource_eventId_source_url_key" ON "EventSource"("eventId", "source", "url");

