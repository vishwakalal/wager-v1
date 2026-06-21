import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE_URL } from "./src/config/api";
import { colors } from "./src/theme";

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; service: string; timestamp: string }
  | { kind: "error"; message: string };

/**
 * Phase 0 placeholder screen: confirms the mobile app renders with the design
 * tokens and can reach the NestJS API. Replaced by the 4-tab app in Phase 11.
 */
export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

  const checkHealth = useCallback(async () => {
    setHealth({ kind: "loading" });
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { service: string; timestamp: string };
      setHealth({ kind: "ok", service: body.service, timestamp: body.timestamp });
    } catch (err) {
      setHealth({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Wager</Text>
      <Text style={styles.subtitle}>social prediction markets for friends</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>API connection</Text>
        {health.kind === "loading" && <ActivityIndicator color={colors.accent} />}
        {health.kind === "ok" && (
          <>
            <Text style={styles.ok}>● connected</Text>
            <Text style={styles.detail}>{health.service}</Text>
          </>
        )}
        {health.kind === "error" && (
          <>
            <Text style={styles.error}>● unreachable</Text>
            <Text style={styles.detail}>{health.message}</Text>
            <Text style={styles.hint}>{API_BASE_URL}</Text>
          </>
        )}
      </View>

      <Pressable style={styles.button} onPress={() => void checkHealth()}>
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  brand: {
    color: colors.accent,
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
    marginBottom: 40,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    gap: 6,
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  ok: { color: colors.statusActive, fontSize: 18, fontWeight: "700" },
  error: { color: colors.statusDispute, fontSize: 18, fontWeight: "700" },
  detail: { color: colors.text, fontSize: 14 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  button: {
    marginTop: 28,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 999,
  },
  buttonText: { color: colors.background, fontWeight: "700", fontSize: 16 },
});
