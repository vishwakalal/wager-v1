-- Add unique username to users. Nullable — set during onboarding before full activation.

ALTER TABLE "users" ADD COLUMN "username" TEXT;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
