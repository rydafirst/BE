-- #4 MULTI-STOP DELIVERIES — one pickup, several ordered drop-offs in a single booking.
-- Additive & least-breaking: single-stop deliveries leave both new columns NULL and are unchanged.

-- New job status for the multi-stop tail: the primary drop-off is delivered and the rider is en route
-- to the remaining stops. Escrow is NOT released until the final stop is confirmed. Idempotent.
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'EN_ROUTE_STOP';

-- The ordered extra drop-offs (recipient, hashed per-stop code, PENDING/DELIVERED status) as JSON,
-- and the timestamp the primary drop-off was delivered on a multi-stop job.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "extraStops" JSONB;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "primaryStopDeliveredAt" TIMESTAMP(3);
