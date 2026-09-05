-- ERRAND ("buy-for-me"): goods amount + store + captured vendor account, stored as JSON on the job.
-- Nullable, so existing rows are unaffected — safe add.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "errand" JSONB;
