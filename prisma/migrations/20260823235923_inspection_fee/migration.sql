-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED');

-- CreateTable
CREATE TABLE "inspection_fees" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 15000,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "phoneNumber" TEXT NOT NULL,
    "status" "FeeStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "failureReason" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "inspection_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inspection_fees_inspectionId_key" ON "inspection_fees"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_fees_providerRef_key" ON "inspection_fees"("providerRef");

-- CreateIndex
CREATE INDEX "inspection_fees_status_idx" ON "inspection_fees"("status");

-- AddForeignKey
ALTER TABLE "inspection_fees" ADD CONSTRAINT "inspection_fees_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_fees" ADD CONSTRAINT "inspection_fees_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
