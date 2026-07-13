import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MIN_STAKE } from "@wager/shared";
import { useAuthContext } from "../../auth/AuthContext";
import {
  betsApi,
  walletApi,
  type Balance,
  type Bet,
  type BetSide,
  type Odds,
  type Stake,
  type VerificationEvent,
} from "../../api/client";
import type { CirclesStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import {
  AppButton,
  Card,
  ErrorState,
  Field,
  formatCents,
  Loading,
  Muted,
  Screen,
  StatusPill,
} from "../../ui";

type Props = NativeStackScreenProps<CirclesStackParamList, "BetDetail">;

/** The two stakeable sides for a bet, keyed by the lowercase side the API expects. */
function sidesFor(type: Bet["type"]): { key: BetSide; label: string }[] {
  return type === "NUMERIC"
    ? [
        { key: "over", label: "Over" },
        { key: "under", label: "Under" },
      ]
    : [
        { key: "yes", label: "Yes" },
        { key: "no", label: "No" },
      ];
}

function sideLabel(side: string): string {
  return side.charAt(0).toUpperCase() + side.slice(1).toLowerCase();
}

/** "VERIFY" | "DENY" → "Verify" | "Deny". */
function voteLabel(choice: string): string {
  return choice.charAt(0).toUpperCase() + choice.slice(1).toLowerCase();
}

/** Human label for a verification event status. */
function prettyEventStatus(status: string): string {
  switch (status) {
    case "PENDING_VOTE":
      return "Open for voting";
    case "TIEBREAKER":
      return "Tiebreaker";
    case "VERIFIED":
      return "Verified";
    case "DENIED":
      return "Denied";
    default:
      return status;
  }
}

/** Accent for verified, dispute-red for denied, muted otherwise. */
function eventStatusColor(status: string): string {
  if (status === "VERIFIED") return colors.accent;
  if (status === "DENIED") return colors.statusDispute;
  return colors.textMuted;
}

/** "2h 14m" / "3d 4h" / "under a minute" from a future ISO timestamp. */
function countdown(iso: string, nowMs: number): string {
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return "closing…";
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / (60 * 24));
  const hours = Math.floor((mins % (60 * 24)) / 60);
  const m = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "under a minute";
}

/** Cross-platform confirm: window.confirm on web, Alert on native. */
function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

export function BetDetailScreen({ route }: Props) {
  const { betId } = route.params;
  const { getToken, user } = useAuthContext();

  const [bet, setBet] = useState<Bet | null>(null);
  const [odds, setOdds] = useState<Odds | null>(null);
  const [myStake, setMyStake] = useState<Stake | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Staking form
  const [side, setSide] = useState<BetSide | null>(null);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Line-setting form
  const [lineValue, setLineValue] = useState("");
  const [lineBusy, setLineBusy] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);

  // Verification
  const [events, setEvents] = useState<VerificationEvent[] | null>(null);
  // Distinguishes "the fetch failed" from "there genuinely are no events" — the
  // two must not render the same way.
  const [eventsFailed, setEventsFailed] = useState(false);
  const [eventDesc, setEventDesc] = useState("");
  const [eventValue, setEventValue] = useState("");
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [voteBusyId, setVoteBusyId] = useState<string | null>(null);

  // Live clock for the countdowns, ticking every 30s.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [b, o, s, bal, ev] = await Promise.all([
        betsApi.get(getToken, betId),
        betsApi.getOdds(getToken, betId),
        betsApi.getMyStake(getToken, betId),
        walletApi.balance(getToken).catch(() => null),
        betsApi.listEvents(getToken, betId).catch(() => null),
      ]);
      setBet(b);
      setOdds(o);
      setMyStake(s);
      setBalance(bal);
      // A successful call always yields an array, so null means the fetch failed.
      setEvents(ev);
      setEventsFailed(ev === null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bet");
    }
  }, [getToken, betId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const submitStake = useCallback(async () => {
    if (!side) {
      setFormError("Pick a side");
      return;
    }
    const dollars = Number.parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setFormError("Enter an amount");
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents < MIN_STAKE) {
      setFormError(`Minimum stake is ${formatCents(MIN_STAKE)}`);
      return;
    }
    if (balance && cents > balance.available) {
      setFormError(`Only ${formatCents(balance.available)} available`);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await betsApi.stake(getToken, betId, side, cents);
      setAmount("");
      setSide(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to place stake");
    } finally {
      setSubmitting(false);
    }
  }, [side, amount, balance, getToken, betId, load]);

  const submitLine = useCallback(async () => {
    const value = Number.parseFloat(lineValue);
    if (!Number.isFinite(value) || value < 0) {
      setLineError("Enter a non-negative number");
      return;
    }
    setLineBusy(true);
    setLineError(null);
    try {
      await betsApi.submitLine(getToken, betId, value);
      setLineValue("");
      await load();
    } catch (err) {
      setLineError(err instanceof Error ? err.message : "Failed to submit line");
    } finally {
      setLineBusy(false);
    }
  }, [lineValue, getToken, betId, load]);

  const revealLine = useCallback(async () => {
    const ok = await confirmAsync(
      "Reveal the line now?",
      "The trimmed-mean line locks and a 30-minute challenge window opens for everyone else.",
      "Reveal",
    );
    if (!ok) return;
    setLineBusy(true);
    try {
      await betsApi.revealLine(getToken, betId);
      await load();
    } catch (err) {
      Alert.alert("Couldn't reveal", err instanceof Error ? err.message : "Try again");
    } finally {
      setLineBusy(false);
    }
  }, [getToken, betId, load]);

  const disputeLine = useCallback(async () => {
    const ok = await confirmAsync(
      "Dispute this line?",
      "Your vote is final. If at least half of eligible members dispute, everyone re-submits a new line.",
      "Dispute",
    );
    if (!ok) return;
    setLineBusy(true);
    try {
      await betsApi.disputeLine(getToken, betId);
      await load();
    } catch (err) {
      Alert.alert("Couldn't dispute", err instanceof Error ? err.message : "Try again");
    } finally {
      setLineBusy(false);
    }
  }, [getToken, betId, load]);

  const submitEvent = useCallback(async () => {
    if (!eventDesc.trim()) {
      setEventError("Describe what happened");
      return;
    }
    let numericValue: number | undefined;
    if (bet?.type === "NUMERIC") {
      const v = Number.parseFloat(eventValue);
      if (!Number.isFinite(v)) {
        setEventError("Enter the numeric result");
        return;
      }
      numericValue = v;
    }
    setEventBusy(true);
    setEventError(null);
    try {
      await betsApi.submitEvent(getToken, betId, eventDesc.trim(), numericValue);
      setEventDesc("");
      setEventValue("");
      await load();
    } catch (err) {
      setEventError(err instanceof Error ? err.message : "Failed to submit event");
    } finally {
      setEventBusy(false);
    }
  }, [eventDesc, eventValue, bet?.type, getToken, betId, load]);

  const voteEvent = useCallback(
    async (eventId: string, choice: "verify" | "deny", tiebreaker: boolean) => {
      setVoteBusyId(eventId);
      try {
        if (tiebreaker) await betsApi.tiebreakerVote(getToken, eventId, choice);
        else await betsApi.voteEvent(getToken, eventId, choice);
        await load();
      } catch (err) {
        Alert.alert("Couldn't vote", err instanceof Error ? err.message : "Try again");
      } finally {
        setVoteBusyId(null);
      }
    },
    [getToken, load],
  );

  if (bet === null && error === null) {
    return (
      <Screen>
        <Loading label="Loading bet…" />
      </Screen>
    );
  }
  if (bet === null) {
    return (
      <Screen>
        <ErrorState message={error ?? "Failed to load bet"} onRetry={load} />
      </Screen>
    );
  }

  const sides = sidesFor(bet.type);
  const pools = odds?.pools ?? {};
  const total = sides.reduce((sum, s) => sum + (pools[s.key] ?? 0), 0);
  const isStaking = bet.status === "STAKING";
  const isActive = bet.status === "ACTIVE";
  const isLineSetting = bet.status === "LINE_SETTING";
  const isLineChallenge = bet.status === "LINE_CHALLENGE";
  const inLinePhase = isLineSetting || isLineChallenge;
  const isCreator = bet.creatorId === user?.id;
  const meta = bet._meta;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <Text style={styles.description}>{bet.description}</Text>
        <View style={styles.metaRow}>
          <StatusPill status={bet.status} />
          <Muted>{bet.type === "BINARY" ? "Yes / No" : "Over / Under"}</Muted>
          {bet.type === "NUMERIC" && bet.line !== null ? (
            <Muted>· Line {String(bet.line)}</Muted>
          ) : null}
        </View>

        {isStaking && bet.stakingEndsAt ? (
          <Card style={styles.timerCard}>
            <Muted>Staking closes in</Muted>
            <Text style={styles.timerValue}>{countdown(bet.stakingEndsAt, now)}</Text>
          </Card>
        ) : bet.status === "ACTIVE" && bet.activeUntil ? (
          <Card style={styles.timerCard}>
            <Muted>Resolves in</Muted>
            <Text style={styles.timerValue}>{countdown(bet.activeUntil, now)}</Text>
          </Card>
        ) : null}

        {/* ── Line setting (NUMERIC) ─────────────────────────────── */}
        {isLineSetting ? (
          <Card>
            <Text style={styles.cardTitle}>Set the line</Text>
            <Muted>
              Everyone submits a number privately. Once all submit (or the creator reveals), the
              trimmed-mean line is set and staking opens.
            </Muted>
            <Text style={styles.progress}>
              {meta?.submissionCount ?? 0} of {meta?.eligibleCount ?? "—"} submitted
            </Text>

            {meta?.userHasSubmitted ? (
              <Text style={styles.doneNote}>✓ You submitted your number. Waiting for others.</Text>
            ) : (
              <>
                <Field
                  label="Your number"
                  value={lineValue}
                  onChangeText={setLineValue}
                  placeholder="e.g. 27.5"
                  keyboardType="decimal-pad"
                  editable={!lineBusy}
                />
                {lineError ? <Text style={styles.formError}>{lineError}</Text> : null}
                <AppButton label="Submit line" onPress={submitLine} loading={lineBusy} />
              </>
            )}

            {isCreator && (meta?.submissionCount ?? 0) > 0 ? (
              <AppButton
                label="Reveal line now"
                variant="secondary"
                onPress={revealLine}
                loading={lineBusy}
              />
            ) : null}
          </Card>
        ) : null}

        {/* ── Line challenge (NUMERIC) ───────────────────────────── */}
        {isLineChallenge ? (
          <Card>
            <Text style={styles.cardTitle}>Line revealed</Text>
            <Text style={styles.lineBig}>{String(bet.line ?? "—")}</Text>
            {bet.challengeEndsAt ? (
              <Muted>Challenge window closes in {countdown(bet.challengeEndsAt, now)}</Muted>
            ) : null}
            <Text style={styles.progress}>
              {meta?.disputeCount ?? 0} of {meta?.eligibleCount ?? "—"} disputed · 50% forces a redo
            </Text>
            {meta?.userHasDisputed ? (
              <Text style={styles.doneNote}>✓ You disputed this line.</Text>
            ) : (
              <AppButton
                label="Dispute this line"
                variant="danger"
                onPress={disputeLine}
                loading={lineBusy}
              />
            )}
            <Muted>If fewer than half dispute, staking opens when the window closes.</Muted>
          </Card>
        ) : null}

        {/* ── Pools / odds (once past the line phase) ────────────── */}
        {!inLinePhase ? (
          <Card>
            <Text style={styles.cardTitle}>Pool · {formatCents(total)}</Text>
            {sides.map((s) => {
              const pool = pools[s.key] ?? 0;
              const pct = total > 0 ? Math.round((pool / total) * 100) : 0;
              const mult = odds?.odds?.[s.key];
              return (
                <View key={s.key} style={styles.poolRow}>
                  <View style={styles.poolHeader}>
                    <Text style={styles.poolSide}>{s.label}</Text>
                    <Text style={styles.poolAmount}>
                      {formatCents(pool)}
                      {mult ? <Text style={styles.poolMult}>  ·  {mult.toFixed(2)}×</Text> : null}
                    </Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct}%` }]} />
                  </View>
                </View>
              );
            })}
            {odds?.stakingOpen ? (
              <Muted style={styles.oddsNote}>Odds lock when the staking window closes.</Muted>
            ) : null}
          </Card>
        ) : null}

        {/* ── Your position / stake form ─────────────────────────── */}
        {inLinePhase ? null : myStake ? (
          <Card>
            <Text style={styles.cardTitle}>Your stake</Text>
            <View style={styles.yourStakeRow}>
              <Text style={styles.yourSide}>{sideLabel(myStake.side)}</Text>
              <Text style={styles.yourAmount}>{formatCents(myStake.amount)}</Text>
            </View>
            {myStake.refundAmount && myStake.refundAmount > 0 ? (
              <Muted>
                {formatCents(myStake.refundAmount)} refunded (5× cap) · effective{" "}
                {formatCents(myStake.effectiveAmount ?? myStake.amount)}
              </Muted>
            ) : null}
          </Card>
        ) : isStaking ? (
          <Card>
            <Text style={styles.cardTitle}>Place your stake</Text>
            <View style={styles.sidePicker}>
              {sides.map((s) => {
                const selected = side === s.key;
                return (
                  <Text
                    key={s.key}
                    onPress={() => setSide(s.key)}
                    style={[styles.sideOption, selected && styles.sideOptionSelected]}
                  >
                    {s.label}
                  </Text>
                );
              })}
            </View>
            <Field
              label={`Amount (min ${formatCents(MIN_STAKE)})`}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              editable={!submitting}
            />
            {balance ? <Muted>{formatCents(balance.available)} available</Muted> : null}
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <AppButton label="Stake" onPress={submitStake} loading={submitting} />
          </Card>
        ) : (
          <Card>
            <Muted style={{ textAlign: "center" }}>You didn’t stake on this bet.</Muted>
          </Card>
        )}

        {/* ── Verification (ACTIVE + resolved history) ───────────── */}
        {isActive || (events && events.length > 0) ? (
          <Card>
            <Text style={styles.cardTitle}>Verification</Text>
            <Muted>
              Anyone staked can report what happened. Stakers vote to verify or deny — a majority
              settles it.
            </Muted>

            {events && events.length > 0 ? (
              events.map((ev) => {
                const m = ev._meta;
                const isPending = ev.status === "PENDING_VOTE";
                const isTie = ev.status === "TIEBREAKER";
                return (
                  <View key={ev.id} style={styles.eventRow}>
                    <View style={styles.eventHeaderRow}>
                      <Text style={[styles.eventStatus, { color: eventStatusColor(ev.status) }]}>
                        {prettyEventStatus(ev.status)}
                      </Text>
                      {ev.numericValue !== null ? (
                        <Muted>Result {String(ev.numericValue)}</Muted>
                      ) : null}
                    </View>
                    <Text style={styles.eventDesc}>{ev.description}</Text>
                    {isTie ? (
                      <>
                        {/* Round-1 counts are the frozen tie; the re-vote is what's live. */}
                        <Muted>
                          Re-vote: {m?.tiebreakerVerifyCount ?? 0} verify ·{" "}
                          {m?.tiebreakerDenyCount ?? 0} deny
                        </Muted>
                        <Muted>
                          Tied {m?.verifyCount ?? 0}–{m?.denyCount ?? 0} in the first round
                        </Muted>
                      </>
                    ) : (
                      <Muted>
                        {m?.verifyCount ?? 0} verify · {m?.denyCount ?? 0} deny
                      </Muted>
                    )}

                    {isTie && ev.tiebreakerEndsAt ? (
                      <Muted>Re-vote closes in {countdown(ev.tiebreakerEndsAt, now)}</Muted>
                    ) : null}

                    {myStake && isPending ? (
                      m?.myVote ? (
                        <Text style={styles.doneNote}>✓ You voted {voteLabel(m.myVote)}</Text>
                      ) : (
                        <View style={styles.voteButtons}>
                          <View style={styles.voteBtn}>
                            <AppButton
                              label="Verify"
                              onPress={() => voteEvent(ev.id, "verify", false)}
                              loading={voteBusyId === ev.id}
                            />
                          </View>
                          <View style={styles.voteBtn}>
                            <AppButton
                              label="Deny"
                              variant="danger"
                              onPress={() => voteEvent(ev.id, "deny", false)}
                              loading={voteBusyId === ev.id}
                            />
                          </View>
                        </View>
                      )
                    ) : null}

                    {myStake && isTie ? (
                      <View style={styles.voteButtons}>
                        <View style={styles.voteBtn}>
                          <AppButton
                            label={m?.myTiebreakerVote === "VERIFY" ? "✓ Verify" : "Verify"}
                            variant={m?.myTiebreakerVote === "VERIFY" ? "primary" : "secondary"}
                            onPress={() => voteEvent(ev.id, "verify", true)}
                            loading={voteBusyId === ev.id}
                          />
                        </View>
                        <View style={styles.voteBtn}>
                          <AppButton
                            label={m?.myTiebreakerVote === "DENY" ? "✓ Deny" : "Deny"}
                            variant={m?.myTiebreakerVote === "DENY" ? "danger" : "secondary"}
                            onPress={() => voteEvent(ev.id, "deny", true)}
                            loading={voteBusyId === ev.id}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })
            ) : eventsFailed ? (
              <Text style={[styles.formError, styles.noEvents]}>
                Couldn’t load events. Pull down to refresh.
              </Text>
            ) : (
              <Muted style={styles.noEvents}>No events reported yet.</Muted>
            )}

            {isActive && myStake ? (
              <View style={styles.eventForm}>
                <Field
                  label="Report an outcome"
                  value={eventDesc}
                  onChangeText={setEventDesc}
                  placeholder="e.g. Final score was 112–108"
                  editable={!eventBusy}
                />
                {bet.type === "NUMERIC" ? (
                  <Field
                    label="Actual result"
                    value={eventValue}
                    onChangeText={setEventValue}
                    placeholder="e.g. 31"
                    keyboardType="decimal-pad"
                    editable={!eventBusy}
                  />
                ) : null}
                {eventError ? <Text style={styles.formError}>{eventError}</Text> : null}
                <AppButton label="Submit for verification" onPress={submitEvent} loading={eventBusy} />
              </View>
            ) : isActive && !myStake ? (
              <Muted style={styles.noEvents}>Only staked members can report outcomes.</Muted>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 48 },
  description: { color: colors.text, fontSize: 22, fontWeight: "800", lineHeight: 30 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  timerCard: { alignItems: "center", gap: 2, paddingVertical: 18 },
  timerValue: { color: colors.accent, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  cardTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  progress: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 4 },
  doneNote: { color: colors.accent, fontSize: 15, fontWeight: "600", marginTop: 4 },
  lineBig: {
    color: colors.accent,
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: -1,
    marginVertical: 4,
  },
  poolRow: { gap: 6, marginTop: 6 },
  poolHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  poolSide: { color: colors.text, fontSize: 16, fontWeight: "700" },
  poolAmount: { color: colors.text, fontSize: 15, fontWeight: "600" },
  poolMult: { color: colors.accent, fontWeight: "700" },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.background, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  oddsNote: { marginTop: 8 },
  yourStakeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  yourSide: { color: colors.accent, fontSize: 18, fontWeight: "800" },
  yourAmount: { color: colors.text, fontSize: 18, fontWeight: "700" },
  sidePicker: { flexDirection: "row", gap: 10, marginTop: 4 },
  sideOption: {
    flex: 1,
    textAlign: "center",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    borderWidth: 1.5,
    borderColor: "transparent",
    overflow: "hidden",
  },
  sideOptionSelected: { borderColor: colors.accent, color: colors.accent },
  formError: { color: colors.statusDispute, fontSize: 14 },
  eventRow: {
    gap: 4,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.background,
  },
  eventHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eventStatus: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  eventDesc: { color: colors.text, fontSize: 16, fontWeight: "600", lineHeight: 22 },
  voteButtons: { flexDirection: "row", gap: 10, marginTop: 8 },
  voteBtn: { flex: 1 },
  eventForm: { gap: 10, marginTop: 16 },
  noEvents: { marginTop: 8 },
});
