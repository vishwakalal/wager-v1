import React, { useCallback, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuthContext } from "../../auth/AuthContext";
import { circlesApi, type Circle } from "../../api/client";
import type { CirclesStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import {
  AppButton,
  Body,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Muted,
  Screen,
  Subtitle,
} from "../../ui";

type Props = NativeStackScreenProps<CirclesStackParamList, "CirclesList">;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CirclesListScreen({ navigation }: Props) {
  const { getToken } = useAuthContext();

  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Create-circle modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await circlesApi.list(getToken);
      setCircles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load circles");
    }
  }, [getToken]);

  // Refetch every time the tab/screen regains focus so newly created circles
  // and membership changes show up without a manual refresh.
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

  const openCreate = () => {
    setNewName("");
    setCreateError(null);
    setModalOpen(true);
  };

  const submitCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      setCreateError("Enter a circle name");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const circle = await circlesApi.create(getToken, name);
      setModalOpen(false);
      setCircles((prev) => (prev ? [circle, ...prev] : [circle]));
      // Drop straight into the new circle so the next step (inviting friends)
      // is one tap away.
      navigation.navigate("CircleDetail", {
        circleId: circle.id,
        circleName: circle.name,
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create circle");
    } finally {
      setCreating(false);
    }
  }, [newName, getToken, navigation]);

  // Initial load (no data yet, no error yet).
  if (circles === null && error === null) {
    return (
      <Screen>
        <Loading label="Loading circles…" />
      </Screen>
    );
  }

  if (circles === null && error !== null) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={circles ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Subtitle>
              {circles && circles.length > 0
                ? `${circles.length} ${circles.length === 1 ? "circle" : "circles"}`
                : "Your wagering groups"}
            </Subtitle>
            <AppButton label="+  New Circle" onPress={openCreate} />
          </View>
        }
        renderItem={({ item }) => (
          <Card
            onPress={() =>
              navigation.navigate("CircleDetail", {
                circleId: item.id,
                circleName: item.name,
              })
            }
            style={styles.row}
          >
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {item.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={1}>
                {item.name}
              </Text>
              <Muted>Created {formatDate(item.createdAt)}</Muted>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Card>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <EmptyState
              title="No circles yet"
              hint="Create your first circle to start wagering with friends."
            />
          </View>
        }
      />

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Body style={styles.sheetTitle}>New Circle</Body>
            <Field
              label="Circle name"
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Sunday League"
              autoFocus
              maxLength={40}
              returnKeyType="done"
              onSubmitEditing={submitCreate}
              editable={!creating}
            />
            {createError ? <Text style={styles.createError}>{createError}</Text> : null}
            <View style={styles.sheetActions}>
              <AppButton
                label="Cancel"
                variant="secondary"
                onPress={() => setModalOpen(false)}
                style={styles.sheetButton}
              />
              <AppButton
                label="Create"
                onPress={submitCreate}
                loading={creating}
                style={styles.sheetButton}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: 20, gap: 12, flexGrow: 1 },
  header: { gap: 14, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(61,255,192,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.accent, fontSize: 18, fontWeight: "800" },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  chevron: { color: colors.textMuted, fontSize: 26, fontWeight: "400" },
  empty: { flex: 1, minHeight: 320 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    gap: 16,
  },
  sheetTitle: { fontSize: 18, fontWeight: "800" },
  sheetActions: { flexDirection: "row", gap: 12 },
  sheetButton: { flex: 1 },
  createError: { color: colors.statusDispute, fontSize: 14 },
});
