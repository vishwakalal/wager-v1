-- Phase 5: stake table for the upfront staking window (spec §4).

CREATE TYPE "StakeSide" AS ENUM ('OVER', 'UNDER', 'YES', 'NO');

CREATE TABLE "stakes" (
  "id"              TEXT NOT NULL,
  "betId"           TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "side"            "StakeSide" NOT NULL,
  "amount"          INTEGER NOT NULL,
  "effectiveAmount" INTEGER,
  "refundAmount"    INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stakes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stakes_betId_userId_key" ON "stakes"("betId", "userId");
CREATE INDEX "stakes_betId_idx" ON "stakes"("betId");

ALTER TABLE "stakes"
  ADD CONSTRAINT "stakes_betId_fkey"
  FOREIGN KEY ("betId") REFERENCES "bets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stakes"
  ADD CONSTRAINT "stakes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
