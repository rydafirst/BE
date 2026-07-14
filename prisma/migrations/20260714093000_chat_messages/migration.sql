-- Rider <-> customer chat, scoped to a single job.
CREATE TABLE "ChatMessage" (
  "id"        TEXT NOT NULL,
  "jobId"     TEXT NOT NULL,
  "senderId"  TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatMessage_jobId_idx" ON "ChatMessage"("jobId");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
