/**
 * Date presentation — dd/mm/yyyy, everywhere.
 *
 * `toLocaleDateString('en-IN')` was used at 19 call sites and does NOT produce this:
 * it renders 5 August 2026 as `5/8/2026`, unpadded, so any single-digit day or month
 * comes out in a different shape from the rest. Two-digit padding is the point of asking
 * for dd/mm/yyyy.
 *
 * Formatted by hand rather than via `toLocaleDateString('en-GB')`, which would also give
 * the right shape. A locale-based formatter depends on the runtime shipping correct ICU
 * data — Node builds without full ICU, minimal container images and older browsers all
 * silently fall back to something else, and the failure looks like a cosmetic wobble
 * rather than a bug. Hand-formatting is deterministic in every runtime and in CI.
 *
 * Mirrors the convention already stated in `backend/src/utils/indianFormat.ts`:
 * "Never use raw .toLocaleString() without these helpers."
 */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Parses whatever the API hands us. Returns `null` for anything unusable so callers can
 * render a dash instead of the string "Invalid Date".
 */
function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * dd/mm/yyyy.
 *
 * Uses LOCAL getters, matching what `toLocaleDateString` did before. Switching to UTC
 * getters would shift every date by a day for anyone east of Greenwich whose timestamp
 * falls near midnight — a silent, product-wide off-by-one.
 */
export function formatDate(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** dd/mm/yyyy HH:mm, 24-hour — for audit trails and anything needing the time of day. */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The next calendar date a day-of-month recurrence lands on.
 *
 * `emiDate`, `sipDate` and `premiumDueDate` are stored as day-of-month integers, not
 * dates — "5" means "the 5th of every month". Rendering the bare number made the user do
 * the arithmetic, and the two sites that dressed it up appended a hardcoded "th",
 * producing "1th" and "21th".
 *
 * Today counts as the next occurrence: money due today has not been missed.
 *
 * Clamps to the length of the target month. `emiDate`/`sipDate` are capped at 28 in the
 * schema so they never need it, but `premiumDueDate` is an unbounded `Int?` — a 31 there
 * would otherwise roll into the 1st of the following month via Date's overflow, quietly
 * reporting a due date in the wrong month.
 */
export function nextOccurrence(dayOfMonth: number | null | undefined, from: Date = new Date()): Date | null {
  if (dayOfMonth === null || dayOfMonth === undefined) return null;
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;

  const year = from.getFullYear();
  const month = from.getMonth();

  const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const clamp = (y: number, m: number) => Math.min(dayOfMonth, daysIn(y, m));

  // Still to come this month (or due today)?
  if (from.getDate() <= clamp(year, month)) {
    return new Date(year, month, clamp(year, month));
  }
  // Otherwise next month, which may roll the year.
  const nextMonth = month + 1;
  const y = nextMonth > 11 ? year + 1 : year;
  const m = nextMonth > 11 ? 0 : nextMonth;
  return new Date(y, m, clamp(y, m));
}

/** `nextOccurrence` rendered as dd/mm/yyyy — the common case at the call sites. */
export function formatNextOccurrence(
  dayOfMonth: number | null | undefined,
  from: Date = new Date(),
): string {
  const d = nextOccurrence(dayOfMonth, from);
  return d ? formatDate(d) : '—';
}

/**
 * Add whole months, clamping the day to the target month's length.
 *
 * `Date.setMonth` overflows instead: 31 January + 1 month becomes 3 March, silently
 * skipping February. Mirrors `backend/src/utils/loanMath.ts addMonths`.
 */
export function addMonths(value: Date | string | number, months: number): Date | null {
  const d = toDate(value);
  if (!d) return null;
  const day = d.getDate();
  const result = new Date(d.getTime());
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const daysInTarget = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, daysInTarget));
  return result;
}

/** `<input type="date">` wants yyyy-mm-dd, and it must be LOCAL — `toISOString()` is UTC,
 *  so between 00:00 and 05:29 IST it yields yesterday. On a field that drives billing,
 *  yesterday means "charge now". */
export function toDateInputValue(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
