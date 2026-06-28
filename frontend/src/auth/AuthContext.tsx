import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authApi, type WagerUser } from "../api/client";

export type AuthState =
  | "loading"
  | "notSignedIn"
  | "needsUsername"
  | "needsPhoneVerify"
  | "ready";

export interface AuthContextValue {
  state: AuthState;
  user: WagerUser | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isLoaded: boolean;
}

/**
 * Shared auth context. The real (Clerk) provider lives in ./ClerkAuthProvider
 * and is loaded only when the dev bypass is OFF, so this file stays free of any
 * Clerk / expo-crypto imports and can be used by the dev path safely.
 */
export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Dev-only provider used when EXPO_PUBLIC_DEV_USER_ID is set. Bypasses Clerk
 * entirely: it just fetches /auth/me (the API client attaches the x-user-id
 * header) and reports "ready". Shares the same AuthContext so every screen's
 * useAuthContext() works identically to the real (Clerk) provider.
 */
export function DevAuthProvider({ children }: { children: React.ReactNode }) {
  const [wagerUser, setWagerUser] = useState<WagerUser | null>(null);
  const [state, setState] = useState<AuthState>("loading");

  const fetchProfile = useCallback(async () => {
    try {
      const profile = await authApi.me(async () => null);
      setWagerUser(profile);
      setState("ready");
    } catch {
      setWagerUser(null);
      setState("notSignedIn");
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  return (
    <AuthContext.Provider
      value={{
        state,
        user: wagerUser,
        getToken: async () => null,
        signOut: async () => {},
        refreshUser: fetchProfile,
        isLoaded: true,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used inside AuthProvider");
  return ctx;
}
