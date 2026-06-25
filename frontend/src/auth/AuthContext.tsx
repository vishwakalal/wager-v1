import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/clerk-expo";
import { authApi, type WagerUser } from "../api/client";

type AuthState = "loading" | "notSignedIn" | "needsUsername" | "needsPhoneVerify" | "ready";

interface AuthContextValue {
  state: AuthState;
  user: WagerUser | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isLoaded: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used inside AuthProvider");
  return ctx;
}
