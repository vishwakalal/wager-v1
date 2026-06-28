import { ClerkProvider } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { NavigationContainer, type LinkingOptions } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./auth/ClerkAuthProvider";
import { RootNavigator } from "./navigation/RootNavigator";
import type { RootStackParamList } from "./navigation/types";
import { colors } from "./theme";

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Deep-link config. `wager://` is the app scheme (app.json). Invite links of
 * the form wager://join/{token} are also handled imperatively by useInviteLink,
 * but registering the scheme here lets the app cold-start from a link.
 */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["wager://"],
  config: { screens: {} },
};

/**
 * The real, Clerk-backed app. Kept in its own module so it (and its native
 * dependencies — expo-secure-store / expo-crypto via Clerk's tokenCache) is
 * only evaluated when the dev bypass is OFF. App.tsx require()s this lazily.
 */
export default function ClerkApp() {
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Wager</Text>
        <Text style={styles.fallbackText}>
          Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Copy frontend/.env.example to
          frontend/.env and set your Clerk key, then restart Expo.
        </Text>
      </View>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <SafeAreaProvider>
        <AuthProvider>
          <NavigationContainer linking={linking}>
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  fallbackTitle: { color: colors.accent, fontSize: 40, fontWeight: "800" },
  fallbackText: { color: colors.textMuted, fontSize: 15, textAlign: "center", lineHeight: 22 },
});
