-- Split the platform fee out of the fare and track rider-payout completion so a failed
-- transfer never strands a delivery (the payout can be retried).
ALTER TABLE "Job" ADD COLUMN "platformFeeMinor" INTEGER;
ALTER TABLE "Job" ADD COLUMN "payoutPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "payoutError" TEXT;
ALTER TABLE "Job" ADD COLUMN "payoutRef" TEXT;
