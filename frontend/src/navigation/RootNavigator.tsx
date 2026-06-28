import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuthContext } from "../auth/AuthContext";
import { colors } from "../theme";
import type { RootStackParamList } from "./types";
import { TabNavigator } from "./TabNavigator";

const Root = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { state } = useAuthContext();

  if (state === "loading") {
    return (
      <View style={styles.splash}>
        <Text style={styles.brand}>Wager</Text>
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      </View>
    );
  }

  // AuthNavigator imports the Clerk-based LoginScreen; require it lazily so the
  // dev-bypass path (which is always "ready") never evaluates @clerk/clerk-expo.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AuthNavigator = state === "ready" ? null : require("./AuthNavigator").AuthNavigator;

  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      {state === "ready" ? (
        <Root.Screen name="Main" component={TabNavigator} />
      ) : (
        <Root.Screen name="Auth" component={AuthNavigator} />
      )}
    </Root.Navigator>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    color: colors.accent,
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: -1,
  },
  spinner: {
    marginTop: 24,
  },
});
