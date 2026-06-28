/**
 * Dev-only auth bypass. When EXPO_PUBLIC_DEV_USER_ID is set, the app skips
 * Clerk entirely and authenticates every API call as that user via the
 * `x-user-id` header — which the backend honours only in non-production
 * (see backend ClerkAuthGuard). This lets us run/iterate on screens without a
 * Clerk account. Leave the var unset (or remove it) to use the real Clerk flow.
 */
export const DEV_USER_ID: string | null =
  process.env.EXPO_PUBLIC_DEV_USER_ID && process.env.EXPO_PUBLIC_DEV_USER_ID.length > 0
    ? process.env.EXPO_PUBLIC_DEV_USER_ID
    : null;

export const IS_DEV_BYPASS = DEV_USER_ID !== null;
