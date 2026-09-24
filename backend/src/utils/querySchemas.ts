import { z } from 'zod';
import { isValidFY } from './financialYear';

/**
 * Building blocks for inline query-string schemas.
 *
 * The query contract (middleware/queryContract.ts) guarantees every req.query value
 * is one string; these check what that string SAYS, so a bad value is a 422 instead
 * of reaching Prisma as NaN / Invalid Date / an unknown enum and surfacing as a 500.
 *
 * An empty or whitespace-only value (`?minAmount=`) means "not supplied", matching how
 * the routes treated falsy strings before validation existed (and so " " is not 0).
 */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** Wrap any schema as an optional query value (empty → undefined). */
export const optionalQuery = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());

/** Optional free-text string (empty → undefined). Length is bounded by the URL itself. */
export const optionalQueryString = () => optionalQuery(z.string());

/** Optional finite number, e.g. `?minAmount=500`. */
export const optionalQueryNumber = () =>
  z.preprocess(emptyToUndefined, z.coerce.number().finite().optional());

/** Optional integer within [min, max], e.g. `?days=30`. */
export const optionalQueryInt = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).optional());

/** Optional CUID (entity ids and pagination cursors). */
export const optionalQueryCuid = () =>
  z.preprocess(emptyToUndefined, z.string().cuid().optional());

/**
 * A calendar date (YYYY-MM-DD, interpreted in IST downstream) or a full ISO datetime.
 * Checks that the date is real, not just shaped right: 2025-13-45 is rejected.
 */
export const optionalQueryDate = () =>
  z.preprocess(
    emptyToUndefined,
    z.string()
      .refine((s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return z.string().datetime({ offset: true }).safeParse(s).success;
        const [y, mo, day] = [+m[1], +m[2], +m[3]];
        if (y < 1900 || y > 2200) return false; // same supported range as isValidFY
        const d = new Date(Date.UTC(y, mo - 1, day));
        return d.getUTCMonth() === mo - 1 && d.getUTCDate() === day;
      }, 'Expected a date (YYYY-MM-DD) or ISO datetime')
      .optional(),
  );

/** Financial year label, e.g. "2025-26" (shape AND range — see isValidFY). */
export const optionalQueryFY = () =>
  optionalQuery(z.string().refine(isValidFY, 'Expected a financial year like 2025-26'));

/**
 * Comma-joined multi-value filter (`?type=EXPENSE,INCOME`) validated item by item.
 * Empty items are dropped; nothing left means "no filter" (undefined).
 */
export const commaList = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const items = v.split(',').filter(Boolean);
      return items.length ? items : undefined;
    },
    z.array(item).optional(),
  );
