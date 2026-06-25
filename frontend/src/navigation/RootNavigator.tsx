import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuthContext } from "../auth/AuthContext";
import { colors } from "../theme";
import type { RootStackParamList, AuthStackParamList } from "./types";
import { TabNavigator } from "./TabNavigator";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { UsernameScreen } from "../screens/auth/UsernameScreen";
import { PhoneVerifyScreen } from "../screens/auth/PhoneVerifyScreen";

const Root = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();

function AuthNavigator() {
  const { state } = useAuthContext();
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      {state === "needsUsername" ? (
        <>
          <AuthStack.Screen name="Username" component={UsernameScreen} />
          <AuthStack.Screen name="PhoneVerify" component={PhoneVerifyScreen} />
          <AuthStack.Screen name="Login" component={LoginScreen} />
        </>
      ) : state === "needsPhoneVerify" ? (
        <>
          <AuthStack.Screen name="PhoneVerify" component={PhoneVerifyScreen} />
          <AuthStack.Screen name="Login" component={LoginScreen} />
          <AuthStack.Screen name="Username" component={UsernameScreen} />
        </>
      ) : (
        <>
          <AuthStack.Screen name="Login" component={LoginScreen} />
          <AuthStack.Screen name="Username" component={UsernameScreen} />
          <AuthStack.Screen name="PhoneVerify" component={PhoneVerifyScreen} />
        </>
      )}
    </AuthStack.Navigator>
  );
}

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
