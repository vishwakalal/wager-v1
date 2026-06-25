import type { NavigatorScreenParams } from "@react-navigation/native";

export type AuthStackParamList = {
  Login: undefined;
  Username: undefined;
  PhoneVerify: undefined;
};

export type CirclesStackParamList = {
  CirclesList: undefined;
  CircleDetail: { circleId: string; circleName: string };
  BetDetail: { betId: string; circleId: string; betDescription: string };
  CreateBet: { circleId: string };
};

export type ProfileStackParamList = {
  ProfileMain: undefined;
  NotificationSettings: undefined;
};

export type TabParamList = {
  Feed: undefined;
  Circles: NavigatorScreenParams<CirclesStackParamList>;
  Alerts: undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<TabParamList>;
};
