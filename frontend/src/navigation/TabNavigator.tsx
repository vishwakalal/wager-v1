import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { FeedScreen } from "../screens/FeedScreen";
import { AlertsScreen } from "../screens/AlertsScreen";
import { CirclesListScreen } from "../screens/circles/CirclesListScreen";
import { CircleDetailScreen } from "../screens/circles/CircleDetailScreen";
import { BetDetailScreen } from "../screens/circles/BetDetailScreen";
import { CreateBetScreen } from "../screens/circles/CreateBetScreen";
import { ProfileScreen } from "../screens/profile/ProfileScreen";
import { NotificationSettingsScreen } from "../screens/profile/NotificationSettingsScreen";
import type {
  CirclesStackParamList,
  ProfileStackParamList,
  TabParamList,
} from "./types";

const Tab = createBottomTabNavigator<TabParamList>();
const CirclesStack = createNativeStackNavigator<CirclesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.text,
  headerTitleStyle: { color: colors.text },
  contentStyle: { backgroundColor: colors.background },
} as const;

function CirclesNavigator() {
  return (
    <CirclesStack.Navigator screenOptions={stackScreenOptions}>
      <CirclesStack.Screen name="CirclesList" component={CirclesListScreen} options={{ title: "Circles" }} />
      <CirclesStack.Screen
        name="CircleDetail"
        component={CircleDetailScreen}
        options={({ route }) => ({ title: route.params.circleName })}
      />
      <CirclesStack.Screen
        name="BetDetail"
        component={BetDetailScreen}
        options={{ title: "Bet" }}
      />
      <CirclesStack.Screen name="CreateBet" component={CreateBetScreen} options={{ title: "New bet" }} />
    </CirclesStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={stackScreenOptions}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: "Profile" }} />
      <ProfileStack.Screen
        name="NotificationSettings"
        component={NotificationSettingsScreen}
        options={{ title: "Notifications" }}
      />
    </ProfileStack.Navigator>
  );
}

/** Simple text-glyph tab icon (no icon font dependency). */
function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return (
    <View style={styles.iconWrap}>
      <Text style={[styles.iconGlyph, { color }]}>{glyph}</Text>
    </View>
  );
}

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{ tabBarIcon: ({ color }) => <TabIcon glyph="≋" color={color} /> }}
      />
      <Tab.Screen
        name="Circles"
        component={CirclesNavigator}
        options={{ tabBarIcon: ({ color }) => <TabIcon glyph="◎" color={color} /> }}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{ tabBarIcon: ({ color }) => <TabIcon glyph="◔" color={color} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileNavigator}
        options={{ tabBarIcon: ({ color }) => <TabIcon glyph="◍" color={color} /> }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: "#000000",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabLabel: { fontSize: 11, fontWeight: "600" },
  iconWrap: { alignItems: "center", justifyContent: "center" },
  iconGlyph: { fontSize: 20, lineHeight: 24 },
});
