-- Marketplace/errand money core: a VENDOR_PAYABLE ledger account so goods-money can be released to a
-- vendor (never the rider). Adding an enum value is additive and safe for existing rows.
ALTER TYPE "LedgerAccount" ADD VALUE IF NOT EXISTS 'VENDOR_PAYABLE';
