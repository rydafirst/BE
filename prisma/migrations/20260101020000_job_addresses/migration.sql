-- Store the human-readable pickup/drop-off address labels from the booking search,
-- so the rider (and customer) see a street address, not just coordinates.
-- Additive, nullable columns — safe on existing rows.
ALTER TABLE "Job" ADD COLUMN "pickupAddress" TEXT;
ALTER TABLE "Job" ADD COLUMN "dropoffAddress" TEXT;
