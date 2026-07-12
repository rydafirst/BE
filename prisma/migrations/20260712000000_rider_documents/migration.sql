-- Rider onboarding vehicle track
CREATE TABLE "RiderOnboarding" (
    "riderId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiderOnboarding_pkey" PRIMARY KEY ("riderId")
);

-- Rider uploaded documents
CREATE TABLE "RiderDocument" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "issuedAt" BIGINT,
    "expiresAt" BIGINT,
    "version" INTEGER NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiderDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RiderDocument_riderId_idx" ON "RiderDocument"("riderId");
