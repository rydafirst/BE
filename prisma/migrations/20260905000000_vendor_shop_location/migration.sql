-- Vendor shop location: used to price vendor→customer delivery on marketplace orders.
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "shopLat" DOUBLE PRECISION;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "shopLng" DOUBLE PRECISION;
