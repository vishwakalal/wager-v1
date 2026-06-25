-- Phase 10: push tokens + notification preference matrix

CREATE TYPE "NotificationTrigger" AS ENUM (
    'BET_LINE_OPEN', 'BET_LINE_REVEALED', 'BET_STAKING_OPEN', 'BET_STAKING_WARNING',
    'BET_STAKING_CLOSED', 'BET_ACTIVE', 'BET_EXPIRED', 'BET_DISPUTE_WARNING',
    'BET_RESOLVED_WON', 'BET_RESOLVED_LOST', 'BET_VOIDED',
    'VERIFICATION_NEEDED', 'VERIFICATION_TIEBREAKER', 'VERIFICATION_APPROVED', 'VERIFICATION_DENIED',
    'DISPUTE_RAISED', 'DISPUTE_RESOLVED_ADDED', 'DISPUTE_RESOLVED_REMOVED',
    'CIRCLE_JOIN_REQUEST', 'CIRCLE_APPROVED', 'CIRCLE_BET_CREATED', 'CIRCLE_MEMBER_JOINED',
    'PAYMENT_DEPOSIT', 'PAYMENT_WITHDRAWAL_INITIATED', 'PAYMENT_WITHDRAWAL_COMPLETED', 'PAYMENT_PAYOUT'
);

CREATE TABLE "push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");
CREATE INDEX "push_tokens_userId_idx" ON "push_tokens"("userId");

ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" "NotificationTrigger" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_userId_trigger_key"
    ON "notification_preferences"("userId", "trigger");
CREATE INDEX "notification_preferences_userId_idx" ON "notification_preferences"("userId");

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
