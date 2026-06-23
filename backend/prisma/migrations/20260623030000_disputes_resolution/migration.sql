-- Phase 7: disputes, resolution, and winSide on bets.

-- winSide records which side won at resolution (null = voided).
ALTER TABLE "bets" ADD COLUMN "winSide" "StakeSide";

CREATE TYPE "DisputeType"   AS ENUM ('ADD', 'REMOVE');
CREATE TYPE "DisputeStatus" AS ENUM ('PENDING', 'CONFIRMED');

CREATE TABLE "disputes" (
  "id"            TEXT NOT NULL,
  "betId"         TEXT NOT NULL,
  "initiatorId"   TEXT NOT NULL,
  "type"          "DisputeType"   NOT NULL,
  "targetEventId" TEXT,
  "description"   TEXT NOT NULL,
  "status"        "DisputeStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "disputes_betId_idx" ON "disputes"("betId");

ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_betId_fkey"
  FOREIGN KEY ("betId") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_initiatorId_fkey"
  FOREIGN KEY ("initiatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_targetEventId_fkey"
  FOREIGN KEY ("targetEventId") REFERENCES "verification_events"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "dispute_votes" (
  "id"        TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "inFavor"   BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispute_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispute_votes_disputeId_userId_key"
  ON "dispute_votes"("disputeId", "userId");

CREATE INDEX "dispute_votes_disputeId_idx" ON "dispute_votes"("disputeId");

ALTER TABLE "dispute_votes"
  ADD CONSTRAINT "dispute_votes_disputeId_fkey"
  FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dispute_votes"
  ADD CONSTRAINT "dispute_votes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
