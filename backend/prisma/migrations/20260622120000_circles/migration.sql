-- Phase 3: circles + membership (spec §2.1).

CREATE TYPE "MemberRole" AS ENUM ('CREATOR', 'MEMBER');
CREATE TYPE "MemberStatus" AS ENUM ('PENDING', 'APPROVED');

CREATE TABLE "circles" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "circles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "circle_memberships" (
  "id"        TEXT NOT NULL,
  "circleId"  TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "role"      "MemberRole"   NOT NULL DEFAULT 'MEMBER',
  "status"    "MemberStatus" NOT NULL DEFAULT 'PENDING',
  "joinedAt"  TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "circle_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "circle_memberships_circleId_userId_key"
  ON "circle_memberships"("circleId", "userId");

CREATE INDEX "circle_memberships_userId_idx"
  ON "circle_memberships"("userId");

ALTER TABLE "circle_memberships"
  ADD CONSTRAINT "circle_memberships_circleId_fkey"
  FOREIGN KEY ("circleId") REFERENCES "circles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "circle_memberships"
  ADD CONSTRAINT "circle_memberships_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
