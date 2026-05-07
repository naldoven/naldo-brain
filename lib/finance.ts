/**
 * Finance & goals constants. Single-source-of-truth for debt-free progress
 * and other financial targets surfaced across the dashboard.
 *
 * Update DEBT_REMAINING here whenever you make a payment — Goals + sidebar
 * read from this file. (Future: move to a Supabase row so updates don't
 * require a code push.)
 */

// Original business debt — the starting line. Don't change this; it's the
// reference point that progress is measured against.
export const DEBT_INITIAL = 55000;

// Current outstanding balance. Update this number when debt changes.
// As of 2026-05-07: $27,200 (50% paid off).
export const DEBT_REMAINING = 27200;

// Derived figures — don't edit, computed from the two above.
export const DEBT_PAID = Math.max(0, DEBT_INITIAL - DEBT_REMAINING);
export const DEBT_PAID_PCT = Math.min(
  100,
  Math.max(0, (DEBT_PAID / DEBT_INITIAL) * 100),
);

// USD formatter used by trackers
export function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}
