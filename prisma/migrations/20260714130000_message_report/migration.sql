-- Moderation: user-submitted reports of abusive/objectionable chat messages (App Store Guideline 1.2).
CREATE TABLE "MessageReport" (
  "id"         TEXT NOT NULL,
  "jobId"      TEXT NOT NULL,
  "messageId"  TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "reason"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessageReport_createdAt_idx" ON "MessageReport"("createdAt");
