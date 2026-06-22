import { describe, it, expect } from "vitest";
import { computeParimutuelPayouts, type StakeShare } from "./parimutuel.js";
import { dollarsToCents } from "./money.js";

const $ = dollarsToCents;

/**
 * The canonical worked example from spec §4.3 — line is 3.5 meals/day.
 *   Over pool:  Jake $50, Sarah $20, Mike $10  -> $80
 *   Under pool: John $30, Lisa $30             -> $60
 */
const overPool: StakeShare[] = [
  { userId: "jake", stake: $(50) },
  { userId: "sarah", stake: $(20) },
  { userId: "mike", stake: $(10) },
];
const underPool: StakeShare[] = [
  { userId: "john", stake: $(30) },
  { userId: "lisa", stake: $(30) },
];

describe("computeParimutuelPayouts — spec §4.3 example", () => {
  it("pays Under correctly when Under wins", () => {
    const res = computeParimutuelPayouts(underPool, /* losing(over) */ $(80));
    const john = res.payouts.find((p) => p.userId === "john")!;
    const lisa = res.payouts.find((p) => p.userId === "lisa")!;

    // Each gets 50% of the $80 losing pool ($40) + their $30 stake = $70.
    expect(john.winnings).toBe($(40));
    expect(john.payout).toBe($(70));
    expect(lisa.payout).toBe($(70));
  });

  it("pays Over correctly when Over wins", () => {
    const res = computeParimutuelPayouts(overPool, /* losing(under) */ $(60));
    const jake = res.payouts.find((p) => p.userId === "jake")!;
    const sarah = res.payouts.find((p) => p.userId === "sarah")!;
    const mike = res.payouts.find((p) => p.userId === "mike")!;

    // Jake: 62.5% of $60 = $37.50 winnings + $50 = $87.50.
    expect(jake.winnings).toBe($(37.5));
    expect(jake.payout).toBe($(87.5));
    expect(sarah.payout).toBe($(35));
    expect(mike.payout).toBe($(17.5));
  });
});

describe("computeParimutuelPayouts — invariants", () => {
  it("distributes the entire losing pool with no cents lost or created", () => {
    // Awkward numbers that don't divide cleanly.
    const winners: StakeShare[] = [
      { userId: "a", stake: 333 },
      { userId: "b", stake: 333 },
      { userId: "c", stake: 334 },
    ];
    const losing = 1001; // $10.01
    const res = computeParimutuelPayouts(winners, losing);
    const totalWinnings = res.payouts.reduce((s, p) => s + p.winnings, 0);
    expect(totalWinnings).toBe(losing); // exact, no rake in v1
  });

  it("applies a rake to the losing pool when enabled", () => {
    const winners: StakeShare[] = [{ userId: "a", stake: $(100) }];
    const res = computeParimutuelPayouts(winners, $(100), 200); // 2% rake
    expect(res.rake).toBe($(2));
    expect(res.distributed).toBe($(98));
    expect(res.payouts[0]!.payout).toBe($(198));
  });

  it("pays no one when the winning pool is empty", () => {
    const res = computeParimutuelPayouts([], $(80));
    expect(res.payouts).toEqual([]);
  });
});
