-- Coarse neighbourhood (e.g. "Ikeja") captured from the booking search, shown in the
-- pre-accept rider feed instead of the state or coordinates. Additive, nullable, safe.
ALTER TABLE "Job" ADD COLUMN "pickupArea" TEXT;
ALTER TABLE "Job" ADD COLUMN "dropoffArea" TEXT;
