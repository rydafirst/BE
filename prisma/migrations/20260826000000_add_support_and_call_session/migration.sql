-- Adds the tables that were added to schema.prisma but never got a migration file, so they were
-- missing in production and every request that touched them returned 500:
--   * SupportThread / SupportMessage  (launch #5/#6 support chat)
--   * CallSession                      (masked in-app calling)
-- Guarded with IF NOT EXISTS so it is safe to (re)apply even if a table was created out of band.

-- CreateTable: SupportThread
CREATE TABLE IF NOT EXISTS "SupportThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "agentId" TEXT,
    "agentJoinDeadline" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportThread_userId_idx" ON "SupportThread"("userId");
CREATE INDEX IF NOT EXISTS "SupportThread_status_idx" ON "SupportThread"("status");

-- CreateTable: SupportMessage
CREATE TABLE IF NOT EXISTS "SupportMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "senderId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportMessage_threadId_idx" ON "SupportMessage"("threadId");

-- CreateTable: CallSession
CREATE TABLE IF NOT EXISTS "CallSession" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "initiatorUserId" TEXT NOT NULL,
    "counterpartyUserId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER,
    "costAmount" TEXT,
    "costCurrency" TEXT,
    CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CallSession_providerRef_idx" ON "CallSession"("providerRef");
CREATE INDEX IF NOT EXISTS "CallSession_jobId_idx" ON "CallSession"("jobId");
