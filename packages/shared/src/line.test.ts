import { describe, it, expect } from "vitest";
import { trimmedMeanLine } from "./line.js";

describe("trimmedMeanLine — spec §3", () => {
  it("drops one highest and one lowest, averages the rest", () => {
    // Drop 10 and 100; average 40,50,60 = 50.
    const res = trimmedMeanLine([50, 10, 100, 40, 60]);
    expect(res.line).toBe(50);
    expect(res.dropped).toEqual({ low: 10, high: 100 });
    expect(res.kept).toEqual([40, 50, 60]);
  });

  it("neutralizes a single malicious outlier", () => {
    // A saboteur submits 1,000,000; honest submissions cluster near 89.5.
    const res = trimmedMeanLine([88, 90, 91, 89, 1_000_000]);
    // Dropping the 1,000,000 (high) and 88 (low) leaves 89,90,91 -> 90.
    expect(res.line).toBe(90);
  });

  it("handles ties by dropping a single instance of min and max", () => {
    const res = trimmedMeanLine([5, 5, 5, 5]);
    expect(res.line).toBe(5);
    expect(res.kept).toEqual([5, 5]);
  });

  it("works for a minimal numeric circle of 4", () => {
    const res = trimmedMeanLine([3, 4, 5, 8]);
    // Drop 3 and 8 -> average 4,5 = 4.5
    expect(res.line).toBe(4.5);
  });

  it("falls back to a plain mean below 3 submissions", () => {
    expect(trimmedMeanLine([10, 20]).line).toBe(15);
    expect(trimmedMeanLine([7]).line).toBe(7);
  });

  it("throws on no submissions", () => {
    expect(() => trimmedMeanLine([])).toThrow();
  });
});
