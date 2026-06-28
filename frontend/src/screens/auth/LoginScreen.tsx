import { useSignIn, useSignUp } from "@clerk/clerk-expo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { AppButton, Field, Muted, Screen, Subtitle, Title } from "../../ui";
import type { AuthStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

type Step = "phone" | "code";

/**
 * Phone-number sign-in/up via Clerk (phone_code strategy). New numbers go
 * through signUp; existing numbers fall back to signIn. Once Clerk activates a
 * session, AuthContext re-evaluates and routes to Username / PhoneVerify / app.
 */
export function LoginScreen(_props: Props) {
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp();
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [usingSignIn, setUsingSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loaded = signUpLoaded && signInLoaded;

  async function startSignIn(phoneNumber: string) {
    if (!signIn) throw new Error("Sign-in unavailable");
    const attempt = await signIn.create({ identifier: phoneNumber });
    const factor = attempt.supportedFirstFactors?.find(
      (f): f is typeof f & { phoneNumberId: string } =>
        f.strategy === "phone_code" && "phoneNumberId" in f,
    );
    if (!factor) throw new Error("Phone sign-in not available for this number");
    await signIn.prepareFirstFactor({ strategy: "phone_code", phoneNumberId: factor.phoneNumberId });
    setUsingSignIn(true);
  }

  async function sendCode() {
    if (!loaded || !signUp) return;
    setError(null);
    setBusy(true);
    try {
      const e164 = phone.trim();
      try {
        await signUp.create({ phoneNumber: e164 });
        await signUp.preparePhoneNumberVerification({ strategy: "phone_code" });
        setUsingSignIn(false);
      } catch (err) {
        // Number already registered → switch to the sign-in flow.
        if (isIdentifierExists(err)) {
          await startSignIn(e164);
        } else {
          throw err;
        }
      }
      setStep("code");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!loaded) return;
    setError(null);
    setBusy(true);
    try {
      if (usingSignIn) {
        if (!signIn) throw new Error("Sign-in unavailable");
        const res = await signIn.attemptFirstFactor({ strategy: "phone_code", code: code.trim() });
        if (res.status === "complete") {
          await setActiveSignIn({ session: res.createdSessionId });
        } else {
          throw new Error("Verification incomplete");
        }
      } else {
        if (!signUp) throw new Error("Sign-up unavailable");
        const res = await signUp.attemptPhoneNumberVerification({ code: code.trim() });
        if (res.status === "complete") {
          await setActiveSignUp({ session: res.createdSessionId });
        } else {
          throw new Error("Verification incomplete");
        }
      }
      // On success AuthContext picks up the active session and re-routes.
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <Title style={styles.brand}>Wager</Title>
        <Subtitle>social prediction markets for friends</Subtitle>
      </View>

      {step === "phone" ? (
        <View style={styles.form}>
          <Field
            label="Phone number"
            placeholder="+15551234567"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
          />
          <AppButton
            label="Send code"
            onPress={sendCode}
            loading={busy}
            disabled={!loaded || phone.trim().length < 8}
          />
          <Muted style={styles.hint}>We&apos;ll text you a verification code.</Muted>
        </View>
      ) : (
        <View style={styles.form}>
          <Field
            label="Verification code"
            placeholder="123456"
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
          />
          <AppButton
            label="Verify & continue"
            onPress={verifyCode}
            loading={busy}
            disabled={code.trim().length < 4}
          />
          <AppButton
            label="Use a different number"
            variant="secondary"
            onPress={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
          />
        </View>
      )}

      {error ? <Muted style={styles.error}>{error}</Muted> : null}
    </Screen>
  );
}

function isIdentifierExists(err: unknown): boolean {
  const errs = (err as { errors?: Array<{ code?: string }> })?.errors;
  return Array.isArray(errs) && errs.some((e) => e.code === "form_identifier_exists");
}

function messageOf(err: unknown): string {
  const errs = (err as { errors?: Array<{ message?: string; longMessage?: string }> })?.errors;
  if (Array.isArray(errs) && errs[0]) return errs[0].longMessage ?? errs[0].message ?? "Something went wrong";
  return err instanceof Error ? err.message : "Something went wrong";
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", gap: 32 },
  header: { alignItems: "center" },
  brand: { fontSize: 48 },
  form: { gap: 16 },
  hint: { textAlign: "center" },
  error: { color: "#F09595", textAlign: "center" },
});
