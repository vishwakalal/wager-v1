const EXPO_PUSH_URL = "https://exp.host/--/expo-push/v2/push/send";

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: "default" | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Send batched Expo push messages (max 100 per request).
 * Errors are logged but not thrown — notifications are best-effort.
 */
export async function sendExpoPushMessages(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;

  for (const batch of chunk(messages, 100)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error(`[ExpoPush] HTTP ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      console.error("[ExpoPush] send error:", err);
    }
  }
}
