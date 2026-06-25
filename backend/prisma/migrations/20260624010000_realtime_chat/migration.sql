-- Phase 9: invite token table for shareable deep-link join (spec §9, Phase 9)

CREATE TABLE "circle_invite_tokens" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_invite_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "circle_invite_tokens_circleId_key" ON "circle_invite_tokens"("circleId");
CREATE UNIQUE INDEX "circle_invite_tokens_token_key" ON "circle_invite_tokens"("token");
CREATE INDEX "circle_invite_tokens_token_idx" ON "circle_invite_tokens"("token");

ALTER TABLE "circle_invite_tokens" ADD CONSTRAINT "circle_invite_tokens_circleId_fkey"
    FOREIGN KEY ("circleId") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
