-- Waiting timer + return-leg linkage for the "recipient unavailable" resolution flow.
ALTER TABLE "Job" ADD COLUMN "waitStartedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "returnOfJobId" TEXT;
-- Separate metered waiting-fee charge (paid by the sender, released 100% to the rider).
ALTER TABLE "Job" ADD COLUMN "waitingTxRef" TEXT;
ALTER TABLE "Job" ADD COLUMN "waitingTxId" TEXT;
ALTER TABLE "Job" ADD COLUMN "waitingFeeMinor" INTEGER;
-- Pre-charged 75% "return insurance" reserve, held in escrow when RETURN is chosen at booking.
ALTER TABLE "Job" ADD COLUMN "returnReserveMinor" INTEGER;
