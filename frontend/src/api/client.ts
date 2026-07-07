import { API_BASE_URL } from "../config/api";
import { DEV_USER_ID } from "../config/dev";

export type GetToken = () => Promise<string | null>;

export interface WagerUser {
  id: string;
  username: string | null;
  displayName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  createdAt: string;
}

export interface Circle {
  id: string;
  name: string;
  createdAt: string;
}

export interface CircleMember {
  id: string;
  circleId: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: string | null;
  user: { id: string; displayName: string | null };
}

export interface CircleDetail {
  circle: Circle;
  members: CircleMember[];
}

export interface Bet {
  id: string;
  circleId: string;
  creatorId: string;
  type: "BINARY" | "NUMERIC";
  duration: string;
  status: string;
  description: string;
  line: number | string | null;
  lineRound: number;
  lineRevealedAt: string | null;
  challengeEndsAt: string | null;
  stakingEndsAt: string | null;
  activeUntil: string | null;
  closedAt: string | null;
  resolvedAt: string | null;
  winSide: string | null;
  createdAt: string;
  _meta?: {
    submissionCount: number;
    disputeCount: number;
    eligibleCount: number;
    userHasSubmitted: boolean;
    userHasDisputed: boolean;
  };
}

export type BetSide = "over" | "under" | "yes" | "no";

/**
 * Pool sizes (cents) are always present; `odds` (implied payout multipliers)
 * only appear once staking has closed and both sides have money. Shape mirrors
 * the backend StakingService.getOdds response.
 */
export interface Odds {
  stakingOpen: boolean;
  pools: Partial<Record<BetSide, number>>;
  odds?: Partial<Record<BetSide, number>>;
}

export interface Stake {
  id: string;
  betId: string;
  userId: string;
  side: "OVER" | "UNDER" | "YES" | "NO";
  amount: number;
  effectiveAmount: number | null;
  refundAmount: number | null;
  createdAt: string;
}

export interface VerificationEvent {
  id: string;
  betId: string;
  submitterId: string;
  description: string;
  status: string;
  numericValue: number | null;
  tiebreakerEndsAt: string | null;
  createdAt: string;
  _meta?: {
    verifyCount: number;
    denyCount: number;
    myVote: string | null;
    myTiebreakerVote: string | null;
  };
}

export interface Dispute {
  id: string;
  betId: string;
  initiatorId: string;
  type: string;
  status: string;
  description: string;
  targetEventId: string | null;
  createdAt: string;
  _meta?: { inFavorCount: number; againstCount: number; myVote: boolean | null };
}

export interface Balance {
  available: number;
  held: number;
  total: number;
}

export interface NotificationPreference {
  trigger: string;
  enabled: boolean;
}

export interface CancelVoteStatus {
  votes: Array<{ userId: string }>;
  _meta: { voteCount: number; stakerCount: number; threshold: number; myVote: boolean };
}

async function apiFetch<T>(
  path: string,
  getToken: GetToken,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else if (DEV_USER_ID) headers["x-user-id"] = DEV_USER_ID;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  // Some endpoints (DELETE/leave, revoke, notifications) return an empty 200
  // body. res.json() throws on empty input, so read text and parse only if
  // there's something — void endpoints resolve to undefined.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const authApi = {
  me: (gt: GetToken) => apiFetch<WagerUser>("/auth/me", gt),
  setUsername: (gt: GetToken, username: string) =>
    apiFetch<{ message: string; username: string }>("/auth/username", gt, {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  sendOtp: (gt: GetToken, phone: string) =>
    apiFetch<{ message: string }>("/auth/phone/send", gt, {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  verifyOtp: (gt: GetToken, phone: string, code: string) =>
    apiFetch<{ message: string }>("/auth/phone/verify", gt, {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    }),
  deleteAccount: (gt: GetToken) =>
    apiFetch<{ message: string }>("/auth/account", gt, { method: "DELETE" }),
};

export const circlesApi = {
  list: (gt: GetToken) => apiFetch<Circle[]>("/circles", gt),
  create: (gt: GetToken, name: string) =>
    apiFetch<Circle>("/circles", gt, { method: "POST", body: JSON.stringify({ name }) }),
  get: (gt: GetToken, id: string) => apiFetch<CircleDetail>(`/circles/${id}`, gt),
  approve: (gt: GetToken, circleId: string, userId: string) =>
    apiFetch<CircleMember>(`/circles/${circleId}/members/${userId}/approve`, gt, { method: "POST" }),
  leave: (gt: GetToken, circleId: string) =>
    apiFetch<void>(`/circles/${circleId}/leave`, gt, { method: "DELETE" }),
  generateInviteLink: (gt: GetToken, circleId: string) =>
    apiFetch<{ url: string; expiresAt: string }>(`/circles/${circleId}/invite-link`, gt, { method: "POST" }),
  revokeInviteLink: (gt: GetToken, circleId: string) =>
    apiFetch<void>(`/circles/${circleId}/invite-link`, gt, { method: "DELETE" }),
};

export const betsApi = {
  list: (gt: GetToken, circleId: string) =>
    apiFetch<Bet[]>(`/circles/${circleId}/bets`, gt),
  create: (gt: GetToken, circleId: string, payload: { type: string; duration: string; description: string }) =>
    apiFetch<Bet>(`/circles/${circleId}/bets`, gt, { method: "POST", body: JSON.stringify(payload) }),
  get: (gt: GetToken, betId: string) => apiFetch<Bet>(`/bets/${betId}`, gt),
  getOdds: (gt: GetToken, betId: string) => apiFetch<Odds>(`/bets/${betId}/odds`, gt),
  submitLine: (gt: GetToken, betId: string, value: number) =>
    apiFetch<unknown>(`/bets/${betId}/line/submit`, gt, { method: "POST", body: JSON.stringify({ value }) }),
  revealLine: (gt: GetToken, betId: string) =>
    apiFetch<Bet>(`/bets/${betId}/line/reveal`, gt, { method: "POST" }),
  disputeLine: (gt: GetToken, betId: string) =>
    apiFetch<unknown>(`/bets/${betId}/line/dispute`, gt, { method: "POST" }),
  getMyStake: (gt: GetToken, betId: string) =>
    apiFetch<Stake | null>(`/bets/${betId}/my-stake`, gt),
  stake: (gt: GetToken, betId: string, side: string, amount: number) =>
    apiFetch<Stake>(`/bets/${betId}/stake`, gt, { method: "POST", body: JSON.stringify({ side, amount }) }),
  listEvents: (gt: GetToken, betId: string) =>
    apiFetch<VerificationEvent[]>(`/bets/${betId}/events`, gt),
  submitEvent: (gt: GetToken, betId: string, description: string, numericValue?: number) =>
    apiFetch<VerificationEvent>(`/bets/${betId}/events`, gt, {
      method: "POST",
      body: JSON.stringify({ description, ...(numericValue !== undefined ? { numericValue } : {}) }),
    }),
  voteEvent: (gt: GetToken, eventId: string, choice: string) =>
    apiFetch<unknown>(`/events/${eventId}/vote`, gt, { method: "POST", body: JSON.stringify({ choice }) }),
  tiebreakerVote: (gt: GetToken, eventId: string, choice: string) =>
    apiFetch<unknown>(`/events/${eventId}/tiebreaker-vote`, gt, { method: "POST", body: JSON.stringify({ choice }) }),
  listDisputes: (gt: GetToken, betId: string) =>
    apiFetch<Dispute[]>(`/bets/${betId}/disputes`, gt),
  raiseDispute: (gt: GetToken, betId: string, payload: { type: string; description: string; targetEventId?: string }) =>
    apiFetch<Dispute>(`/bets/${betId}/disputes`, gt, { method: "POST", body: JSON.stringify(payload) }),
  voteDispute: (gt: GetToken, disputeId: string, inFavor: boolean) =>
    apiFetch<unknown>(`/disputes/${disputeId}/vote`, gt, { method: "POST", body: JSON.stringify({ inFavor }) }),
  cancel: (gt: GetToken, betId: string) =>
    apiFetch<unknown>(`/bets/${betId}/cancel`, gt, { method: "POST" }),
  cancelVote: (gt: GetToken, betId: string) =>
    apiFetch<unknown>(`/bets/${betId}/cancel-vote`, gt, { method: "POST" }),
  getCancelVotes: (gt: GetToken, betId: string) =>
    apiFetch<CancelVoteStatus>(`/bets/${betId}/cancel-votes`, gt),
};

export const walletApi = {
  // Balance is GET /wallet (the controller's root @Get()), not /wallet/balance.
  balance: (gt: GetToken) => apiFetch<Balance>("/wallet", gt),
};

export const notificationsApi = {
  registerToken: (gt: GetToken, token: string, platform: string) =>
    apiFetch<void>("/notifications/token", gt, { method: "POST", body: JSON.stringify({ token, platform }) }),
  getPreferences: (gt: GetToken) =>
    apiFetch<NotificationPreference[]>("/notifications/preferences", gt),
  updatePreferences: (gt: GetToken, updates: Array<{ trigger: string; enabled: boolean }>) =>
    apiFetch<void>("/notifications/preferences", gt, { method: "PATCH", body: JSON.stringify({ updates }) }),
};
