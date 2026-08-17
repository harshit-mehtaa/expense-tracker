/**
 * The one list of payment modes, mirroring the `PaymentMode` enum in schema.prisma and
 * `backend/src/constants/paymentModes.ts`.
 *
 * The list and its labels were hand-copied into three places in Transactions.tsx alone,
 * so adding NETBANKING would have meant finding all of them and the copies would drift
 * the moment one was missed.
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

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_MODE_LABELS: Record<string, string> = {
  UPI: 'UPI',
  NETBANKING: 'Netbanking',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  IMPS: 'IMPS',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  EMI: 'EMI',
  AUTO_DEBIT: 'Auto Debit',
};

/** Falls back to the raw value so an enum member added to the database but not yet here
 *  renders as itself rather than as blank. */
export function paymentModeLabel(mode?: string | null): string {
  if (!mode) return '';
  return PAYMENT_MODE_LABELS[mode] ?? mode;
}
