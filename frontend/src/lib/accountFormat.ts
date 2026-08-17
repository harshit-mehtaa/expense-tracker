/**
 * How a bank account or card is named in dropdowns and summaries.
 *
 * The labels and the formatter existed twice — once in Transactions.tsx and once in
 * Accounts.tsx — so the same account could read differently depending on the page. Both
 * now share this, and so does the subscription form, which needs to say which card a
 * subscription is billed to.
 *
 * Mirrors the `AccountType` enum in schema.prisma.
 */
export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  SAVINGS: 'Savings',
  CURRENT: 'Current',
  SALARY: 'Salary',
  CREDIT_CARD: 'Credit Card',
  DEBIT_CARD: 'Debit Card',
  PREPAID_CARD: 'Prepaid Card',
  NRE: 'NRE',
  NRO: 'NRO',
  PPF: 'PPF',
  EPF: 'EPF',
  DEMAT: 'Demat',
};

export function accountTypeLabel(type?: string | null): string {
  if (!type) return '';
  return ACCOUNT_TYPE_LABELS[type] ?? type;
}

export interface AccountLike {
  bankName?: string | null;
  accountNumberLast4?: string | null;
  accountType?: string | null;
  userName?: string | null;
}

/** e.g. `HDFC Bank ····4821 (Credit Card)`. */
export function formatAccountOption(
  account: AccountLike,
  options: { showOwner?: boolean; fallbackOwnerName?: string } = {},
): string {
  const suffix = account.accountNumberLast4 ? ` ····${account.accountNumberLast4}` : '';
  const type = accountTypeLabel(account.accountType);
  const ownerName = options.showOwner ? (account.userName || options.fallbackOwnerName) : undefined;
  const ownerPrefix = ownerName ? `${ownerName} - ` : '';
  return `${ownerPrefix}${account.bankName ?? ''}${suffix}${type ? ` (${type})` : ''}`;
}

/** The short form used inside a row, where the type is already obvious from context. */
export function formatAccountShort(account?: AccountLike | null): string {
  if (!account) return '';
  return `${account.bankName ?? ''}${account.accountNumberLast4 ? ` ····${account.accountNumberLast4}` : ''}`;
}
