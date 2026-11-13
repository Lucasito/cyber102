-- Пользователи ботов: platform + externalId вместо maxUserId (существующие — пользователи MAX)
ALTER TABLE "BotUser" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'max';
ALTER TABLE "BotUser" ADD COLUMN "externalId" TEXT;
ALTER TABLE "BotUser" ADD COLUMN "messages" INTEGER NOT NULL DEFAULT 0;
UPDATE "BotUser" SET "externalId" = "maxUserId";
ALTER TABLE "BotUser" ALTER COLUMN "externalId" SET NOT NULL;
ALTER TABLE "BotUser" ALTER COLUMN "platform" DROP DEFAULT;
DROP INDEX "BotUser_maxUserId_key";
ALTER TABLE "BotUser" DROP COLUMN "maxUserId";
CREATE UNIQUE INDEX "BotUser_platform_externalId_key" ON "BotUser"("platform", "externalId");

-- Настройки из админки
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);
