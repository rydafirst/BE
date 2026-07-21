-- Append-only per-status timing log. Purely additive: no existing table or column is touched, so a
-- rollback is just dropping this table and existing rows are unaffected.
CREATE TABLE IF NOT EXISTS "JobStatusEvent" (
  "id"     TEXT NOT NULL,
  "jobId"  TEXT NOT NULL,
  "status" "JobStatus" NOT NULL,
  "at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobStatusEvent_pkey" PRIMARY KEY ("id")
);

-- Reads are always "the log for one job, in order".
CREATE INDEX IF NOT EXISTS "JobStatusEvent_jobId_at_idx" ON "JobStatusEvent"("jobId", "at");
