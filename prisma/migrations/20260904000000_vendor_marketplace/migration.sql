-- Vendor marketplace: registered shops + their products.
DO $$ BEGIN
  CREATE TYPE "VendorStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "Vendor" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "rcNumber" TEXT,
  "category" TEXT,
  "area" TEXT,
  "description" TEXT,
  "logoKey" TEXT,
  "status" "VendorStatus" NOT NULL DEFAULT 'PENDING',
  "bankCode" TEXT,
  "accountNumber" TEXT,
  "accountName" TEXT,
  "accountVerified" BOOLEAN NOT NULL DEFAULT false,
  "rejectionReason" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_ownerUserId_key" ON "Vendor"("ownerUserId");
CREATE INDEX IF NOT EXISTS "Vendor_status_idx" ON "Vendor"("status");

CREATE TABLE IF NOT EXISTS "Product" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "description" TEXT,
  "photoKeys" TEXT[],
  "available" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Product_vendorId_idx" ON "Product"("vendorId");

DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
