import { NotificationTrigger } from "@prisma/client";

/**
 * Spec §11 default states: ON = anything requiring action or financial movement;
 * OFF = passive confirmations the user didn't trigger.
 * Missing preference row → use this default.
 */
export const NOTIFICATION_DEFAULTS: Record<NotificationTrigger, boolean> = {
  BET_LINE_OPEN:               true,
  BET_LINE_REVEALED:           true,
  BET_STAKING_OPEN:            true,
  BET_STAKING_WARNING:         true,
  BET_STAKING_CLOSED:          true,
  BET_ACTIVE:                  true,
  BET_EXPIRED:                 true,
  BET_DISPUTE_WARNING:         true,
  BET_RESOLVED_WON:            true,
  BET_RESOLVED_LOST:           true,
  BET_VOIDED:                  true,
  VERIFICATION_NEEDED:         true,
  VERIFICATION_TIEBREAKER:     true,
  VERIFICATION_APPROVED:       false, // passive
  VERIFICATION_DENIED:         false, // passive
  DISPUTE_RAISED:              true,
  DISPUTE_RESOLVED_ADDED:      true,
  DISPUTE_RESOLVED_REMOVED:    true,
  CIRCLE_JOIN_REQUEST:         true,
  CIRCLE_APPROVED:             true,
  CIRCLE_BET_CREATED:          false, // passive
  CIRCLE_MEMBER_JOINED:        false, // passive
  PAYMENT_DEPOSIT:             true,
  PAYMENT_WITHDRAWAL_INITIATED: true,
  PAYMENT_WITHDRAWAL_COMPLETED: true,
  PAYMENT_PAYOUT:              true,
};

export type NotificationCategory =
  | "BET_LIFECYCLE"
  | "VERIFICATION"
  | "DISPUTES"
  | "CIRCLES"
  | "PAYMENTS";

export const TRIGGER_CATEGORY: Record<NotificationTrigger, NotificationCategory> = {
  BET_LINE_OPEN:               "BET_LIFECYCLE",
  BET_LINE_REVEALED:           "BET_LIFECYCLE",
  BET_STAKING_OPEN:            "BET_LIFECYCLE",
  BET_STAKING_WARNING:         "BET_LIFECYCLE",
  BET_STAKING_CLOSED:          "BET_LIFECYCLE",
  BET_ACTIVE:                  "BET_LIFECYCLE",
  BET_EXPIRED:                 "BET_LIFECYCLE",
  BET_DISPUTE_WARNING:         "BET_LIFECYCLE",
  BET_RESOLVED_WON:            "BET_LIFECYCLE",
  BET_RESOLVED_LOST:           "BET_LIFECYCLE",
  BET_VOIDED:                  "BET_LIFECYCLE",
  VERIFICATION_NEEDED:         "VERIFICATION",
  VERIFICATION_TIEBREAKER:     "VERIFICATION",
  VERIFICATION_APPROVED:       "VERIFICATION",
  VERIFICATION_DENIED:         "VERIFICATION",
  DISPUTE_RAISED:              "DISPUTES",
  DISPUTE_RESOLVED_ADDED:      "DISPUTES",
  DISPUTE_RESOLVED_REMOVED:    "DISPUTES",
  CIRCLE_JOIN_REQUEST:         "CIRCLES",
  CIRCLE_APPROVED:             "CIRCLES",
  CIRCLE_BET_CREATED:          "CIRCLES",
  CIRCLE_MEMBER_JOINED:        "CIRCLES",
  PAYMENT_DEPOSIT:             "PAYMENTS",
  PAYMENT_WITHDRAWAL_INITIATED: "PAYMENTS",
  PAYMENT_WITHDRAWAL_COMPLETED: "PAYMENTS",
  PAYMENT_PAYOUT:              "PAYMENTS",
};
