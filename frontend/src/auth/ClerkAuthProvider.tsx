import React, { useCallback, useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/clerk-expo";
import { authApi, type WagerUser } from "../api/client";
import { AuthContext, type AuthState } from "./AuthContext";

/**
 * The real, Clerk-backed auth provider. Imports @clerk/clerk-expo (which pulls
 * expo-crypto / expo-secure-store native modules), so it is only loaded on the
 * non-bypass path via ClerkApp — never evaluated while the dev bypass is on.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user: clerkUser } = useUser();
  const [wagerUser, setWagerUser] = useState<WagerUser | null>(null);
  const [state, setState] = useState<AuthState>("loading");

  const fetchProfile = useCallback(async () => {
    if (!isSignedIn) {
      setWagerUser(null);
      setState("notSignedIn");
      return;
    }
    if (!clerkUser?.username && !clerkUser?.firstName) {
      setState("needsUsername");
      return;
    }
    try {
      const profile = await authApi.me(getToken);
      setWagerUser(profile);
      setState("ready");
    } catch (err: unknown) {
      const status = err instanceof Error && err.message.includes("403") ? 403 : 0;
      if (status === 403) {
        if (!clerkUser?.username) {
          setState("needsUsername");
        } else {
          setState("needsPhoneVerify");
        }
      } else {
        setState("needsPhoneVerify");
      }
    }
  }, [isSignedIn, clerkUser, getToken]);

  useEffect(() => {
    if (!clerkLoaded) return;
    void fetchProfile();
  }, [clerkLoaded, isSignedIn, fetchProfile]);

  const refreshUser = useCallback(async () => {
    await fetchProfile();
  }, [fetchProfile]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setWagerUser(null);
    setState("notSignedIn");
  }, [signOut]);

  return (
    <AuthContext.Provider
      value={{
        state,
        user: wagerUser,
        getToken,
        signOut: handleSignOut,
        refreshUser,
        isLoaded: clerkLoaded,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
