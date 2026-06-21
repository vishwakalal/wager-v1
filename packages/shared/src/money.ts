/**
 * Money is represented everywhere as an integer number of **cents** (USD).
 *
 * We never use floating-point dollars for storage or math. This keeps the
 * ledger exact and makes the "reconcile to zero" invariant provable. The
 * `Cents` brand exists to make accidental dollar/cents mixups a type error at
 * call sites that opt in.
 */
export type Cents = number;

/** Convert a dollar amount (may have cents) to integer cents. */
export function dollarsToCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

/** Convert integer cents to a dollar number (for display only). */
export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

/** Format cents as a USD string, e.g. 8750 -> "$87.50". */
export function formatUsd(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Distribute `total` cents across `weights` proportionally, returning integer
 * cent amounts that sum **exactly** to `total` (largest-remainder method).
 *
 * This is the backbone of parimutuel payouts: it guarantees no cent is created
 * or lost, which is what lets the ledger always balance to zero.
 */
export function allocateProportional(total: Cents, weights: number[]): Cents[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  // Hand out the leftover cents to the largest fractional remainders first.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++) {
    const entry = order[k]!;
    result[entry.i]! += 1;
    remainder -= 1;
  }
  return result;
}
