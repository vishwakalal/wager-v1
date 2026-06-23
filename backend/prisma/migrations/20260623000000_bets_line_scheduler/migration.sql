-- Phase 4: bet creation, blind line setting, and the durable scheduling engine.

CREATE TYPE "BetType" AS ENUM ('NUMERIC', 'BINARY');
CREATE TYPE "BetDuration" AS ENUM ('ONE_DAY', 'ONE_WEEK', 'ONE_MONTH');
CREATE TYPE "BetStatus" AS ENUM (
  'LINE_SETTING', 'LINE_CHALLENGE', 'STAKING', 'ACTIVE',
  'CLOSED', 'RESOLVED', 'VOIDED', 'CANCELLED'
);
CREATE TYPE "JobType" AS ENUM (
  'LINE_CHALLENGE_EXPIRE', 'STAKING_CLOSE', 'STAKING_WARNING',
  'BET_EXPIRE', 'DISPUTE_CLOSE', 'DISPUTE_WARNING'
);
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

CREATE TABLE "bets" (
  "id"              TEXT NOT NULL,
  "circleId"        TEXT NOT NULL,
  "creatorId"       TEXT NOT NULL,
  "type"            "BetType"     NOT NULL,
  "duration"        "BetDuration" NOT NULL,
  "status"          "BetStatus"   NOT NULL DEFAULT 'LINE_SETTING',
  "description"     TEXT NOT NULL,
  "line"            DECIMAL(10, 4),
  "lineRound"       INTEGER NOT NULL DEFAULT 1,
  "lineRevealedAt"  TIMESTAMP(3),
  "challengeEndsAt" TIMESTAMP(3),
  "stakingEndsAt"   TIMESTAMP(3),
  "activeUntil"     TIMESTAMP(3),
  "closedAt"        TIMESTAMP(3),
  "resolvedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bets_circleId_idx"  ON "bets"("circleId");
CREATE INDEX "bets_creatorId_idx" ON "bets"("creatorId");
CREATE INDEX "bets_status_idx"    ON "bets"("status");

ALTER TABLE "bets"
  ADD CONSTRAINT "bets_circleId_fkey"
  FOREIGN KEY ("circleId") REFERENCES "circles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bets"
  ADD CONSTRAINT "bets_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "line_submissions" (
  "id"        TEXT NOT NULL,
  "betId"     TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "value"     DECIMAL(10, 4) NOT NULL,
  "round"     INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "line_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "line_submissions_betId_userId_round_key"
  ON "line_submissions"("betId", "userId", "round");

CREATE INDEX "line_submissions_betId_idx" ON "line_submissions"("betId");

ALTER TABLE "line_submissions"
  ADD CONSTRAINT "line_submissions_betId_fkey"
  FOREIGN KEY ("betId") REFERENCES "bets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "line_submissions"
  ADD CONSTRAINT "line_submissions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "line_dispute_votes" (
  "id"        TEXT NOT NULL,
  "betId"     TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "round"     INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "line_dispute_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "line_dispute_votes_betId_userId_round_key"
  ON "line_dispute_votes"("betId", "userId", "round");

CREATE INDEX "line_dispute_votes_betId_idx" ON "line_dispute_votes"("betId");

ALTER TABLE "line_dispute_votes"
  ADD CONSTRAINT "line_dispute_votes_betId_fkey"
  FOREIGN KEY ("betId") REFERENCES "bets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "line_dispute_votes"
  ADD CONSTRAINT "line_dispute_votes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "scheduled_jobs" (
  "id"        TEXT NOT NULL,
  "type"      "JobType"    NOT NULL,
  "runAt"     TIMESTAMP(3) NOT NULL,
  "payload"   JSONB        NOT NULL,
  "status"    "JobStatus"  NOT NULL DEFAULT 'PENDING',
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scheduled_jobs_status_runAt_idx" ON "scheduled_jobs"("status", "runAt");
