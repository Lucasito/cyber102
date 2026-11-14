CREATE TABLE "EventWatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "botUserId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "lastState" JSONB NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventWatch_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "BotUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventWatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventWatch_botUserId_eventId_key" ON "EventWatch"("botUserId","eventId");
CREATE INDEX "EventWatch_checkedAt_idx" ON "EventWatch"("checkedAt");
CREATE INDEX "EventWatch_eventId_idx" ON "EventWatch"("eventId");
