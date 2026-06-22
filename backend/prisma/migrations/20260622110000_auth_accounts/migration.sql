-- Phase 2: expand users table for Clerk auth + phone OTP (spec §9).
--
-- All existing rows are dev test stubs from the Phase 0-1 /dev/users endpoint
-- (random phone numbers, no clerkId). Real users arrive via Clerk from Phase 2 onward.
-- Clean them up so we can enforce NOT NULL on clerkId without a backfill.

DELETE FROM "ledger_entries" WHERE "walletId" IN (
  SELECT id FROM "wallets" WHERE "kind" = 'USER'
);
DELETE FROM "wallets" WHERE "kind" = 'USER';
DELETE FROM "users";

-- Expand the schema.
ALTER TABLE "users"
  ADD COLUMN "clerkId"         TEXT,
  ADD COLUMN "displayName"     TEXT,
  ALTER COLUMN "phone"         DROP NOT NULL,
  ADD COLUMN "phoneVerified"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt"       TIMESTAMP(3);

-- Table is empty, so enforce NOT NULL + UNIQUE on clerkId now.
ALTER TABLE "users" ALTER COLUMN "clerkId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");
