import { NavigationContainer, type LinkingOptions } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DevAuthProvider } from "./src/auth/AuthContext";
import { IS_DEV_BYPASS } from "./src/config/dev";
import { RootNavigator } from "./src/navigation/RootNavigator";
import type { RootStackParamList } from "./src/navigation/types";

/**
 * Deep-link config. `wager://` is the app scheme (app.json). Invite links of
 * the form wager://join/{token} are also handled imperatively by useInviteLink,
 * but registering the scheme here lets the app cold-start from a link.
 */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["wager://"],
  config: { screens: {} },
};

export default function App() {
  // Dev bypass: skip Clerk and authenticate as EXPO_PUBLIC_DEV_USER_ID. Lets us
  // run/iterate on screens without a Clerk account (see src/config/dev.ts).
  //
  // The real Clerk app lives in ./src/ClerkApp and is require()d lazily ONLY in
  // the non-bypass branch, so its native deps (expo-crypto AES via Clerk's
  // tokenCache, which isn't in Expo Go) never evaluate while bypassing.
  if (IS_DEV_BYPASS) {
    return (
      <SafeAreaProvider>
        <DevAuthProvider>
          <NavigationContainer linking={linking}>
            <RootNavigator />
          </NavigationContainer>
        </DevAuthProvider>
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ClerkApp = require("./src/ClerkApp").default;
  return <ClerkApp />;
}
