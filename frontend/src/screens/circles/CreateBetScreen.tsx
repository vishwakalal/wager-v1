import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MIN_MEMBERS } from "@wager/shared";
import { useAuthContext } from "../../auth/AuthContext";
import { betsApi } from "../../api/client";
import type { CirclesStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import { AppButton, Field, Muted, Screen } from "../../ui";

type Props = NativeStackScreenProps<CirclesStackParamList, "CreateBet">;

type BetType = "BINARY" | "NUMERIC";
type DurationInput = "1_day" | "1_week" | "1_month";

const TYPE_OPTIONS: {
  value: BetType;
  title: string;
  blurb: string;
  minMembers: number;
}[] = [
  {
    value: "BINARY",
    title: "Yes / No",
    blurb: "A true-or-false question. Goes straight to staking.",
    minMembers: MIN_MEMBERS.binary,
  },
  {
    value: "NUMERIC",
    title: "Over / Under",
    blurb: "Members blind-set a line first, then bet over or under it.",
    minMembers: MIN_MEMBERS.numeric,
  },
];

const DURATION_OPTIONS: { value: DurationInput; label: string }[] = [
  { value: "1_day", label: "1 Day" },
  { value: "1_week", label: "1 Week" },
  { value: "1_month", label: "1 Month" },
];

export function CreateBetScreen({ route, navigation }: Props) {
  const { circleId } = route.params;
  const { getToken } = useAuthContext();

  const [description, setDescription] = useState("");
  const [type, setType] = useState<BetType>("BINARY");
  const [duration, setDuration] = useState<DurationInput>("1_week");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const desc = description.trim();
    if (!desc) {
      setError("Describe what you're betting on");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await betsApi.create(getToken, circleId, { type, duration, description: desc });
      // Back to the circle, whose bet list refetches on focus and shows it.
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bet");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Field
        label="What's the bet?"
        value={description}
        onChangeText={setDescription}
        placeholder={
          type === "BINARY"
            ? "e.g. Will it rain in NYC on Saturday?"
            : "e.g. How many points will LeBron score?"
        }
        multiline
        maxLength={140}
        style={styles.descInput}
        editable={!submitting}
      />
      <Muted style={styles.counter}>{description.length}/140</Muted>

      {/* ── Type ──────────────────────────────────────────────── */}
      <Text style={styles.label}>Type</Text>
      <View style={styles.typeOptions}>
        {TYPE_OPTIONS.map((opt) => {
          const selected = type === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setType(opt.value)}
              style={[styles.typeCard, selected && styles.typeCardSelected]}
            >
              <View style={styles.typeHeader}>
                <Text style={[styles.typeTitle, selected && styles.typeTitleSelected]}>
                  {opt.title}
                </Text>
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
              </View>
              <Muted>{opt.blurb}</Muted>
              <Muted style={styles.minMembers}>Requires {opt.minMembers}+ members</Muted>
            </Pressable>
          );
        })}
      </View>

      {/* ── Duration ──────────────────────────────────────────── */}
      <Text style={styles.label}>Duration</Text>
      <View style={styles.segment}>
        {DURATION_OPTIONS.map((opt) => {
          const selected = duration === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setDuration(opt.value)}
              style={[styles.segmentItem, selected && styles.segmentItemSelected]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <AppButton
        label="Create Bet"
        onPress={submit}
        loading={submitting}
        style={styles.submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  descInput: { height: 96, paddingTop: 14, textAlignVertical: "top" },
  counter: { textAlign: "right", marginTop: -6 },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 6,
  },
  typeOptions: { gap: 12 },
  typeCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  typeCardSelected: { borderColor: colors.accent },
  typeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  typeTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  typeTitleSelected: { color: colors.accent },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  minMembers: { fontSize: 12 },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    height: 44,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentItemSelected: { backgroundColor: colors.accent },
  segmentText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  segmentTextSelected: { color: colors.background, fontWeight: "700" },
  error: { color: colors.statusDispute, fontSize: 14 },
  submit: { marginTop: 8 },
});
