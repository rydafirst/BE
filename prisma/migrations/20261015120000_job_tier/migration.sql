-- Express/Economy delivery speed tier.
ALTER TABLE "Job" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'EXPRESS';
