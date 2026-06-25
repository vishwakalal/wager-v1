import { useEffect, useState } from "react";
import * as Linking from "expo-linking";
import { API_BASE_URL } from "../config/api";

type JoinState =
  | { kind: "idle" }
  | { kind: "joining"; token: string }
  | { kind: "joined"; circleId: string }
  | { kind: "error"; message: string };

/**
 * Watches for incoming wager://join/{token} deep links and auto-calls the
 * join endpoint with the caller's auth token.
 *
 * Pass `authToken` (Clerk session JWT) so the API call is authenticated.
 * Returns the current join state so the UI can react.
 */
export function useInviteLink(authToken: string | null) {
  const [state, setState] = useState<JoinState>({ kind: "idle" });

  async function consumeToken(token: string) {
    setState({ kind: "joining", token });
    try {
      const res = await fetch(`${API_BASE_URL}/circles/join/${token}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const membership = (await res.json()) as { circleId: string };
      setState({ kind: "joined", circleId: membership.circleId });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  useEffect(() => {
    // Handle link that launched the app cold
    void Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Handle link while app is already running
    const sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [authToken]); // re-run if the auth token becomes available

  function handleUrl(url: string) {
    const parsed = Linking.parse(url);
    // Matches wager://join/{token}
    if (parsed.scheme === "wager" && parsed.hostname === "join" && parsed.path) {
      const token = parsed.path.replace(/^\//, "");
      if (token) void consumeToken(token);
    }
  }

  return state;
}
