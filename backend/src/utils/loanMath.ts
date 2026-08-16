/**
 * Loan derivation maths.
 *
 * Lives in `backend/src/utils/` and NOT in the repo-root `shared/` directory, despite
 * the frontend needing the same numbers. `backend/tsconfig.json` sets
 * `"rootDir": "./src"`, so a `../shared` import fails to compile (TS6059) — and
 * `backend/Dockerfile` runs `tsc ... || true`, which swallows that error. The emitted
 * JS would carry a bare `require("@shared/...")` that resolves nowhere at runtime,
 * because the backend has no `tsconfig-paths`/`module-alias`. The result would be a
 * crash-looping container while the whole test suite reported success.
 *
 * The frontend gets these values from `POST /api/loans/derive` instead.
 */

/**
 * Monthly EMI for a reducing-balance loan:  P·r·(1+r)^n / ((1+r)^n − 1)
 *
 * Returns `null` rather than `NaN` for non-positive inputs, so a form computing this
 * live as the user types (rate still empty, principal half-entered) gets a value it can
 * skip on instead of writing `NaN` into a field.
 *
 * ROUNDS UP, deliberately. `buildAmortizationSchedule` rejects any EMI that does not
 * exceed the first month's interest, and rounding to the nearest paisa can push the
 * exact EMI *below* that floor — e.g. P=₹100 at 24% over 360 months gives 2.001604,
 * which `Math.round` turns into 2.00 against a 2.000000 floor, and the loan is then
 * rejected by the very app that suggested the figure. `Math.ceil` is always ≥ exact, so
 * it always clears the guard.
 */
export function computeEmi(
  principal: number,
  annualRatePct: number,
  tenureMonths: number,
): number | null {
  if (!(principal > 0) || !(annualRatePct > 0) || !(tenureMonths > 0)) return null;

  const monthlyRate = annualRatePct / 100 / 12;
  const growth = Math.pow(1 + monthlyRate, tenureMonths);
  const exact = (principal * monthlyRate * growth) / (growth - 1);

  if (!Number.isFinite(exact)) return null;
  return Math.ceil(exact * 100) / 100;
}

/**
 * Whole months between two dates, floored, never negative.
 *
 * Counts a month only once the day-of-month is reached, so 15 Jan -> 14 Feb is 0 months
 * and 15 Jan -> 15 Feb is 1. That matches how interest accrues in monthly rests.
 */
export function monthsBetween(from: Date, to: Date): number {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(months, 0);
}

/**
 * Total pre-EMI interest: the interest accruing between disbursement and the first full
 * EMI. During that window only interest is paid, so the principal does not amortise and
 * the outstanding balance stays flat.
 *
 * Returns `null` when there is no gap (first EMI in the same month as disbursement) —
 * the ordinary case, where there is no pre-EMI at all.
 */
export function computePreEmi(
  disbursedAmount: number,
  annualRatePct: number,
  disbursementDate: Date,
  firstEmiDate: Date,
): number | null {
  if (!(disbursedAmount > 0) || !(annualRatePct > 0)) return null;

  const months = monthsBetween(disbursementDate, firstEmiDate);
  if (months <= 0) return null;

  const monthly = disbursedAmount * annualRatePct / 100 / 12;
  return Math.ceil(monthly * months * 100) / 100;
}

/** The recurring monthly interest-only payment during that same window. */
export function computeMonthlyPreEmi(
  disbursedAmount: number,
  annualRatePct: number,
): number | null {
  if (!(disbursedAmount > 0) || !(annualRatePct > 0)) return null;
  return Math.ceil((disbursedAmount * annualRatePct / 100 / 12) * 100) / 100;
}

/**
 * Add whole months, clamping the day to the target month's length.
 *
 * `Date.setMonth` overflows instead: 31 Jan + 1 month yields 3 March, silently skipping
 * February. That matters here because an end date derived by overflow would disagree
 * with the loan's actual final payment date.
 *
 * NOTE: `loanService.buildAmortizationSchedule` still uses raw `setMonth` for its row
 * dates, so a schedule for a loan disbursed on the 29th-31st drifts relative to this.
 * Pre-existing; tracked as debt rather than changed inside a security-sensitive task.
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetMonth = result.getMonth() + months;
  const day = result.getDate();

  result.setDate(1);
  result.setMonth(targetMonth);

  const daysInTarget = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, daysInTarget));
  return result;
}

/**
 * Final payment date — `tenureMonths` of full EMIs counted from the FIRST EMI, not from
 * disbursement. A pre-EMI period therefore pushes the end date out by exactly the gap
 * between the two dates, without the caller having to compute that gap.
 *
 * Falls back to disbursement when `firstEmiDate` is absent (no pre-EMI period).
 */
export function deriveEndDate(
  disbursementDate: Date,
  tenureMonths: number,
  firstEmiDate?: Date | null,
): Date | null {
  if (!(tenureMonths > 0) || Number.isNaN(disbursementDate.getTime())) return null;

  // The no-firstEmiDate branch counts from disbursement, which implies the first EMI is
  // one month later — so `tenureMonths` from disbursement is the last payment. Counting
  // from an explicit firstEmiDate must therefore use tenure-1, or the same loan stated
  // both ways comes out a month apart and lingers as a liability after it is repaid.
  if (firstEmiDate && !Number.isNaN(firstEmiDate.getTime()) && firstEmiDate > disbursementDate) {
    return addMonths(firstEmiDate, tenureMonths - 1);
  }
  return addMonths(disbursementDate, tenureMonths);
}
