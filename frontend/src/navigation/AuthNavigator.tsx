import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuthContext } from "../auth/AuthContext";
import type { AuthStackParamList } from "./types";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { UsernameScreen } from "../screens/auth/UsernameScreen";
import { PhoneVerifyScreen } from "../screens/auth/PhoneVerifyScreen";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

/**
 * The signed-out / onboarding stack. LoginScreen imports @clerk/clerk-expo, so
 * this navigator is require()d lazily by RootNavigator only when the user is not
 * "ready" — keeping Clerk out of the dev-bypass path entirely.
 */
export function AuthNavigator() {
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
