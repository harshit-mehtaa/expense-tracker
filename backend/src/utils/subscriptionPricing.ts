/**
 * Subscription price resolution.
 *
 * A subscription's price is not a field — it is a history. `SubscriptionPrice` rows each
 * carry an `effectiveFrom`, and the price on any given date is the row with the greatest
 * `effectiveFrom` that is not after that date.
 *
 * This matters because `generateRuleCatchUp` backfills missed occurrences, up to 366 of
 * them. If it read a single current amount, a price rise recorded today would
 * retroactively reprice every backfilled month — so a container that was down across a
 * price change would post a ledger that never happened.
 *
 * Deliberately PURE and synchronous, operating on an already-loaded array. Generation
 * resolves the price inside a `$transaction` whose atomic `updateMany` guard is what
 * makes concurrent schedulers safe; adding a query there would widen that window.
 */

export interface PricePoint {
  amount: number;
  effectiveFrom: Date;
}

/**
 * The price in effect on `date`, or `null` if the subscription had no price yet.
 *
 * Returns `null` rather than falling back to the earliest or latest price: a missing
 * price means the data is wrong, and silently charging *some* number would bury that.
 * Callers are expected to fail loudly.
 *
 * Boundary: a price effective at exactly `date` DOES apply on that date. A subscription
 * whose price changes on the same day its charge falls due is charged the new price —
 * which is how a vendor bills it.
 */
export function priceAsOf(prices: PricePoint[], date: Date): number | null {
  if (!prices.length || Number.isNaN(date.getTime())) return null;

  let best: PricePoint | null = null;
  for (const price of prices) {
    if (Number.isNaN(price.effectiveFrom.getTime())) continue;
    if (price.effectiveFrom.getTime() > date.getTime()) continue;
    if (best === null || price.effectiveFrom.getTime() > best.effectiveFrom.getTime()) {
      best = price;
    }
  }

  return best === null ? null : best.amount;
}

/**
 * What the user is paying RIGHT NOW.
 *
 * Deliberately `priceAsOf(prices, now)` rather than "the newest row": a price recorded
 * as effective next month is real history, but it is not what is being charged today.
 * Returning it would make the card disagree with what generation actually bills.
 */
export function currentPrice(prices: PricePoint[], now: Date = new Date()): number | null {
  return priceAsOf(prices, now);
}

/**
 * Annualised cost of a price at a given billing frequency.
 *
 * Weekly uses 52 and daily 365, so both are approximations — a year holds 52.18 weeks.
 * Exactness is not available here anyway (leap years, month lengths); this exists to
 * rank subscriptions by what they cost, where being a few rupees out over a year does
 * not change any decision.
 */
export function annualisedCost(amount: number, frequency: string): number {
  const multiplier: Record<string, number> = {
    DAILY: 365,
    WEEKLY: 52,
    MONTHLY: 12,
    QUARTERLY: 4,
    YEARLY: 1,
  };
  const factor = multiplier[frequency];
  if (factor === undefined) return 0;
  return Math.round(amount * factor * 100) / 100;
}
