/**
 * Stake validation, the 5x relative cap, and one-sided/empty void detection
 * (spec §4.2).
 *
 * The relative cap keeps any single person from dominating the proportional
 * payout: no one may stake more than 5x the lowest staker in the bet. Excess
 * above the cap is automatically refunded *before* odds are calculated.
 */
import { MIN_STAKE, RELATIVE_CAP_MULTIPLE } from "./constants.js";
import type { Cents } from "./money.js";

export type Side = "over" | "under" | "yes" | "no";

export interface RawStake {
  userId: string;
  side: Side;
  /** Amount the user attempted to stake, in cents. */
  amount: Cents;
}

export interface CappedStake {
  userId: string;
  side: Side;
  /** Original requested amount. */
  amount: Cents;
  /** Amount actually staked after applying the 5x cap. */
  effective: Cents;
  /** Amount refunded for exceeding the cap (amount - effective). */
  refund: Cents;
}

export type VoidReason = "no_stakes" | "one_sided";

export interface StakingResolution {
  /** Per-staker effective amounts and refunds after the cap. */
  stakes: CappedStake[];
  /** The cap that was applied (5x the lowest effective staker), or null if voided. */
  capPerUser: Cents | null;
  /** If set, the bet must be voided and *all* stakes refunded (spec §4.2). */
  voided: VoidReason | null;
}

/** Whether a single stake meets the minimum (spec §4.2). Caller enforces wallet balance. */
export function isStakeAboveMinimum(amount: Cents): boolean {
  return amount >= MIN_STAKE;
}

/**
 * Apply the staking rules at window close:
 *  1. Determine the lowest staker.
 *  2. Cap every stake at 5x that lowest amount, refunding the excess.
 *  3. Void (refund everyone) if there are zero stakes, or only one side staked.
 *
 * Note the cap is based on the **lowest stake**, which is unaffected by capping
 * (capping only ever lowers high stakes), so a single pass is correct.
 */
export function resolveStaking(rawStakes: RawStake[]): StakingResolution {
  if (rawStakes.length === 0) {
    return { stakes: [], capPerUser: null, voided: "no_stakes" };
  }

  const lowest = Math.min(...rawStakes.map((s) => s.amount));
  const capPerUser = lowest * RELATIVE_CAP_MULTIPLE;

  const stakes: CappedStake[] = rawStakes.map((s) => {
    const effective = Math.min(s.amount, capPerUser);
    return { userId: s.userId, side: s.side, amount: s.amount, effective, refund: s.amount - effective };
  });

  // One-sided check uses the two opposing sides for whichever bet type this is.
  const sides = new Set(stakes.map((s) => s.side));
  const bothSidesPresent =
    (sides.has("over") && sides.has("under")) || (sides.has("yes") && sides.has("no"));

  if (!bothSidesPresent) {
    return { stakes, capPerUser, voided: "one_sided" };
  }

  return { stakes, capPerUser, voided: null };
}
