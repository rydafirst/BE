-- Structured guarantor details on the rider onboarding profile. The signed-note photo continues to be
-- captured as the GUARANTOR document upload; these columns hold the typed, searchable details.
ALTER TABLE "RiderOnboarding" ADD COLUMN "guarantorName" TEXT;
ALTER TABLE "RiderOnboarding" ADD COLUMN "guarantorPhone" TEXT;
ALTER TABLE "RiderOnboarding" ADD COLUMN "guarantorAddress" TEXT;
ALTER TABLE "RiderOnboarding" ADD COLUMN "guarantorRelationship" TEXT;
