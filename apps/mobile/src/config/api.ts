import { Platform } from "react-native";

/**
 * Base URL for the Wager API.
 *
 * `localhost` does NOT mean "the dev machine" on every target:
 *  - Web / iOS simulator: localhost reaches the machine running `npm run dev`.
 *  - Android emulator: the host machine is reachable at 10.0.2.2, not localhost.
 *  - A physical phone (Expo Go): needs the machine's LAN IP (e.g. 192.168.x.x),
 *    because the phone and laptop are different devices on the network.
 *
 * For the physical-device case, set EXPO_PUBLIC_API_URL in apps/mobile/.env to
 * your machine's LAN address, e.g.:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000/api
 * Expo inlines any EXPO_PUBLIC_* variable at build time.
 */
const DEV_PORT = 3000;

function defaultDevBaseUrl(): string {
  const host = Platform.OS === "android" ? "10.0.2.2" : "localhost";
  return `http://${host}:${DEV_PORT}/api`;
}

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? defaultDevBaseUrl();
