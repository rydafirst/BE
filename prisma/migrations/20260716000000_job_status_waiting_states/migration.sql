-- Add the WAITING and AWAITING_RESOLUTION states to the JobStatus enum.
-- These were introduced with the "recipient unavailable" waiting/return flow
-- (migration 20260714090000_job_wait_return added the columns but not the enum values,
-- which broke `prisma generate` / the production build). Idempotent + safe to re-run.
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'WAITING';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'AWAITING_RESOLUTION';
