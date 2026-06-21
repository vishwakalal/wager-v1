import { describe, it, expect } from "vitest";
import { resolveStaking, isStakeAboveMinimum, type RawStake } from "./staking.js";
import { dollarsToCents } from "./money.js";

const $ = dollarsToCents;

describe("isStakeAboveMinimum — spec §4.2", () => {
  it("requires at least $1", () => {
    expect(isStakeAboveMinimum($(1))).toBe(true);
    expect(isStakeAboveMinimum($(0.99))).toBe(false);
  });
});

describe("resolveStaking — 5x relative cap (spec §4.2)", () => {
  it("caps stakes above 5x the lowest staker and refunds the excess", () => {
    const raw: RawStake[] = [
      { userId: "whale", side: "over", amount: $(100) }, // lowest is $10 -> cap $50
      { userId: "min", side: "under", amount: $(10) },
    ];
    const res = resolveStaking(raw);
    expect(res.capPerUser).toBe($(50));
    const whale = res.stakes.find((s) => s.userId === "whale")!;
    expect(whale.effective).toBe($(50));
    expect(whale.refund).toBe($(50));
    const min = res.stakes.find((s) => s.userId === "min")!;
    expect(min.effective).toBe($(10));
    expect(min.refund).toBe(0);
    expect(res.voided).toBeNull();
  });

  it("leaves stakes untouched when none exceed the cap", () => {
    const raw: RawStake[] = [
      { userId: "a", side: "yes", amount: $(20) },
      { userId: "b", side: "no", amount: $(30) },
    ];
    const res = resolveStaking(raw);
    expect(res.stakes.every((s) => s.refund === 0)).toBe(true);
    expect(res.voided).toBeNull();
  });
});

describe("resolveStaking — void conditions (spec §4.2)", () => {
  it("voids with no stakes", () => {
    expect(resolveStaking([]).voided).toBe("no_stakes");
  });

  it("voids when only one side staked (numeric)", () => {
    const raw: RawStake[] = [
      { userId: "a", side: "over", amount: $(10) },
      { userId: "b", side: "over", amount: $(20) },
    ];
    expect(resolveStaking(raw).voided).toBe("one_sided");
  });

  it("voids when only one side staked (binary)", () => {
    const raw: RawStake[] = [{ userId: "a", side: "yes", amount: $(10) }];
    expect(resolveStaking(raw).voided).toBe("one_sided");
  });
});
