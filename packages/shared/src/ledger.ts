/**
 * Pure, append-only, double-entry ledger rules.
 *
 * This module owns the *meaning* of every money movement: what postings a
 * deposit / withdrawal / hold / release / payout produce, and the invariants
 * the ledger must always satisfy. It is intentionally free of any database or
 * I/O so it can be exhaustively property-tested (see ledger.test.ts). The
 * backend persists exactly these legs to Postgres; it never re-derives the
 * rules itself. This is the single source of truth that keeps the on-disk
 * ledger provably correct.
 *
 * Core ideas:
 *  - Every wallet has two sub-balances ("buckets"): `available` (spendable) and
 *    `held` (escrowed for an active stake). A balance is always *derived* by
 *    summing legs — never stored as a mutable number.
 *  - Every operation emits a set of signed legs that sum to exactly 0
 *    (double-entry). Money entering/leaving the system flows through the
 *    EXTERNAL_ACCOUNT sentinel so even deposits/withdrawals net to zero.
 */
import type { Cents } from "./money.js";
import { allocateProportional } from "./money.js";

/** The two sub-balances every wallet tracks. */
export type Bucket = "available" | "held";

/**
 * Sentinel account for money entering/leaving the system (deposits/withdrawals).
 * In the backend this maps to the singleton SYSTEM wallet. Modelling it as a
 * real leg is what keeps deposits/withdrawals double-entry. Its balance is
 * unconstrained (it represents the system's net external float).
 */
export const EXTERNAL_ACCOUNT = "__external__";

/** One posting in the append-only ledger. `amount` is signed cents. */
export interface LedgerLeg {
  /** A wallet id, or EXTERNAL_ACCOUNT. */
  account: string;
  bucket: Bucket;
  /** Positive = credit into the bucket, negative = debit. */
  amount: Cents;
}

/** A wallet's two derived sub-balances. */
export interface Balance {
  available: Cents;
  held: Cents;
}

/** A movement of held funds out of one or more wallets into others' available. */
export interface PayoutLeg {
  wallet: string;
  amount: Cents;
}

/** The set of money operations the ledger understands. */
export type LedgerOp =
  | { type: "deposit"; wallet: string; amount: Cents }
  | { type: "withdraw"; wallet: string; amount: Cents }
  | { type: "hold"; wallet: string; amount: Cents }
  | { type: "release"; wallet: string; amount: Cents }
  | {
      type: "payout";
      /** Funds removed from these wallets' `held`. */
      debits: ReadonlyArray<PayoutLeg>;
      /** Funds added to these wallets' `available`. */
      credits: ReadonlyArray<PayoutLeg>;
    };

function assertPositiveInt(amount: Cents, label: string): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive integer cent amount, got ${amount}`);
  }
}

/**
 * Translate an operation into the balanced set of ledger legs it produces.
 * The returned legs always sum to exactly 0 (double-entry).
 */
export function legsFor(op: LedgerOp): LedgerLeg[] {
  switch (op.type) {
    case "deposit":
      assertPositiveInt(op.amount, "deposit");
      return [
        { account: EXTERNAL_ACCOUNT, bucket: "available", amount: -op.amount },
        { account: op.wallet, bucket: "available", amount: op.amount },
      ];
    case "withdraw":
      assertPositiveInt(op.amount, "withdraw");
      return [
        { account: op.wallet, bucket: "available", amount: -op.amount },
        { account: EXTERNAL_ACCOUNT, bucket: "available", amount: op.amount },
      ];
    case "hold":
      assertPositiveInt(op.amount, "hold");
      return [
        { account: op.wallet, bucket: "available", amount: -op.amount },
        { account: op.wallet, bucket: "held", amount: op.amount },
      ];
    case "release":
      assertPositiveInt(op.amount, "release");
      return [
        { account: op.wallet, bucket: "held", amount: -op.amount },
        { account: op.wallet, bucket: "available", amount: op.amount },
      ];
    case "payout": {
      const legs: LedgerLeg[] = [];
      for (const d of op.debits) {
        assertPositiveInt(d.amount, "payout debit");
        legs.push({ account: d.wallet, bucket: "held", amount: -d.amount });
      }
      for (const c of op.credits) {
        assertPositiveInt(c.amount, "payout credit");
        legs.push({ account: c.wallet, bucket: "available", amount: c.amount });
      }
      const debited = op.debits.reduce((s, d) => s + d.amount, 0);
      const credited = op.credits.reduce((s, c) => s + c.amount, 0);
      if (debited !== credited) {
        throw new Error(
          `payout must balance: debited ${debited} != credited ${credited}`,
        );
      }
      return legs;
    }
  }
}

/** Sum a set of legs into per-account balances. */
export function deriveBalances(legs: Iterable<LedgerLeg>): Map<string, Balance> {
  const balances = new Map<string, Balance>();
  for (const leg of legs) {
    const current = balances.get(leg.account) ?? { available: 0, held: 0 };
    if (leg.bucket === "available") current.available += leg.amount;
    else current.held += leg.amount;
    balances.set(leg.account, current);
  }
  return balances;
}

/** The signed sum of every leg. Must be 0 for a well-formed ledger. */
export function ledgerSum(legs: Iterable<LedgerLeg>): Cents {
  let sum = 0;
  for (const leg of legs) sum += leg.amount;
  return sum;
}

/** Get a single account's derived balance from a leg set. */
export function balanceOf(legs: Iterable<LedgerLeg>, account: string): Balance {
  return deriveBalances(legs).get(account) ?? { available: 0, held: 0 };
}

export interface InvariantViolation {
  account: string;
  reason: string;
}

/**
 * Check the ledger's invariants over a complete leg set:
 *  - no user wallet has negative `available` or `held`
 *  - the whole ledger sums to exactly 0
 * EXTERNAL_ACCOUNT is exempt from the non-negativity check by design.
 */
export function checkInvariants(legs: Iterable<LedgerLeg>): InvariantViolation[] {
  const materialised = [...legs];
  const violations: InvariantViolation[] = [];
  for (const [account, balance] of deriveBalances(materialised)) {
    if (account === EXTERNAL_ACCOUNT) continue;
    if (balance.available < 0) {
      violations.push({ account, reason: `available ${balance.available} < 0` });
    }
    if (balance.held < 0) {
      violations.push({ account, reason: `held ${balance.held} < 0` });
    }
  }
  const total = ledgerSum(materialised);
  if (total !== 0) {
    violations.push({ account: "<ledger>", reason: `does not balance to 0: ${total}` });
  }
  return violations;
}

/**
 * Whether `op` is applicable given current per-account balances, i.e. it would
 * not drive any wallet negative. Used both by the property test and by the
 * backend services to reject insufficient-funds requests before persisting.
 */
export function canApply(op: LedgerOp, balances: Map<string, Balance>): boolean {
  const get = (w: string): Balance => balances.get(w) ?? { available: 0, held: 0 };
  switch (op.type) {
    case "deposit":
      return Number.isInteger(op.amount) && op.amount > 0;
    case "withdraw":
    case "hold":
      return (
        Number.isInteger(op.amount) &&
        op.amount > 0 &&
        get(op.wallet).available >= op.amount
      );
    case "release":
      return (
        Number.isInteger(op.amount) &&
        op.amount > 0 &&
        get(op.wallet).held >= op.amount
      );
    case "payout": {
      const debited = op.debits.reduce((s, d) => s + d.amount, 0);
      const credited = op.credits.reduce((s, c) => s + c.amount, 0);
      if (debited !== credited || debited <= 0) return false;
      // Each debited wallet must have enough held (aggregate by wallet).
      const perWallet = new Map<string, Cents>();
      for (const d of op.debits) {
        if (!Number.isInteger(d.amount) || d.amount <= 0) return false;
        perWallet.set(d.wallet, (perWallet.get(d.wallet) ?? 0) + d.amount);
      }
      for (const [wallet, amount] of perWallet) {
        if (get(wallet).held < amount) return false;
      }
      return op.credits.every((c) => Number.isInteger(c.amount) && c.amount > 0);
    }
  }
}

/**
 * Build a payout that moves `amount` cents out of `fromWallet`'s held balance,
 * splitting it across `toWallets`' available using the exact largest-remainder
 * allocator (no cent created or lost). A convenience for tests and callers;
 * real parimutuel payouts compute their own credit amounts.
 */
export function buildSplitPayout(
  fromWallet: string,
  amount: Cents,
  toWallets: string[],
): Extract<LedgerOp, { type: "payout" }> {
  const shares = allocateProportional(amount, toWallets.map(() => 1));
  const credits: PayoutLeg[] = toWallets
    .map((wallet, i) => ({ wallet, amount: shares[i] ?? 0 }))
    .filter((c) => c.amount > 0);
  return { type: "payout", debits: [{ wallet: fromWallet, amount }], credits };
}
