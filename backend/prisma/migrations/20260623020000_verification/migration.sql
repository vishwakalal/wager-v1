-- Phase 6: verification events, voting, and tiebreaker scheduling (spec §6).

CREATE TYPE "VerificationStatus" AS ENUM (
  'PENDING_VOTE', 'TIEBREAKER', 'VERIFIED', 'DENIED'
);

CREATE TYPE "VoteChoice" AS ENUM ('VERIFY', 'DENY');

-- Add the tiebreaker expire job type to the existing enum.
ALTER TYPE "JobType" ADD VALUE 'VERIFICATION_TIEBREAKER_EXPIRE'
  AFTER 'STAKING_WARNING';

CREATE TABLE "verification_events" (
  "id"               TEXT NOT NULL,
  "betId"            TEXT NOT NULL,
  "submitterId"      TEXT NOT NULL,
  "description"      TEXT NOT NULL,
  "numericValue"     DECIMAL(10, 4),
  "status"           "VerificationStatus" NOT NULL DEFAULT 'PENDING_VOTE',
  "tiebreakerEndsAt" TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verification_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verification_events_betId_idx" ON "verification_events"("betId");

ALTER TABLE "verification_events"
  ADD CONSTRAINT "verification_events_betId_fkey"
  FOREIGN KEY ("betId") REFERENCES "bets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "verification_events"
  ADD CONSTRAINT "verification_events_submitterId_fkey"
  FOREIGN KEY ("submitterId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "verification_votes" (
  "id"                  TEXT NOT NULL,
  "verificationEventId" TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "choice"              "VoteChoice" NOT NULL,
  "round"               INTEGER NOT NULL DEFAULT 1,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verification_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "verification_votes_eventId_userId_round_key"
  ON "verification_votes"("verificationEventId", "userId", "round");

CREATE INDEX "verification_votes_eventId_idx"
  ON "verification_votes"("verificationEventId");

ALTER TABLE "verification_votes"
  ADD CONSTRAINT "verification_votes_eventId_fkey"
  FOREIGN KEY ("verificationEventId") REFERENCES "verification_events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "verification_votes"
  ADD CONSTRAINT "verification_votes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
