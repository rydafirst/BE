-- Add optional delivery details the rider needs: what's being sent + notes/instructions.
-- Additive, nullable columns — safe on existing rows, no backfill required.
ALTER TABLE "Job" ADD COLUMN "item" TEXT;
ALTER TABLE "Job" ADD COLUMN "instructions" TEXT;
