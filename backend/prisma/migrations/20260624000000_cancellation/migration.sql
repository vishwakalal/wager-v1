-- Phase 8: cancellation votes table

CREATE TABLE "cancellation_votes" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cancellation_votes_betId_userId_key" ON "cancellation_votes"("betId", "userId");
CREATE INDEX "cancellation_votes_betId_idx" ON "cancellation_votes"("betId");

ALTER TABLE "cancellation_votes" ADD CONSTRAINT "cancellation_votes_betId_fkey"
    FOREIGN KEY ("betId") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cancellation_votes" ADD CONSTRAINT "cancellation_votes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
