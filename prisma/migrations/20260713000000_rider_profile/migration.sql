-- Rider onboarding gains identity + vehicle details; track becomes optional.
ALTER TABLE "RiderOnboarding" ALTER COLUMN "track" DROP NOT NULL;
ALTER TABLE "RiderOnboarding" ADD COLUMN "legalName" TEXT;
ALTER TABLE "RiderOnboarding" ADD COLUMN "nameVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RiderOnboarding" ADD COLUMN "vehiclePlate" TEXT;
ALTER TABLE "RiderOnboarding" ADD COLUMN "vehicleColor" TEXT;
