/**
 * Single source of truth for every rule threshold in the product spec.
 * Both the API and the mobile client import these so the rules can never drift.
 * (Spec references in comments.)
 */
import { dollarsToCents, type Cents } from "./money.js";

/** Bet durations the creator can choose (spec §5.1). */
export const BET_DURATIONS = ["1_day", "1_week", "1_month"] as const;
export type BetDuration = (typeof BET_DURATIONS)[number];

/** Staking window length per duration, in milliseconds (spec §4.1). */
export const STAKING_WINDOW_MS: Record<BetDuration, number> = {
  "1_day": 1 * 60 * 60 * 1000, //  1 hour
  "1_week": 24 * 60 * 60 * 1000, // 24 hours
  "1_month": 48 * 60 * 60 * 1000, // 48 hours
};

/** Active bet length per duration, in milliseconds (spec §5.1). */
export const BET_ACTIVE_MS: Record<BetDuration, number> = {
  "1_day": 24 * 60 * 60 * 1000,
  "1_week": 7 * 24 * 60 * 60 * 1000,
  "1_month": 30 * 24 * 60 * 60 * 1000,
};

/** Line challenge window after the line is revealed (spec §3.1). */
export const LINE_CHALLENGE_WINDOW_MS = 30 * 60 * 1000; // 30 min

/** Verification re-vote window on a 50/50 tie (spec §6.2). */
export const TIEBREAKER_REVOTE_WINDOW_MS = 30 * 60 * 1000; // 30 min

/** Post-expiration (dispute) window — soft close (spec §5.2). */
export const POST_EXPIRATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Warning lead times (spec §11). */
export const STAKING_CLOSING_WARNING_MS = 30 * 60 * 1000; // 30 min before close
export const DISPUTE_CLOSING_WARNING_MS = 2 * 60 * 60 * 1000; // 2 hours before close

/** Minimum members required to run each bet type (spec §2.2). */
export const MIN_MEMBERS: Record<"numeric" | "binary", number> = {
  numeric: 4,
  binary: 2,
};

/** Staking limits (spec §4.2). */
export const MIN_STAKE: Cents = dollarsToCents(1); // $1
export const RELATIVE_CAP_MULTIPLE = 5; // 5x the lowest staker

/** Voting thresholds, as fractions of staked members (spec §6, §7, §8). */
export const VERIFY_THRESHOLD = 0.5; // 50% to verify/deny
export const LINE_CHALLENGE_THRESHOLD = 0.5; // 50%+ disputes -> redo line
export const DISPUTE_THRESHOLD = 0.7; // 70% to add/remove a disputed event
export const CANCEL_VOTE_THRESHOLD = 0.5; // 50%+ to cancel

/** Phone OTP rules (spec §9.2). */
export const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 min
export const OTP_MAX_ATTEMPTS = 3;

/** Withdrawals (spec §10.3). */
export const MIN_WITHDRAWAL: Cents = dollarsToCents(5); // $5

/**
 * Platform rake on the losing pool (spec §4.3, §7.4).
 * v1 launches at 0%. When enabled, the spec value is 2% (200 bps).
 */
export const RAKE_BPS = 0; // basis points; 200 = 2%
