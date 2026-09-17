-- Rider reliability: strikes, late reports, and suspension end-times.
CREATE TABLE IF NOT EXISTS "RiderStrike" (
  "id" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiderStrike_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RiderStrike_riderId_idx" ON "RiderStrike"("riderId");

CREATE TABLE IF NOT EXISTS "LateReport" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "verdict" TEXT NOT NULL,
  "actualSec" INTEGER NOT NULL,
  "staticEtaSec" INTEGER NOT NULL,
  "trafficAwareSec" INTEGER,
  "deliveryFeeMinor" INTEGER NOT NULL,
  "forfeitMinor" INTEGER,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LateReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LateReport_status_idx" ON "LateReport"("status");
CREATE INDEX IF NOT EXISTS "LateReport_riderId_idx" ON "LateReport"("riderId");

CREATE TABLE IF NOT EXISTS "RiderReliability" (
  "riderId" TEXT NOT NULL,
  "suspendedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiderReliability_pkey" PRIMARY KEY ("riderId")
);
