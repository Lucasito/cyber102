-- AlterTable
ALTER TABLE "BotUser" ADD COLUMN     "browse" JSONB;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "city" TEXT,
    "category" TEXT,
    "notifiedUpTo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_botUserId_city_category_key" ON "Subscription"("botUserId", "city", "category");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "BotUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

