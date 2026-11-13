-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "applicationNote" TEXT,
ADD COLUMN     "pendingApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "website" TEXT;
