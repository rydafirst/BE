-- Errand ("buy-for-me") job type. Adding an enum value is additive and safe for existing rows.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ERRAND';
