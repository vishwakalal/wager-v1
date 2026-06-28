import React, { useCallback, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuthContext } from "../../auth/AuthContext";
import {
  betsApi,
  circlesApi,
  type Bet,
  type CircleDetail,
} from "../../api/client";
import type { CirclesStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import {
  AppButton,
  Body,
  Card,
  ErrorState,
  Loading,
  Muted,
  prettyStatus,
  Screen,
  StatusPill,
} from "../../ui";

type Props = NativeStackScreenProps<CirclesStackParamList, "CircleDetail">;

interface InviteLink {
  url: string;
  expiresAt: string;
}

function initial(name: string | null): string {
  return (name ?? "?").charAt(0).toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

export function CircleDetailScreen({ route, navigation }: Props) {
  const { circleId } = route.params;
  const { getToken, user } = useAuthContext();

  const [detail, setDetail] = useState<CircleDetail | null>(null);
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Invite-link state (creator only). There's no GET for an existing token, so
  // the link is shown after the creator generates it this session.
  const [invite, setInvite] = useState<InviteLink | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [d, b] = await Promise.all([
        circlesApi.get(getToken, circleId),
        betsApi.list(getToken, circleId),
      ]);
      setDetail(d);
      setBets(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load circle");
    }
  }, [getToken, circleId]);

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

  const me = detail?.members.find((m) => m.userId === user?.id);
  const isCreator = me?.role === "CREATOR";

  const generateLink = useCallback(async () => {
    setInviteBusy(true);
    try {
      const link = await circlesApi.generateInviteLink(getToken, circleId);
      setInvite(link);
    } catch (err) {
      Alert.alert("Couldn't create link", err instanceof Error ? err.message : "Try again");
    } finally {
      setInviteBusy(false);
    }
  }, [getToken, circleId]);

  const revokeLink = useCallback(async () => {
    setInviteBusy(true);
    try {
      await circlesApi.revokeInviteLink(getToken, circleId);
      setInvite(null);
    } catch (err) {
      Alert.alert("Couldn't revoke link", err instanceof Error ? err.message : "Try again");
    } finally {
      setInviteBusy(false);
    }
  }, [getToken, circleId]);

  const shareLink = useCallback(async (url: string) => {
    try {
      if (Platform.OS === "web") {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      } else {
        await Share.share({ message: url });
      }
    } catch {
      /* user dismissed the share sheet — no-op */
    }
  }, []);

  const leaveCircle = useCallback(async () => {
    const ok = await confirmAsync(
      "Leave circle?",
      isCreator
        ? "As creator, ownership transfers to the longest-standing member (or the circle is deleted if you're the only one)."
        : "You'll need a new invite to rejoin.",
      "Leave",
    );
    if (!ok) return;
    try {
      await circlesApi.leave(getToken, circleId);
      navigation.goBack();
    } catch (err) {
      Alert.alert("Couldn't leave", err instanceof Error ? err.message : "Try again");
    }
  }, [getToken, circleId, isCreator, navigation]);

  if (detail === null && error === null) {
    return (
      <Screen>
        <Loading label="Loading circle…" />
      </Screen>
    );
  }
  if (detail === null) {
    return (
      <Screen>
        <ErrorState message={error ?? "Failed to load circle"} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {/* ── Members ───────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Members · {detail.members.length}</Text>
        <Card style={styles.membersCard}>
          {detail.members.map((m, i) => (
            <View key={m.id} style={[styles.memberRow, i > 0 && styles.memberRowDivider]}>
              <View style={styles.memberBadge}>
                <Text style={styles.memberBadgeText}>{initial(m.user.displayName)}</Text>
              </View>
              <Text style={styles.memberName} numberOfLines={1}>
                {m.user.displayName ?? "Unknown"}
                {m.userId === user?.id ? "  (You)" : ""}
              </Text>
              <Text style={[styles.roleTag, m.role === "CREATOR" && styles.roleTagCreator]}>
                {m.role === "CREATOR" ? "Creator" : "Member"}
              </Text>
            </View>
          ))}
        </Card>

        {/* ── Invite link (creator only) ────────────────────────── */}
        {isCreator ? (
          <>
            <Text style={styles.sectionLabel}>Invite</Text>
            {invite ? (
              <Card style={{ gap: 12 }}>
                <Muted>Share this link — anyone who opens it joins automatically.</Muted>
                <Text selectable style={styles.linkText}>
                  {invite.url}
                </Text>
                <Muted>Expires {formatDate(invite.expiresAt)}</Muted>
                <View style={styles.inviteActions}>
                  <AppButton
                    label={copied ? "Copied!" : Platform.OS === "web" ? "Copy link" : "Share link"}
                    onPress={() => shareLink(invite.url)}
                    style={styles.inviteButton}
                  />
                  <AppButton
                    label="Revoke"
                    variant="danger"
                    onPress={revokeLink}
                    loading={inviteBusy}
                    style={styles.inviteButton}
                  />
                </View>
              </Card>
            ) : (
              <AppButton
                label="Create invite link"
                variant="secondary"
                onPress={generateLink}
                loading={inviteBusy}
              />
            )}
          </>
        ) : null}

        {/* ── Bets ──────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, styles.betsHeader]}>Bets · {bets?.length ?? 0}</Text>
        <AppButton
          label="+  New Bet"
          onPress={() => navigation.navigate("CreateBet", { circleId })}
        />

        {bets && bets.length > 0 ? (
          bets.map((bet) => (
            <Card
              key={bet.id}
              onPress={() =>
                navigation.navigate("BetDetail", {
                  betId: bet.id,
                  circleId,
                  betDescription: bet.description,
                })
              }
              style={{ gap: 10 }}
            >
              <Body style={styles.betDescription}>{bet.description}</Body>
              <View style={styles.betMetaRow}>
                <StatusPill status={bet.status} />
                <Muted>
                  {bet.type === "BINARY" ? "Yes / No" : "Over / Under"} ·{" "}
                  {prettyStatus(bet.duration)}
                </Muted>
              </View>
            </Card>
          ))
        ) : (
          <Card>
            <Muted style={{ textAlign: "center" }}>No bets yet. Start one with “New Bet”.</Muted>
          </Card>
        )}

        {/* ── Leave ─────────────────────────────────────────────── */}
        <Pressable onPress={leaveCircle} style={styles.leave}>
          <Text style={styles.leaveText}>Leave circle</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 8,
  },
  membersCard: { gap: 0, paddingVertical: 4 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  memberRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#2A2A2A" },
  memberBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(61,255,192,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  memberBadgeText: { color: colors.accent, fontSize: 15, fontWeight: "800" },
  memberName: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  roleTag: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  roleTagCreator: { color: colors.accent },
  linkText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 12,
  },
  inviteActions: { flexDirection: "row", gap: 12 },
  inviteButton: { flex: 1 },
  betsHeader: { marginTop: 4 },
  betDescription: { fontWeight: "700", fontSize: 16, lineHeight: 22 },
  betMetaRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  leave: { alignItems: "center", paddingVertical: 18, marginTop: 8 },
  leaveText: { color: colors.statusDispute, fontSize: 15, fontWeight: "600" },
});
