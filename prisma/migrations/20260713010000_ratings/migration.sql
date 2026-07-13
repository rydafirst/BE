CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Rating_jobId_key" ON "Rating"("jobId");
CREATE INDEX "Rating_riderId_idx" ON "Rating"("riderId");
