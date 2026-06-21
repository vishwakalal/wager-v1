/**
 * Blind line setting via trimmed mean (spec §3).
 *
 * Every circle member privately submits the line they think is fair. We drop a
 * single highest and a single lowest submission, then average the rest. This
 * stops one outlier — accidental or malicious — from skewing the line, and
 * works for circles of 4 and circles of 50 alike (spec §3.2).
 */

export interface TrimmedMeanResult {
  /** The resulting line (not rounded — caller decides display precision). */
  line: number;
  /** Submissions actually averaged, after trimming. */
  kept: number[];
  /** The one low and one high value that were dropped (if any). */
  dropped: { low: number; high: number } | null;
}

/**
 * Compute the trimmed mean of blind line submissions.
 *
 * - With >= 3 submissions: drop one min + one max, average the remainder.
 * - With < 3 submissions there is nothing meaningful to trim, so we fall back to
 *   a plain mean. (Numeric bets require >= 4 members per spec §2.2, so in
 *   practice we always trim; this keeps the function total and safe.)
 *
 * @throws if `submissions` is empty.
 */
export function trimmedMeanLine(submissions: number[]): TrimmedMeanResult {
  if (submissions.length === 0) {
    throw new Error("trimmedMeanLine: at least one submission is required");
  }

  const sorted = [...submissions].sort((a, b) => a - b);

  if (sorted.length < 3) {
    const line = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    return { line, kept: sorted, dropped: null };
  }

  const low = sorted[0]!;
  const high = sorted[sorted.length - 1]!;
  const kept = sorted.slice(1, -1);
  const line = kept.reduce((a, b) => a + b, 0) / kept.length;

  return { line, kept, dropped: { low, high } };
}
