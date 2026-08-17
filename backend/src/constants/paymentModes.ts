import { z } from 'zod';

/**
 * The one list of payment modes, mirroring the `PaymentMode` enum in schema.prisma.
 *
 * It was previously hand-copied into four route files. Adding NETBANKING meant editing
 * all four, and missing one would have produced a 422 on a value the database accepts —
 * the kind of drift that only shows up as a user failing to save a form. Prisma generates
 * a `PaymentMode` type but not a runtime array, so this is the runtime half.
 *
 * `frontend/src/lib/paymentModes.ts` mirrors it for the UI. A cross-checking test in
 * `paymentModes.test.ts` reads the Prisma schema and fails if the two drift.
 */
export const PAYMENT_MODES = [
  'UPI',
  'NETBANKING',
  'NEFT',
  'RTGS',
  'IMPS',
  'CASH',
  'CHEQUE',
  'CARD',
  'EMI',
  'AUTO_DEBIT',
] as const;

export type PaymentModeValue = (typeof PAYMENT_MODES)[number];

/**
 * Accepting free text let a bogus value reach Prisma's enum column, which throws a
 * PrismaClientValidationError rather than an AppError — a 500 where a 422 belongs.
 */
export const PAYMENT_MODE = z.enum(PAYMENT_MODES);
