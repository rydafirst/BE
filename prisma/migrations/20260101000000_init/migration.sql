-- Rydafirst initial schema. Generated to match prisma/schema.prisma exactly.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'RIDER', 'ADMIN');
CREATE TYPE "JobType" AS ENUM ('DELIVERY', 'RIDE');
CREATE TYPE "KycStatus" AS ENUM ('UNSUBMITTED', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW', 'RESOLVED');
CREATE TYPE "LedgerAccount" AS ENUM ('EXTERNAL', 'ESCROW', 'RIDER_PAYABLE', 'CUSTOMER_REFUND', 'PLATFORM_FEE');
CREATE TYPE "Direction" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "CodeKind" AS ENUM ('DELIVERY', 'START_PIN', 'PROXY');
CREATE TYPE "JobStatus" AS ENUM ('CREATED', 'FUNDED', 'SEARCHING', 'ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE', 'COMPLETED', 'RELEASED', 'CANCELLED', 'FAILED_ATTEMPT', 'DISPUTED', 'DISPUTE_RESOLVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Rider" (
    "userId" TEXT NOT NULL,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "ninVerified" BOOLEAN NOT NULL DEFAULT false,
    "bvnVerified" BOOLEAN NOT NULL DEFAULT false,
    "idDocUploaded" BOOLEAN NOT NULL DEFAULT false,
    "selfieMatched" BOOLEAN NOT NULL DEFAULT false,
    "addressProvided" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "vehicleType" TEXT,
    "vehiclePlate" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "banned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Otp" (
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("phone")
);

CREATE TABLE "RefreshToken" (
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rotated" BOOLEAN NOT NULL DEFAULT false,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("tokenHash")
);

CREATE TABLE "IdentityBlocklist" (
    "id" TEXT NOT NULL,
    "ninHash" TEXT,
    "bvnHash" TEXT,
    "deviceHash" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityBlocklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'CREATED',
    "customerId" TEXT NOT NULL,
    "riderId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "refundAccountId" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "fallbackPolicy" TEXT,
    "flwTxRef" TEXT,
    "flwTxId" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT,
    "payload" JSONB,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "direction" "Direction" NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EscrowTransaction" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "WebhookInbox" (
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("eventId")
);

CREATE TABLE "ConfirmationCode" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "CodeKind" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfirmationCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "openedBy" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "tier" TEXT NOT NULL,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
CREATE UNIQUE INDEX "IdentityBlocklist_ninHash_key" ON "IdentityBlocklist"("ninHash");
CREATE UNIQUE INDEX "IdentityBlocklist_bvnHash_key" ON "IdentityBlocklist"("bvnHash");
CREATE UNIQUE INDEX "Job_flwTxRef_key" ON "Job"("flwTxRef");
CREATE INDEX "Job_status_idx" ON "Job"("status");
CREATE INDEX "Job_customerId_idx" ON "Job"("customerId");
CREATE INDEX "Job_riderId_idx" ON "Job"("riderId");
CREATE INDEX "JobEvent_jobId_idx" ON "JobEvent"("jobId");
CREATE INDEX "LedgerEntry_jobId_idx" ON "LedgerEntry"("jobId");
CREATE INDEX "LedgerEntry_account_idx" ON "LedgerEntry"("account");
CREATE UNIQUE INDEX "EscrowTransaction_idempotencyKey_key" ON "EscrowTransaction"("idempotencyKey");
CREATE INDEX "EscrowTransaction_jobId_idx" ON "EscrowTransaction"("jobId");
CREATE UNIQUE INDEX "ConfirmationCode_jobId_kind_key" ON "ConfirmationCode"("jobId", "kind");
CREATE INDEX "Dispute_jobId_idx" ON "Dispute"("jobId");
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EscrowTransaction" ADD CONSTRAINT "EscrowTransaction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfirmationCode" ADD CONSTRAINT "ConfirmationCode_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
