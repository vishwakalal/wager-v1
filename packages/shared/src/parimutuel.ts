/**
 * Parimutuel payout math (spec §4.3).
 *
 * There are no fixed odds. Each winner gets their stake back plus a share of the
 * losing pool proportional to their stake within the winning pool:
 *
 *   winnings_i = distributableLosingPool * (stake_i / winningPoolTotal)
 *   payout_i   = stake_i + winnings_i
 *
 * where distributableLosingPool = losingPoolTotal - rake.
 *
 * All amounts are integer cents. Winnings are allocated with the
 * largest-remainder method so the total paid out equals the total pot exactly
 * (no cents created or destroyed) — essential for ledger integrity.
 */
import { allocateProportional, type Cents } from "./money.js";
import { RAKE_BPS } from "./constants.js";

export interface StakeShare {
  userId: string;
  /** Effective (post-cap) stake in cents. */
  stake: Cents;
}

export interface Payout {
  userId: string;
  stake: Cents;
  /** Share of the losing pool this winner earns. */
  winnings: Cents;
  /** stake + winnings — total credited back to the wallet. */
  payout: Cents;
}

export interface ParimutuelResult {
  payouts: Payout[];
  winningPoolTotal: Cents;
  losingPoolTotal: Cents;
  /** Rake taken from the losing pool (0 in v1). */
  rake: Cents;
  /** Losing pool after rake — the amount distributed to winners. */
  distributed: Cents;
}

/**
 * Compute payouts for the winning side.
 *
 * @param winners   effective stakes on the winning side
 * @param losingPoolTotal  total effective stakes on the losing side
 * @param rakeBps   platform rake in basis points (default: spec value, 0 in v1)
 */
export function computeParimutuelPayouts(
  winners: StakeShare[],
  losingPoolTotal: Cents,
  rakeBps: number = RAKE_BPS,
): ParimutuelResult {
  const winningPoolTotal = winners.reduce((sum, w) => sum + w.stake, 0);
  const rake = Math.round((losingPoolTotal * rakeBps) / 10_000);
  const distributed = losingPoolTotal - rake;

  // If there is no winning pool, there are no winners to pay (callers should
  // have voided a one-sided bet long before this — see spec §4.2).
  if (winningPoolTotal <= 0) {
    return {
      payouts: [],
      winningPoolTotal,
      losingPoolTotal,
      rake,
      distributed,
    };
  }

  const winningsByWinner = allocateProportional(
    distributed,
    winners.map((w) => w.stake),
  );

  const payouts: Payout[] = winners.map((w, i) => {
    const winnings = winningsByWinner[i]!;
    return { userId: w.userId, stake: w.stake, winnings, payout: w.stake + winnings };
  });

  return { payouts, winningPoolTotal, losingPoolTotal, rake, distributed };
}
