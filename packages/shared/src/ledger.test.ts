import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  type Balance,
  type LedgerLeg,
  type LedgerOp,
  EXTERNAL_ACCOUNT,
  buildSplitPayout,
  canApply,
  checkInvariants,
  deriveBalances,
  legsFor,
  ledgerSum,
} from "./ledger.js";

const WALLETS = ["w0", "w1", "w2"] as const;

describe("legsFor — every operation is double-entry (sums to 0)", () => {
  it("deposit / withdraw / hold / release each balance to zero", () => {
    const ops: LedgerOp[] = [
      { type: "deposit", wallet: "w0", amount: 5000 },
      { type: "withdraw", wallet: "w0", amount: 1234 },
      { type: "hold", wallet: "w0", amount: 999 },
      { type: "release", wallet: "w0", amount: 1 },
    ];
    for (const op of ops) {
      expect(ledgerSum(legsFor(op))).toBe(0);
    }
  });

  it("a split payout balances to zero and loses no cent", () => {
    // 100 cents from w0's held, split 3 ways -> 34 + 33 + 33.
    const payout = buildSplitPayout("w0", 100, ["w1", "w2", "w0"]);
    const legs = legsFor(payout);
    expect(ledgerSum(legs)).toBe(0);
    const credited = payout.credits.reduce((s, c) => s + c.amount, 0);
    expect(credited).toBe(100);
  });

  it("rejects an unbalanced payout", () => {
    expect(() =>
      legsFor({
        type: "payout",
        debits: [{ wallet: "w0", amount: 100 }],
        credits: [{ wallet: "w1", amount: 90 }],
      }),
    ).toThrow(/balance/);
  });

  it("rejects non-positive amounts", () => {
    expect(() => legsFor({ type: "deposit", wallet: "w0", amount: 0 })).toThrow();
    expect(() => legsFor({ type: "hold", wallet: "w0", amount: -5 })).toThrow();
  });
});

/**
 * A randomly-generated operation over the fixed wallet set. Amounts are kept in
 * a modest cent range so sequences exercise both sufficient- and
 * insufficient-funds paths.
 */
const arbOp: fc.Arbitrary<LedgerOp> = fc.oneof(
  fc.record({
    type: fc.constant("deposit" as const),
    wallet: fc.constantFrom(...WALLETS),
    amount: fc.integer({ min: 1, max: 10_000 }),
  }),
  fc.record({
    type: fc.constant("withdraw" as const),
    wallet: fc.constantFrom(...WALLETS),
    amount: fc.integer({ min: 1, max: 10_000 }),
  }),
  fc.record({
    type: fc.constant("hold" as const),
    wallet: fc.constantFrom(...WALLETS),
    amount: fc.integer({ min: 1, max: 10_000 }),
  }),
  fc.record({
    type: fc.constant("release" as const),
    wallet: fc.constantFrom(...WALLETS),
    amount: fc.integer({ min: 1, max: 10_000 }),
  }),
  // A payout drawing from one wallet's held, split across a subset of wallets.
  fc
    .record({
      from: fc.constantFrom(...WALLETS),
      amount: fc.integer({ min: 1, max: 10_000 }),
      to: fc.subarray([...WALLETS], { minLength: 1 }),
    })
    .map(({ from, amount, to }) => buildSplitPayout(from, amount, to)),
);

describe("ledger invariants hold across random valid op sequences", () => {
  it("never drives a wallet negative and always balances to zero", () => {
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 200 }), (candidateOps) => {
        const legs: LedgerLeg[] = [];
        let balances = new Map<string, Balance>();

        for (const op of candidateOps) {
          // Only apply operations that are valid given the current state —
          // exactly the guard the backend services enforce before persisting.
          if (!canApply(op, balances)) continue;
          legs.push(...legsFor(op));
          balances = deriveBalances(legs);

          // Invariants must hold after EVERY applied operation.
          for (const [account, b] of balances) {
            if (account === EXTERNAL_ACCOUNT) continue;
            expect(b.available).toBeGreaterThanOrEqual(0);
            expect(b.held).toBeGreaterThanOrEqual(0);
          }
        }

        // The whole ledger reconciles to exactly zero.
        expect(ledgerSum(legs)).toBe(0);
        expect(checkInvariants(legs)).toHaveLength(0);
      }),
      { numRuns: 500 },
    );
  });

  it("total held + available across user wallets equals net deposited", () => {
    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 200 }), (candidateOps) => {
        const legs: LedgerLeg[] = [];
        let balances = new Map<string, Balance>();
        let netExternal = 0; // deposits in minus withdrawals out

        for (const op of candidateOps) {
          if (!canApply(op, balances)) continue;
          if (op.type === "deposit") netExternal += op.amount;
          if (op.type === "withdraw") netExternal -= op.amount;
          legs.push(...legsFor(op));
          balances = deriveBalances(legs);
        }

        // Sum of all user wallets (available + held) must equal what entered the
        // system from outside — money is only created/destroyed via external.
        let userTotal = 0;
        for (const [account, b] of balances) {
          if (account === EXTERNAL_ACCOUNT) continue;
          userTotal += b.available + b.held;
        }
        expect(userTotal).toBe(netExternal);
      }),
      { numRuns: 500 },
    );
  });
});
