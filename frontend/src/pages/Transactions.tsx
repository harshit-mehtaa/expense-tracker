import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useFY } from '@/contexts/FYContext';
import { useSearchParams } from 'react-router-dom';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { BankLogo } from '@/components/shared/BankLogo';
import { Receipt, Upload, X, CheckCircle, AlertCircle, Download, Pencil, Trash2, SlidersHorizontal, ChevronDown, Repeat, Paperclip, TrendingUp, Shield, Undo2, CreditCard, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { investmentsApi } from '@/api/investments';
import { insuranceApi, type InsurancePolicy } from '@/api/insurance';
import { loansApi } from '@/api/loans';
import { cn } from '@/lib/utils';
import { getCategoryLabel, getCategoryPath, sortCategoriesByNameAsc, type CategoryLike } from '@/lib/categoryUtils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useBudgetsVsActuals, type BudgetActualItem } from '@/hooks/useBudgetsVsActuals';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import RecurringRulesPage from '@/pages/transactions/RecurringRules';
import { formatINR } from '@/lib/indianFormat';
import { avatarInitial, buildMemberColorMap, resolveAvatarColor } from '@/lib/memberAvatar';

interface Transaction {
  id: string;
  description: string;
  remark?: string | null;
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  date: string;
  paymentMode?: string;
  categoryName?: string;
  categoryIcon?: string | null;
  categoryId?: string;
  bankAccountId?: string | null;
  bankAccountName?: string;
  userId: string;
  transferPairId?: string | null;
  sipId?: string | null;
  sipTransactionId?: string | null;
  sipName?: string;
  sipUnits?: number | null;
  sipNav?: number | null;
  sipAmount?: number | null;
  sipTxnType?: string | null;
  sipMonthlyAmount?: number | null;
  sipDate?: number | null;
  insurancePolicyId?: string | null;
  insurancePolicyName?: string;
  insuranceProviderName?: string;
  refundForTransactionId?: string | null;
  refundForDescription?: string;
  refundForAmount?: number | null;
  refundForDate?: string | null;
  refundedAmount?: number;
  refunds?: { id: string; amount: string | number; date: string; description: string }[];
  isCreditCardBillPayment?: boolean;
  creditCardAccountName?: string;
  transferCounterpartyAccountName?: string;
  memberName?: string;
  memberColor?: string | null;
}

interface RawTransaction extends Omit<Transaction, 'categoryName' | 'bankAccountName'> {
  category?: (CategoryLike & { color?: string | null }) | null;
  bankAccount?: { bankName: string; accountNumberLast4?: string | null; accountType?: string | null } | null;
  creditCardAccount?: { bankName: string; accountNumberLast4?: string | null; accountType?: string | null } | null;
  transferCounterpartyAccount?: { bankName: string; accountNumberLast4?: string | null; accountType?: string | null } | null;
  sip?: { fundName: string; folioNumber?: string | null; monthlyAmount?: string | number; sipDate?: number | null } | null;
  sipTransaction?: {
    units: string | number;
    nav: string | number;
    amount: string | number;
    type: string;
    investment?: { name: string } | null;
  } | null;
  insurancePolicy?: { id: string; policyName: string; providerName: string; policyNumber?: string; policyType?: string; premiumAmount?: string | number } | null;
  refundFor?: { id: string; description: string; amount: string | number; date: string; category?: CategoryLike | null } | null;
  refunds?: { id: string; amount: string | number; date: string; description: string }[];
  user?: { name: string; colorTag?: string | null } | null;
}

interface TransferCounterpartCandidate {
  id: string;
  date: string;
  description: string;
  remark?: string | null;
  amount: string | number;
  type: 'INCOME' | 'EXPENSE';
  balanceImpactApplied: boolean;
  bankAccount?: { bankName: string; accountNumberLast4?: string | null; accountType?: string | null } | null;
}

interface TransactionsResponse {
  data: Transaction[];
  pagination: { total: number; hasMore: boolean; nextCursor?: string };
}

interface TxFilters {
  search: string;
  types: string[];
  categoryIds: string[];
  paymentModes: string[];
  startDate: string;
  endDate: string;
}

const TRANSACTION_TYPES = [
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'TRANSFER', label: 'Transfer' },
] as const;

const PAYMENT_MODES = ['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT'] as const;

const PAYMENT_MODE_LABELS: Record<string, string> = {
  UPI: 'UPI', NEFT: 'NEFT', RTGS: 'RTGS', IMPS: 'IMPS',
  CASH: 'Cash', CHEQUE: 'Cheque', CARD: 'Card', EMI: 'EMI', AUTO_DEBIT: 'Auto Debit',
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
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

function formatAccountOption(
  account: any,
  options: { showOwner?: boolean; fallbackOwnerName?: string } = {},
): string {
  const suffix = account.accountNumberLast4 ? ` ····${account.accountNumberLast4}` : '';
  const type = ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType;
  const ownerName = options.showOwner ? (account.userName || options.fallbackOwnerName) : undefined;
  const ownerPrefix = ownerName ? `${ownerName} - ` : '';
  return `${ownerPrefix}${account.bankName}${suffix}${type ? ` (${type})` : ''}`;
}

function formatTransactionAccount(account?: { bankName: string; accountNumberLast4?: string | null } | null): string | undefined {
  if (!account) return undefined;
  return `${account.bankName}${account.accountNumberLast4 ? ` ****${account.accountNumberLast4}` : ''}`;
}

const BANK_CHIP_STYLES = [
  { match: /\bhdfc\b/i, bg: '#EAF3FF', fg: '#004C8F', border: '#9CC4EA' },
  { match: /\bicici\b/i, bg: '#FFF1E6', fg: '#9A3F10', border: '#FDBA74' },
  { match: /\b(state bank of india|sbi)\b/i, bg: '#E6F7FC', fg: '#006B95', border: '#7DD3FC' },
  { match: /\baxis\b/i, bg: '#FCE7F3', fg: '#97144D', border: '#F9A8D4' },
  { match: /\bkotak\b/i, bg: '#EAF1FF', fg: '#003974', border: '#93C5FD' },
  { match: /\byes\b/i, bg: '#EEF2FF', fg: '#1D4ED8', border: '#A5B4FC' },
  { match: /\bidfc\b/i, bg: '#FEE2E2', fg: '#9D1D27', border: '#FCA5A5' },
  { match: /\bindusind\b/i, bg: '#FFE4E6', fg: '#8A1538', border: '#FDA4AF' },
];

const FALLBACK_BANK_CHIP_STYLES = [
  { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE' },
  { bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0' },
  { bg: '#F5F3FF', fg: '#6D28D9', border: '#DDD6FE' },
  { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A' },
  { bg: '#F0FDFA', fg: '#0F766E', border: '#99F6E4' },
  { bg: '#FFF1F2', fg: '#BE123C', border: '#FECDD3' },
];

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBankChipStyle(accountName: string) {
  const known = BANK_CHIP_STYLES.find((style) => style.match.test(accountName));
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < accountName.length; i += 1) hash = (hash * 31 + accountName.charCodeAt(i)) >>> 0;
  return FALLBACK_BANK_CHIP_STYLES[hash % FALLBACK_BANK_CHIP_STYLES.length];
}

function parseAccountChipText(accountName: string) {
  const last4Match = accountName.match(/(?:\*{2,}|•{2,}|\.{2,}|····)\s*(\d{4})\b/);
  const last4 = last4Match?.[1] ?? null;
  const bankName = accountName
    .replace(/(?:\*{2,}|•{2,}|\.{2,}|····)\s*\d{4}\b/g, '')
    .trim();
  return {
    bankName: bankName || accountName,
    // Bare last-4: the adjacent BankLogo already identifies the bank, and the masking
    // bullets cost more column width than they convey. The full account name stays
    // available via the chip's title attribute.
    visibleText: last4 ?? 'Account',
  };
}

const EMPTY_FILTERS: TxFilters = {
  search: '', types: [], categoryIds: [], paymentModes: [], startDate: '', endDate: '',
};

async function fetchTransactions(fy: string, filters: TxFilters, cursor?: string, targetUserId?: string): Promise<TransactionsResponse> {
  const res = await api.get<{ data: RawTransaction[]; pagination: TransactionsResponse['pagination'] }>('/transactions', {
    params: {
      fy,
      limit: 50,
      cursor: cursor || undefined,
      search: filters.search || undefined,
      type: filters.types.length ? filters.types.join(',') : undefined,
      categoryId: filters.categoryIds.length ? filters.categoryIds.join(',') : undefined,
      paymentMode: filters.paymentModes.length ? filters.paymentModes.join(',') : undefined,
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      targetUserId: targetUserId || undefined,
    },
  });
  const data: Transaction[] = (res.data.data ?? []).map((tx) => ({
    ...tx,
    categoryId: tx.categoryId ?? tx.category?.id,
    categoryName: tx.category ? getCategoryPath(tx.category) : undefined,
    categoryIcon: tx.category?.icon,
    bankAccountName: formatTransactionAccount(tx.bankAccount),
    sipName: tx.sip?.fundName ?? tx.sipTransaction?.investment?.name ?? (tx.sipTransaction ? 'SIP allocation' : undefined),
    sipUnits: finiteNumber(tx.sipTransaction?.units),
    sipNav: finiteNumber(tx.sipTransaction?.nav),
    sipAmount: finiteNumber(tx.sipTransaction?.amount),
    sipTxnType: tx.sipTransaction?.type ?? null,
    sipMonthlyAmount: finiteNumber(tx.sip?.monthlyAmount),
    sipDate: tx.sip?.sipDate ?? null,
    insurancePolicyName: tx.insurancePolicy?.policyName,
    insuranceProviderName: tx.insurancePolicy?.providerName,
    refundForTransactionId: tx.refundForTransactionId ?? tx.refundFor?.id,
    refundForDescription: tx.refundFor?.description,
    refundForAmount: tx.refundFor ? Number(tx.refundFor.amount) : null,
    refundForDate: tx.refundFor?.date ?? null,
    refundedAmount: tx.refunds?.reduce((sum, refund) => sum + Number(refund.amount), 0) ?? 0,
    creditCardAccountName: formatTransactionAccount(tx.creditCardAccount),
    transferCounterpartyAccountName: formatTransactionAccount(tx.transferCounterpartyAccount),
    memberName: tx.user?.name,
    memberColor: tx.user?.colorTag,
  }));
  return { data, pagination: res.data.pagination };
}

const PAYMENT_MODE_COLORS: Record<string, string> = {
  UPI: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  NEFT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  RTGS: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  IMPS: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  CASH: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  CHEQUE: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  CARD: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  EMI: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  AUTO_DEBIT: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
};

const PAYMENT_MODE_ICONS: Record<string, string> = {
  UPI: '📱',
  NEFT: '🏦',
  RTGS: '🏛️',
  IMPS: '⚡',
  CASH: '💵',
  CHEQUE: '📝',
  CARD: '💳',
  EMI: '📅',
  AUTO_DEBIT: '🔄',
};

/**
 * `compact` renders the avatar alone — used in the desktop table where the column header
 * already supplies the context. The name stays available on hover and to screen readers.
 * The mobile card view uses the full pill, since its badges have no column header.
 */
function MemberBadge({ name, color, fallbackColor, compact = false }: { name?: string; color?: string | null; fallbackColor?: string; compact?: boolean }) {
  const trimmed = name?.trim();
  if (!trimmed) return <span className="text-xs text-muted-foreground">—</span>;
  const initial = avatarInitial(trimmed);
  const background = resolveAvatarColor(color, fallbackColor);

  if (compact) {
    // role="img" + aria-label gives one accessible name. Using sr-only text alongside a
    // title would make some screen readers announce the member twice.
    return (
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ backgroundColor: background }}
        role="img"
        aria-label={trimmed}
        title={trimmed}
      >
        {initial}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
      <span
        className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ backgroundColor: background }}
        aria-hidden="true"
      >
        {initial}
      </span>
      <span className="max-w-[110px] truncate">{trimmed}</span>
    </span>
  );
}

function BankAccountBadge({ accountName, compact = false }: { accountName?: string; compact?: boolean }) {
  if (!accountName) return <span className="text-xs text-muted-foreground">—</span>;
  const { bankName, visibleText } = parseAccountChipText(accountName);
  const style = getBankChipStyle(bankName);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold shadow-sm tabular-nums',
        compact ? 'basis-full' : '',
      )}
      style={{ backgroundColor: style.bg, borderColor: style.border, color: style.fg }}
      title={accountName}
    >
      <BankLogo bankName={bankName} size="sm" className="h-4 w-4 rounded text-[7px] shadow-none ring-0" />
      <span className="truncate">{visibleText}</span>
    </span>
  );
}

function BankAccountLine({ label, accountName }: { label: string; accountName?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
      <span className="shrink-0">{label}:</span>
      <BankAccountBadge accountName={accountName} />
    </div>
  );
}

function TransferCategoryInfo({ tx, compact = false }: { tx: Transaction; compact?: boolean }) {
  const isDebitLeg = tx.type === 'EXPENSE';
  const primaryLabel = isDebitLeg ? 'From' : 'To';
  const primaryAccount = tx.bankAccountName;
  const counterpartyLabel = isDebitLeg ? 'To' : 'From';
  const counterpartyAccount = isDebitLeg
    ? (tx.isCreditCardBillPayment ? tx.creditCardAccountName : tx.transferCounterpartyAccountName)
    : tx.transferCounterpartyAccountName;
  const Icon = tx.isCreditCardBillPayment ? CreditCard : Repeat;
  const label = `${tx.isCreditCardBillPayment ? 'CC Bill Payment' : 'Transfer'} ${isDebitLeg ? 'Debit' : 'Credit'}`;

  return (
    <div className={cn('space-y-1 min-w-0', compact ? 'basis-full max-w-full' : 'max-w-[280px]')}>
      <span
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
          tx.isCreditCardBillPayment
            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
        )}
      >
        <Icon className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      {(primaryAccount || counterpartyAccount) && (
        <BankAccountLine label={primaryLabel} accountName={primaryAccount} />
      )}
      {(primaryAccount || counterpartyAccount) && (
        <BankAccountLine label={counterpartyLabel} accountName={counterpartyAccount} />
      )}
    </div>
  );
}

function formatSipQuantity(value?: number | null): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toLocaleString('en-IN', { maximumFractionDigits: 4 });
}

function SIPCategoryInfo({ tx, compact = false }: { tx: Transaction; compact?: boolean }) {
  const units = formatSipQuantity(tx.sipUnits);
  const nav = tx.sipNav !== null && tx.sipNav !== undefined && Number.isFinite(tx.sipNav)
    ? formatINR(tx.sipNav)
    : null;
  const allocation = units && nav
    ? `${units} units @ ${nav}`
    : units
    ? `${units} units`
    : nav
    ? `NAV ${nav}`
    : tx.sipAmount !== null && tx.sipAmount !== undefined && Number.isFinite(tx.sipAmount)
    ? `Allocated ${formatINR(tx.sipAmount)}`
    : null;
  const mandateParts = [
    tx.sipMonthlyAmount !== null && tx.sipMonthlyAmount !== undefined && Number.isFinite(tx.sipMonthlyAmount)
      ? `Monthly ${formatINR(tx.sipMonthlyAmount)}`
      : null,
    tx.sipDate ? `Day ${tx.sipDate}` : null,
  ].filter(Boolean);
  const mandate = mandateParts.length > 0 ? mandateParts.join(' · ') : null;

  return (
    <div className={cn('space-y-1 min-w-0', compact ? 'basis-full max-w-full' : 'max-w-[280px]')}>
      <span
        className="inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
        title={tx.sipName ? `SIP: ${tx.sipName}` : 'SIP'}
      >
        <TrendingUp className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">SIP{tx.sipName ? ` · ${tx.sipName}` : ''}</span>
      </span>
      {allocation && (
        <div className="text-[11px] text-muted-foreground truncate">
          Allocation: {allocation}
        </div>
      )}
      {mandate && (
        <div className="text-[11px] text-muted-foreground truncate">
          Mandate: {mandate}
        </div>
      )}
      {tx.categoryName && (
        <div className="text-[11px] text-muted-foreground truncate">
          {tx.categoryIcon && <span className="mr-1">{tx.categoryIcon}</span>}
          {tx.categoryName}
        </div>
      )}
    </div>
  );
}

interface TransactionActionMenuProps {
  tx: Transaction;
  compact?: boolean;
  canControl: boolean;
  canConvertToTransfer: boolean;
  canConvertToSIP: boolean;
  canManageSIPLink: boolean;
  canManagePolicyLink: boolean;
  canManageRefundLink: boolean;
  onDocuments: () => void;
  onTransfer: () => void;
  onSIP: () => void;
  onPolicy: () => void;
  onRefund: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TransactionActionMenu({
  tx,
  compact = false,
  canControl,
  canConvertToTransfer,
  canConvertToSIP,
  canManageSIPLink,
  canManagePolicyLink,
  canManageRefundLink,
  onDocuments,
  onTransfer,
  onSIP,
  onPolicy,
  onRefund,
  onEdit,
  onDelete,
}: TransactionActionMenuProps) {
  if (!canControl) return null;

  const canEditTransaction = !tx.transferPairId && !tx.sipId && !tx.sipTransactionId;
  const canDeleteTransaction = !tx.transferPairId;
  const itemClass = 'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus:bg-muted';
  const destructiveItemClass = cn(itemClass, 'text-destructive hover:bg-destructive/10 focus:bg-destructive/10');
  const actions = [
    {
      key: 'documents',
      label: 'Documents',
      icon: <Paperclip className="h-4 w-4" />,
      onSelect: onDocuments,
    },
    canConvertToTransfer && {
      key: 'transfer',
      label: tx.type === 'INCOME' ? 'Mark as card payment' : 'Mark as transfer',
      icon: <Repeat className="h-4 w-4" />,
      onSelect: onTransfer,
    },
    canConvertToSIP && {
      key: 'sip',
      label: 'Mark as SIP',
      icon: <TrendingUp className="h-4 w-4" />,
      onSelect: onSIP,
    },
    canManageSIPLink && {
      key: 'sip-link',
      label: 'Change SIP link',
      icon: <TrendingUp className="h-4 w-4" />,
      onSelect: onSIP,
    },
    canManagePolicyLink && {
      key: 'policy',
      label: tx.insurancePolicyId ? 'Change policy link' : 'Link policy',
      icon: <Shield className="h-4 w-4" />,
      onSelect: onPolicy,
    },
    canManageRefundLink && {
      key: 'refund',
      label: tx.type === 'EXPENSE' ? 'Link refund credit' : tx.refundForTransactionId ? 'Change refund link' : 'Mark as refund',
      icon: <Undo2 className="h-4 w-4" />,
      onSelect: onRefund,
    },
    canEditTransaction && {
      key: 'edit',
      label: 'Edit transaction',
      icon: <Pencil className="h-4 w-4" />,
      onSelect: onEdit,
    },
  ].filter(Boolean) as Array<{ key: string; label: string; icon: JSX.Element; onSelect: () => void }>;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant={compact ? 'outline' : 'ghost'}
          size={compact ? 'sm' : 'icon'}
          className={cn(compact ? 'h-8 gap-1.5 px-2 text-xs' : 'h-7 w-7')}
          title="Transaction actions"
        >
          <MoreHorizontal className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          {compact && <span>Actions</span>}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          {actions.map((action) => (
            <DropdownMenu.Item key={action.key} className={itemClass} onSelect={action.onSelect}>
              {action.icon}
              <span>{action.label}</span>
            </DropdownMenu.Item>
          ))}
          {canDeleteTransaction && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item className={destructiveItemClass} onSelect={onDelete}>
                <Trash2 className="h-4 w-4" />
                <span>Delete transaction</span>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const txSchema = z.object({
  description: z.string().min(1, 'Required'),
  remark: z.string().optional(),
  amount: z.coerce.number().positive(),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  date: z.string(),
  paymentMode: z.string().optional(),
  categoryId: z.string().optional(),
  bankAccountId: z.string().optional(),
  transferToAccountId: z.string().optional(),
  loanId: z.string().optional(),
  tags: z.string().optional(),
});

type TxForm = z.infer<typeof txSchema>;

// Edit schema: TRANSFER type not allowed, bankAccountId excluded, paymentMode empty→undefined
const editTxSchema = z.object({
  description: z.string().min(1, 'Required'),
  remark: z.string().optional(),
  amount: z.coerce.number().positive('Must be positive'),
  type: z.enum(['INCOME', 'EXPENSE']),
  date: z.string(),
  paymentMode: z.string().transform((v) => v || undefined).optional(),
  categoryId: z.string().optional(),
});

type EditTxForm = z.infer<typeof editTxSchema>;

function useCategories() {
  return useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api.get<{ data: any[] }>('/categories').then((r) => r.data.data),
  });
}

function useAccounts(targetUserId?: string) {
  return useQuery({
    queryKey: ['accounts', targetUserId],
    queryFn: () => api.get<{ data: any[] }>('/accounts', {
      params: targetUserId ? { userId: targetUserId } : {},
    }).then((r) => r.data.data),
  });
}

function useLoans(targetUserId?: string) {
  return useQuery({
    queryKey: ['loans', targetUserId],
    queryFn: () => loansApi.getAll(targetUserId),
  });
}

function useSIPs(targetUserId?: string) {
  return useQuery({
    queryKey: ['sips', targetUserId],
    queryFn: () => investmentsApi.getSIPs(targetUserId ? { targetUserId } : undefined),
  });
}

function useInsurancePolicies(targetUserId?: string) {
  return useQuery({
    queryKey: ['insurance-policies', targetUserId],
    queryFn: () => insuranceApi.getAll(targetUserId ? { targetUserId } : undefined),
  });
}

function mapRawTransaction(tx: RawTransaction): Transaction {
  return {
    ...tx,
    categoryName: tx.category ? getCategoryPath(tx.category) : undefined,
    categoryIcon: tx.category?.icon,
    bankAccountName: formatTransactionAccount(tx.bankAccount),
    sipName: tx.sip?.fundName ?? tx.sipTransaction?.investment?.name ?? (tx.sipTransaction ? 'SIP allocation' : undefined),
    sipUnits: finiteNumber(tx.sipTransaction?.units),
    sipNav: finiteNumber(tx.sipTransaction?.nav),
    sipAmount: finiteNumber(tx.sipTransaction?.amount),
    sipTxnType: tx.sipTransaction?.type ?? null,
    sipMonthlyAmount: finiteNumber(tx.sip?.monthlyAmount),
    sipDate: tx.sip?.sipDate ?? null,
    refundForTransactionId: tx.refundForTransactionId ?? tx.refundFor?.id,
    refundForDescription: tx.refundFor?.description,
    refundForAmount: tx.refundFor ? Number(tx.refundFor.amount) : null,
    refundForDate: tx.refundFor?.date ?? null,
    refundedAmount: tx.refunds?.reduce((sum, refund) => sum + Number(refund.amount), 0) ?? 0,
    creditCardAccountName: formatTransactionAccount(tx.creditCardAccount),
    transferCounterpartyAccountName: formatTransactionAccount(tx.transferCounterpartyAccount),
    memberName: tx.user?.name,
    memberColor: tx.user?.colorTag,
  };
}

function useRefundCandidates(targetUserId?: string, enabled = true) {
  return useQuery({
    queryKey: ['refund-candidates', targetUserId],
    queryFn: async () => {
      const res = await api.get<{ data: RawTransaction[] }>('/transactions', {
        params: {
          type: 'EXPENSE',
          limit: 500,
          sort: 'date:desc',
          ...(targetUserId ? { targetUserId } : {}),
        },
      });
      return (res.data.data ?? []).map(mapRawTransaction);
    },
    enabled,
  });
}

function useIncomingRefundCandidates(targetUserId?: string, enabled = true) {
  return useQuery({
    queryKey: ['incoming-refund-candidates', targetUserId],
    queryFn: async () => {
      const res = await api.get<{ data: RawTransaction[] }>('/transactions', {
        params: {
          type: 'INCOME',
          limit: 500,
          sort: 'date:desc',
          ...(targetUserId ? { targetUserId } : {}),
        },
      });
      return (res.data.data ?? [])
        .map(mapRawTransaction)
        .filter((candidate) => (
          !candidate.transferPairId
          && !candidate.sipId
          && !candidate.sipTransactionId
          && !candidate.insurancePolicyId
          && !candidate.refundForTransactionId
        ));
    },
    enabled,
  });
}

function EditTransactionModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: categories = [] } = useCategories();

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<EditTxForm>({
    resolver: zodResolver(editTxSchema),
    defaultValues: {
      description: tx.description,
      remark: tx.remark ?? '',
      amount: tx.amount,
      type: tx.type === 'TRANSFER' ? 'EXPENSE' : tx.type,
      date: tx.date.slice(0, 10),
      paymentMode: tx.paymentMode ?? '',
      categoryId: tx.categoryId ?? '',
    },
  });

  const selectedType = watch('type');
  const selectedCategoryId = watch('categoryId') ?? '';
  const previousType = useRef(selectedType);

  // Reset categoryId only when the user actually changes type. React StrictMode
  // runs effects twice in dev, so a first-render flag can still clear this value.
  useEffect(() => {
    if (previousType.current === selectedType) return;
    previousType.current = selectedType;
    setValue('categoryId', '');
  }, [selectedType, setValue]);

  const transactionCategories = categories.filter((c: any) => {
    if (selectedType === 'INCOME') return c.type === 'INCOME';
    if (selectedType === 'EXPENSE') return c.type === 'EXPENSE';
    return false; // TRANSFER — no categories
  });
  const showCurrentCategoryFallback =
    !!selectedCategoryId
    && selectedCategoryId === tx.categoryId
    && !transactionCategories.some((c: any) => c.id === selectedCategoryId);

  const editMutation = useMutation({
    mutationFn: (data: EditTxForm) =>
      api.put(`/transactions/${tx.id}`, {
        ...data,
        remark: data.remark?.trim() || null,
        paymentMode: data.paymentMode || undefined,
        categoryId: data.categoryId || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      toast({ title: 'Transaction updated', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Update failed',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Edit Transaction</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <form onSubmit={handleSubmit((data) => editMutation.mutate(data))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
              <Label required>Description</Label>
              <Input {...register('description')} />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Remark (optional)</Label>
              <Input {...register('remark')} placeholder="Bank transaction remark or note" />
            </div>
            <div className="space-y-1">
              <Label required>Amount (₹)</Label>
              <Input {...register('amount')} type="number" step="0.01" />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
            <div className="space-y-1">
              <Label required>Type</Label>
              <select {...register('type')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Income</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label required>Date</Label>
              <Input {...register('date')} type="date" />
            </div>
            <div className="space-y-1">
              <Label>Payment Mode (optional)</Label>
              <select {...register('paymentMode')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Select —</option>
                {['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Category (optional)</Label>
              <select {...register('categoryId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Uncategorized —</option>
                {showCurrentCategoryFallback && (
                  <option value={selectedCategoryId}>
                    {tx.categoryIcon ? `${tx.categoryIcon} ` : ''}{tx.categoryName ?? 'Selected category'}
                  </option>
                )}
                {sortCategoriesByNameAsc(transactionCategories).map((c: any) => (
                  <option key={c.id} value={c.id}>{getCategoryLabel(c, categories)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={editMutation.isPending}>
              {editMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CategoryRule {
  id: string;
  keyword: string;
  categoryId: string;
  category: CategoryLike & { type: 'INCOME' | 'EXPENSE'; icon?: string | null };
}

function useCategoryRules(targetUserId?: string) {
  return useQuery({
    queryKey: ['category-rules', targetUserId],
    queryFn: () => api.get<{ data: CategoryRule[] }>('/category-rules', {
      params: targetUserId ? { targetUserId } : {},
    }).then((r) => r.data.data),
  });
}

// ─── Import auto-detect helpers ───────────────────────────────────────────────

const AUTO_DETECT = '__auto__';

interface AutoDetectResult { account: any | null; ambiguous: boolean }

const BANK_FILENAME_KEYWORDS: Record<string, string> = {
  hdfc: 'HDFC', sbi: 'SBI', icici: 'ICICI', axis: 'AXIS', kotak: 'KOTAK',
};

// Account bankName search patterns per bank key.
// Handles full official names (e.g. "State Bank of India" doesn't contain "sbi").
const BANK_ACCOUNT_PATTERNS: Record<string, string[]> = {
  HDFC: ['hdfc'],
  SBI: ['sbi', 'state bank'],
  ICICI: ['icici'],
  AXIS: ['axis'],
  KOTAK: ['kotak'],
};

function detectBankFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const [kw, bank] of Object.entries(BANK_FILENAME_KEYWORDS)) {
    if (lower.includes(kw)) return bank;
  }
  return null;
}

function resolveAccountForBank(bankKey: string | null, accounts: any[]): AutoDetectResult {
  if (!bankKey || accounts.length === 0) return { account: null, ambiguous: false };
  const patterns = BANK_ACCOUNT_PATTERNS[bankKey.toUpperCase()] ?? [bankKey.toLowerCase()];
  const matches = accounts.filter((a: any) => {
    const name = a.bankName?.toLowerCase() ?? '';
    return patterns.some((p) => name.includes(p));
  });
  if (matches.length === 0) return { account: null, ambiguous: false };
  if (matches.length === 1) return { account: matches[0], ambiguous: false };
  return { account: null, ambiguous: true };
}

// Reverse-maps an account's bankName to the canonical bank hint key used by the backend parser.
// Uses the same BANK_ACCOUNT_PATTERNS as resolveAccountForBank so matching is symmetric.
// Returns null for unrecognized bank names (backend will auto-detect from file content).
function deriveBankHintFromBankName(bankName: string | null | undefined): string | null {
  if (!bankName) return null;
  const lower = bankName.toLowerCase();
  for (const [key, patterns] of Object.entries(BANK_ACCOUNT_PATTERNS)) {
    if (patterns.some((p) => lower.includes(p))) return key;
  }
  return null;
}

function ImportModal({ onClose, targetUserId }: { onClose: () => void; targetUserId?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: accounts = [] } = useAccounts(targetUserId);
  const { data: categories = [] } = useCategories();
  const { data: rules = [] } = useCategoryRules(targetUserId);
  // Bank imports produce INCOME/EXPENSE transactions — filter out ASSET/LIABILITY categories
  const importCategories = categories.filter((c: any) => c.type === 'INCOME' || c.type === 'EXPENSE');
  const [file, setFile] = useState<File | null>(null);
  const [bankAccountId, setBankAccountId] = useState(AUTO_DETECT);
  const [autoDetectResult, setAutoDetectResult] = useState<AutoDetectResult>({ account: null, ambiguous: false });
  const [manualBankHint, setManualBankHint] = useState('');
  const [pdfPassword, setPdfPassword] = useState('');
  const [result, setResult] = useState<any>(null);
  const [showRules, setShowRules] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newBalance, setNewBalance] = useState('');
  const [savingBalance, setSavingBalance] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isPDF = file?.name.toLowerCase().endsWith('.pdf') ?? false;

  // Derived: resolves AUTO_DETECT sentinel to a real account ID (or '') before any API call.
  // Computed at render time so the closure in mutationFn always captures the correct value.
  const resolvedAccountId = bankAccountId === AUTO_DETECT
    ? (autoDetectResult.ambiguous ? '' : autoDetectResult.account?.id ?? '')
    : bankAccountId;

  // Pure filename-based bank detection — stabilised with useMemo so it's safe in effect deps.
  const filenameBankHint = useMemo(
    () => (file ? detectBankFromFilename(file.name) : null),
    [file],
  );

  // Bank hint sent to backend parser. Priority:
  //   1. Specific account selected → derive from account's bankName
  //   2. Filename detection hit → use filenameBankHint
  //   3. "Don't link" + no filename match → manualBankHint (user-selected fallback)
  //   4. AUTO_DETECT → null (backend auto-detects from file content)
  let resolvedBankHint: string | null = null;
  if (bankAccountId !== AUTO_DETECT && bankAccountId !== '') {
    const acc = accounts.find((a: any) => a.id === bankAccountId);
    resolvedBankHint = deriveBankHintFromBankName(acc?.bankName);
  } else if (filenameBankHint) {
    resolvedBankHint = filenameBankHint;
  } else if (bankAccountId === '') {
    resolvedBankHint = manualBankHint || null;
  }

  // Re-run auto-detection when account mode, accounts list, or filename bank hint changes.
  // file changes are handled eagerly by handleFileSelected — file itself is intentionally omitted.
  useEffect(() => {
    if (bankAccountId === AUTO_DETECT && file) {
      setAutoDetectResult(resolveAccountForBank(filenameBankHint, accounts));
    }
  }, [bankAccountId, accounts, filenameBankHint]); // eslint-disable-line react-hooks/exhaustive-deps -- file intentionally omitted (handled eagerly in handleFileSelected)

  // Shared handler for file selection (click + drag-drop).
  function handleFileSelected(f: File | null | undefined) {
    const selected = f ?? null;
    setFile(selected);
    setPdfPassword('');
    if (selected && bankAccountId === AUTO_DETECT) {
      const hint = detectBankFromFilename(selected.name);
      setAutoDetectResult(resolveAccountForBank(hint, accounts));
    }
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const formData = new FormData();
      formData.append('file', file);
      // resolvedAccountId is derived at render time — never sends the '__auto__' sentinel to the API
      if (resolvedAccountId) formData.append('bankAccountId', resolvedAccountId);
      if (resolvedBankHint) formData.append('bank', resolvedBankHint);
      if (isPDF && pdfPassword) formData.append('pdfPassword', pdfPassword);
      return api.post<{ data: any }>('/transactions/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        params: targetUserId ? { targetUserId } : {},
      });
    },
    onSuccess: (res) => {
      setResult(res.data.data);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const addRuleMutation = useMutation({
    mutationFn: (data: { keyword: string; categoryId: string }) => api.post('/category-rules', data, {
      params: targetUserId ? { targetUserId } : {},
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-rules'] });
      setNewKeyword('');
      setNewCategoryId('');
    },
  });

  const removeRuleMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/category-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-rules'] }),
  });

  function addRule() {
    if (!newKeyword.trim() || !newCategoryId) return;
    addRuleMutation.mutate({ keyword: newKeyword.trim().toLowerCase(), categoryId: newCategoryId });
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Import Bank Statement</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {!result ? (
          <>
            <div className="space-y-1">
              <Label>Link to Account (optional)</Label>
              <select
                value={bankAccountId}
                onChange={(e) => {
                  const val = e.target.value;
                  setBankAccountId(val);
                  // Clear auto-detect result when user manually picks an account or "Don't link"
                  if (val !== AUTO_DETECT) setAutoDetectResult({ account: null, ambiguous: false });
                  // Clear manual bank hint when switching away from "Don't link"
                  if (val !== '') setManualBankHint('');
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value={AUTO_DETECT}>Auto-detect (match by bank name)</option>
                <option value="">— Don't link to account —</option>
                {accounts.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.bankName} ····{a.accountNumberLast4 ?? ''}</option>
                ))}
              </select>
              {/* Auto-detect preview — shown only when a file is selected and auto-detect is active */}
              {bankAccountId === AUTO_DETECT && file && (
                <p className="text-xs mt-1">
                  {autoDetectResult.ambiguous
                    ? <span className="text-amber-600">Multiple {filenameBankHint} accounts found — please select one manually</span>
                    : autoDetectResult.account
                      ? <span className="text-muted-foreground">→ will link to {autoDetectResult.account.bankName} ····{autoDetectResult.account.accountNumberLast4 ?? ''}</span>
                      : filenameBankHint
                        ? <span className="text-muted-foreground">No {filenameBankHint} account found — will import unlinked</span>
                        : <span className="text-muted-foreground">Could not detect bank from filename — will import unlinked</span>
                  }
                </p>
              )}
              {/* Bank format fallback — shown only when "Don't link" is selected and filename detection fails */}
              {bankAccountId === '' && !filenameBankHint && (
                <div className="space-y-1 mt-2">
                  <Label className="text-xs text-muted-foreground">Bank format (optional)</Label>
                  <select
                    value={manualBankHint}
                    onChange={(e) => setManualBankHint(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Auto-detect from file</option>
                    <option value="HDFC">HDFC Bank</option>
                    <option value="SBI">SBI</option>
                    <option value="ICICI">ICICI Bank</option>
                    <option value="AXIS">Axis Bank</option>
                    <option value="KOTAK">Kotak Bank</option>
                  </select>
                </div>
              )}
            </div>
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/50 transition-colors',
                file && 'border-green-500 bg-green-50 dark:bg-green-950',
                isDragging && !file && 'border-primary bg-primary/5',
              )}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => {
                // Only clear the drag state when leaving the drop zone itself, not a child element
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setIsDragging(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFileSelected(e.dataTransfer.files[0]);
              }}
            >
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              {file ? (
                <p className="text-sm font-medium text-green-600">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">Drop CSV or PDF here, or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports HDFC, SBI, ICICI, Axis, Kotak exports (CSV or PDF)</p>
                  <p className="text-xs text-muted-foreground">PDF must be a digital statement — scanned images are not supported</p>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.pdf"
                className="hidden"
                onChange={(e) => handleFileSelected(e.target.files?.[0])}
              />
            </div>
            {isPDF && (
              <div className="space-y-1">
                <Label>PDF Password (if protected)</Label>
                <Input
                  type="password"
                  placeholder="Leave blank if not password-protected"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}
            {importMutation.error && (
              <p className="text-sm text-destructive">{(importMutation.error as any)?.response?.data?.message ?? 'Import failed'}</p>
            )}
            {/* Categorization rules */}
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium bg-muted/50 hover:bg-muted/80 transition-colors"
                onClick={() => setShowRules((v) => !v)}
              >
                <span>Auto-categorization rules {rules.length > 0 && `(${rules.length})`}</span>
                <span className="text-muted-foreground">{showRules ? '▲' : '▼'}</span>
              </button>
              {showRules && (
                <div className="p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Keyword → category mappings are saved to your account and applied during import</p>
                  {importCategories.length === 0 && (
                    <p className="text-xs text-amber-600">
                      Create at least one income or expense category before adding auto-categorization rules.
                    </p>
                  )}
                  {importCategories.length > 0 && rules.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No rules saved yet. Add a keyword rule before importing if you want transactions categorized automatically.
                    </p>
                  )}
                  {rules.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm bg-muted/30 rounded px-2 py-1">
                      <span><span className="font-mono text-xs">{r.keyword}</span> → {getCategoryLabel(r.category, categories)}</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeRuleMutation.mutate(r.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input
                      placeholder="keyword (e.g. swiggy)"
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      className="text-sm h-8"
                      disabled={importCategories.length === 0}
                      onKeyDown={(e) => e.key === 'Enter' && addRule()}
                    />
                    <select
                      value={newCategoryId}
                      onChange={(e) => setNewCategoryId(e.target.value)}
                      className="rounded-md border bg-background px-2 py-1 text-sm flex-1"
                      disabled={importCategories.length === 0}
                    >
                      <option value="">{importCategories.length === 0 ? 'No categories available' : 'Category'}</option>
                      {sortCategoriesByNameAsc(importCategories).map((c: any) => (
                        <option key={c.id} value={c.id}>{getCategoryLabel(c, categories)}</option>
                      ))}
                    </select>
                    <Button size="sm" onClick={addRule} disabled={addRuleMutation.isPending || importCategories.length === 0} className="h-8">Add</Button>
                  </div>
                  {addRuleMutation.isError && (
                    <p className="text-xs text-destructive">{(addRuleMutation.error as any)?.response?.data?.message ?? 'Could not save rule'}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => importMutation.mutate()} disabled={!file || importMutation.isPending}>
                {importMutation.isPending
                  ? (isPDF ? 'Parsing PDF…' : 'Importing…')
                  : 'Import'}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 dark:bg-green-950 p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                <CheckCircle className="h-5 w-5" />
                <span className="font-semibold">Import Complete</span>
              </div>
              <div className="text-sm space-y-1">
                <p>Bank detected: <span className="font-medium">{result.bank}</span></p>
                <p>Rows parsed: <span className="font-medium">{result.total}</span></p>
                <p>Imported: <span className="font-medium text-green-600">{result.imported}</span></p>
                <p>Duplicates skipped: <span className="font-medium text-muted-foreground">{result.duplicatesSkipped}</span></p>
                <p>Categorized by rules: <span className="font-medium">{result.categorized ?? 0}</span></p>
                {(result.categorized ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">No saved category rules matched this import.</p>
                )}
                {result.errors?.length > 0 && <p className="text-orange-600">Errors: {result.errors.length}</p>}
              </div>
              {result.warnings?.length > 0 && (
                <div className="flex items-start gap-2 text-orange-600 text-xs mt-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{result.warnings.join(' ')}</span>
                </div>
              )}
            </div>
            {/* Balance update — only shown when an account was actually linked (resolvedAccountId is a real ID) */}
            {resolvedAccountId && (
              <div className="space-y-1">
                <Label>Update account balance (optional)</Label>
                <p className="text-xs text-muted-foreground">Enter the current balance shown in your bank app to keep it in sync.</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 45230.50"
                    value={newBalance}
                    onChange={(e) => setNewBalance(e.target.value)}
                  />
                  {newBalance && (
                    <Button
                      variant="outline"
                      disabled={savingBalance}
                      onClick={async () => {
                        setSavingBalance(true);
                        try {
                          await api.put(`/accounts/${resolvedAccountId}`, { currentBalance: Number(newBalance) });
                          qc.invalidateQueries({ queryKey: ['accounts'] });
                          toast({ title: 'Account balance updated', variant: 'success' });
                          setNewBalance('');
                        } catch {
                          toast({ title: 'Failed to update balance', variant: 'error' });
                        } finally {
                          setSavingBalance(false);
                        }
                      }}
                    >
                      {savingBalance ? 'Saving…' : 'Save'}
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <Button className="w-full" onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteConfirmModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/transactions/${tx.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      toast({ title: 'Transaction deleted', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Delete failed',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold">Delete Transaction</h2>
        <p className="text-sm text-muted-foreground">
          Delete <span className="font-medium text-foreground">"{tx.description}"</span>? This cannot be undone.
        </p>
        {deleteMutation.error && (
          <p className="text-sm text-destructive">
            {(deleteMutation.error as any)?.response?.data?.message ?? 'Delete failed'}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConvertToTransferModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const targetUserId = user?.role === 'ADMIN' ? tx.userId : undefined;
  const { data: accounts = [] } = useAccounts(targetUserId);
  const isIncomingPayment = tx.type === 'INCOME';
  const [counterpartyAccountId, setCounterpartyAccountId] = useState('');
  const [counterpartTransactionId, setCounterpartTransactionId] = useState('');
  const [adjustCounterpartyBalance, setAdjustCounterpartyBalance] = useState(false);

  const destinationAccounts = accounts.filter((a: any) => a.id !== tx.bankAccountId);
  const { data: counterpartCandidates = [], isFetching: isLoadingCounterpartCandidates } = useQuery({
    queryKey: ['transfer-counterpart-candidates', tx.id, counterpartyAccountId],
    queryFn: () => api
      .get<{ data: TransferCounterpartCandidate[] }>(`/transactions/${tx.id}/transfer-counterpart-candidates`, {
        params: { bankAccountId: counterpartyAccountId },
      })
      .then((r) => r.data.data),
    enabled: !!counterpartyAccountId,
  });
  const requiresCounterpartChoice = counterpartCandidates.length > 1;

  useEffect(() => {
    setCounterpartTransactionId('');
  }, [counterpartyAccountId]);

  const convertMutation = useMutation({
    mutationFn: () => {
      const payload = isIncomingPayment
        ? { transferFromAccountId: counterpartyAccountId, counterpartTransactionId: counterpartTransactionId || undefined, adjustSourceBalance: adjustCounterpartyBalance }
        : { transferToAccountId: counterpartyAccountId, counterpartTransactionId: counterpartTransactionId || undefined, adjustDestinationBalance: adjustCounterpartyBalance };
      return api.post(`/transactions/${tx.id}/convert-to-transfer`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      toast({ title: 'Transaction marked as transfer', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Could not mark as transfer',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  const formatCounterpartCandidate = (candidate: TransferCounterpartCandidate) => {
    const account = formatTransactionAccount(candidate.bankAccount);
    return [
      new Date(candidate.date).toLocaleDateString('en-IN'),
      candidate.description,
      formatINR(Number(candidate.amount)),
      account,
      candidate.balanceImpactApplied ? 'balance already applied' : 'balance not applied',
    ].filter(Boolean).join(' · ');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{isIncomingPayment ? 'Mark as Card Payment' : 'Mark as Transfer'}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
          <p className="font-medium truncate">{tx.description}</p>
          <p className="text-muted-foreground">
            {new Date(tx.date).toLocaleDateString('en-IN')} · <INRDisplay amount={tx.amount} />
          </p>
          <p className="text-muted-foreground">
            {isIncomingPayment ? 'To' : 'From'}: {tx.bankAccountName ?? (isIncomingPayment ? 'Destination account' : 'Source account')}
          </p>
        </div>

        <div className="space-y-1">
          <Label required>{isIncomingPayment ? 'From Account' : 'To Account'}</Label>
          <select
            value={counterpartyAccountId}
            onChange={(e) => setCounterpartyAccountId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">{isIncomingPayment ? 'Select source account' : 'Select destination account'}</option>
            {destinationAccounts.map((a: any) => (
              <option key={a.id} value={a.id}>
                {formatAccountOption(a)}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={adjustCounterpartyBalance}
            onChange={(e) => setAdjustCounterpartyBalance(e.target.checked)}
            className="mt-1 rounded"
          />
          <span>
            {isIncomingPayment ? 'Adjust source account balance' : 'Adjust destination account balance'}
            <span className="block text-xs text-muted-foreground">
              Leave unchecked if that account already has the real balance.
            </span>
          </span>
        </label>

        {counterpartyAccountId && (
          <div className="rounded-lg border bg-muted/20 p-3 text-sm space-y-2">
            <p className="font-medium">Matching counterparty transaction</p>
            {isLoadingCounterpartCandidates ? (
              <p className="text-xs text-muted-foreground">Checking imported transactions…</p>
            ) : counterpartCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No matching imported transaction found. The app will create the missing transfer leg.
              </p>
            ) : counterpartCandidates.length === 1 ? (
              <p className="text-xs text-green-700 dark:text-green-400">
                Found one matching imported transaction. The app will link it instead of creating a duplicate.
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Multiple matching imported transactions found. Choose the correct one to link.
                </p>
                <select
                  value={counterpartTransactionId}
                  onChange={(e) => setCounterpartTransactionId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select matching transaction</option>
                  {counterpartCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {formatCounterpartCandidate(candidate)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {convertMutation.isError && (
          <p className="text-sm text-destructive">
            {(convertMutation.error as any)?.response?.data?.message ?? 'Conversion failed'}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => convertMutation.mutate()}
            disabled={!counterpartyAccountId || isLoadingCounterpartCandidates || (requiresCounterpartChoice && !counterpartTransactionId) || convertMutation.isPending}
          >
            {convertMutation.isPending ? 'Saving…' : isIncomingPayment ? 'Mark as Card Payment' : 'Mark as Transfer'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConvertToSIPModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const targetUserId = user?.role === 'ADMIN' ? tx.userId : undefined;
  const { data: sips = [], isLoading } = useSIPs(targetUserId);
  const [sipId, setSipId] = useState(tx.sipId ?? '');
  const [units, setUnits] = useState(tx.sipUnits != null ? String(tx.sipUnits) : '');
  const [nav, setNav] = useState(tx.sipNav != null ? String(tx.sipNav) : '');
  const isEditing = !!(tx.sipId || tx.sipTransactionId);

  const hasPartialUnits = (units.trim() !== '' && nav.trim() === '') || (units.trim() === '' && nav.trim() !== '');

  const convertMutation = useMutation({
    mutationFn: () => {
      const payload = {
        sipId,
        units: units.trim() ? Number(units) : undefined,
        nav: nav.trim() ? Number(nav) : undefined,
      };
      return isEditing
        ? api.put(`/transactions/${tx.id}/sip-link`, payload)
        : api.post(`/transactions/${tx.id}/convert-to-sip`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['budgets-actuals'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['profit-and-loss'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      qc.invalidateQueries({ queryKey: ['sips'] });
      toast({ title: isEditing ? 'SIP link updated' : 'Transaction marked as SIP', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Could not mark as SIP',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/transactions/${tx.id}/sip-link`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['budgets-actuals'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['profit-and-loss'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      qc.invalidateQueries({ queryKey: ['sips'] });
      toast({ title: 'SIP link removed', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Could not remove SIP link',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  const canSubmit = !!sipId && !hasPartialUnits && !convertMutation.isPending && !removeMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{isEditing ? 'Change SIP Link' : 'Mark as SIP'}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
          <p className="font-medium truncate">{tx.description}</p>
          <p className="text-muted-foreground">
            {new Date(tx.date).toLocaleDateString('en-IN')} · <INRDisplay amount={tx.amount} />
          </p>
          <p className="text-muted-foreground">From: {tx.bankAccountName ?? 'Bank account'}</p>
          {tx.sipName && <p className="text-muted-foreground">Current SIP: {tx.sipName}</p>}
        </div>

        <div className="space-y-1">
          <Label required>SIP</Label>
          <select
            value={sipId}
            onChange={(e) => setSipId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            disabled={isLoading || sips.length === 0}
          >
            <option value="">{isLoading ? 'Loading SIPs…' : 'Select SIP'}</option>
            {sips.map((sip) => (
              <option key={sip.id} value={sip.id}>
                {sip.fundName} · {formatINR(sip.monthlyAmount)}
              </option>
            ))}
          </select>
          {!isLoading && sips.length === 0 && (
            <p className="text-xs text-muted-foreground">Add the SIP under Investments before linking this debit.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Units (optional)</Label>
            <Input
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              type="number"
              min="0"
              step="0.0001"
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1">
            <Label>NAV (optional)</Label>
            <Input
              value={nav}
              onChange={(e) => setNav(e.target.value)}
              type="number"
              min="0"
              step="0.0001"
              placeholder="Optional"
            />
          </div>
        </div>
        {hasPartialUnits && (
          <p className="text-sm text-destructive">Enter both units and NAV, or leave both blank.</p>
        )}

        {convertMutation.isError && (
          <p className="text-sm text-destructive">
            {(convertMutation.error as any)?.response?.data?.message ?? 'Conversion failed'}
          </p>
        )}

        <div className="flex justify-end gap-3">
          {isEditing && (
            <Button
              variant="destructive"
              onClick={() => removeMutation.mutate()}
              disabled={convertMutation.isPending || removeMutation.isPending}
              className="mr-auto"
            >
              {removeMutation.isPending ? 'Removing…' : 'Remove SIP Link'}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => convertMutation.mutate()}
            disabled={!canSubmit}
          >
            {convertMutation.isPending ? 'Saving…' : isEditing ? 'Save Link' : 'Mark as SIP'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LinkPolicyModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const targetUserId = user?.role === 'ADMIN' ? tx.userId : undefined;
  const { data: policies = [], isLoading } = useInsurancePolicies(targetUserId);
  const [insurancePolicyId, setInsurancePolicyId] = useState(tx.insurancePolicyId ?? '');
  const isEditing = !!tx.insurancePolicyId;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['insurance'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['profit-and-loss'] });
  };

  const linkMutation = useMutation({
    mutationFn: () => api.put(`/transactions/${tx.id}/policy-link`, { insurancePolicyId }),
    onSuccess: () => {
      invalidate();
      toast({ title: isEditing ? 'Policy link updated' : 'Transaction linked to policy', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Could not link policy',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/transactions/${tx.id}/policy-link`),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Policy link removed', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Could not remove policy link',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  const formatPolicy = (policy: InsurancePolicy) =>
    `${policy.providerName} · ${policy.policyName} · ${formatINR(Number(policy.premiumAmount))}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{isEditing ? 'Change Policy Link' : 'Link Policy'}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
          <p className="font-medium truncate">{tx.description}</p>
          <p className="text-muted-foreground">
            {new Date(tx.date).toLocaleDateString('en-IN')} · <INRDisplay amount={tx.amount} />
          </p>
          <p className="text-muted-foreground">From: {tx.bankAccountName ?? 'Bank account'}</p>
          {tx.insurancePolicyName && (
            <p className="text-muted-foreground">Current policy: {tx.insuranceProviderName} · {tx.insurancePolicyName}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label required>Insurance Policy</Label>
          <select
            value={insurancePolicyId}
            onChange={(e) => setInsurancePolicyId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            disabled={isLoading || policies.length === 0}
          >
            <option value="">{isLoading ? 'Loading policies…' : 'Select policy'}</option>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {formatPolicy(policy)}
              </option>
            ))}
          </select>
          {!isLoading && policies.length === 0 && (
            <p className="text-xs text-muted-foreground">Add the policy under Insurance before linking this debit.</p>
          )}
        </div>

        {linkMutation.isError && (
          <p className="text-sm text-destructive">
            {(linkMutation.error as any)?.response?.data?.message ?? 'Link failed'}
          </p>
        )}

        <div className="flex justify-end gap-3">
          {isEditing && (
            <Button
              variant="destructive"
              onClick={() => removeMutation.mutate()}
              disabled={linkMutation.isPending || removeMutation.isPending}
              className="mr-auto"
            >
              {removeMutation.isPending ? 'Removing…' : 'Remove Link'}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => linkMutation.mutate()}
            disabled={!insurancePolicyId || linkMutation.isPending || removeMutation.isPending}
          >
            {linkMutation.isPending ? 'Saving…' : 'Save Link'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LinkRefundModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const targetUserId = user?.role === 'ADMIN' ? tx.userId : undefined;
  const isRefundTransaction = tx.type === 'INCOME';
  const isOriginalExpense = tx.type === 'EXPENSE';
  const { data: expenses = [], isLoading: isExpensesLoading } = useRefundCandidates(targetUserId, isRefundTransaction);
  const { data: incomingRefunds = [], isLoading: isIncomingRefundsLoading } = useIncomingRefundCandidates(targetUserId, isOriginalExpense);
  const [refundForTransactionId, setRefundForTransactionId] = useState(tx.refundForTransactionId ?? '');
  const [refundTransactionId, setRefundTransactionId] = useState('');
  const isEditing = !!tx.refundForTransactionId;

  const selectedExpense = expenses.find((expense) => expense.id === refundForTransactionId);
  const selectedRefundedAmount = selectedExpense
    ? Math.max((selectedExpense.refundedAmount ?? 0) - (isEditing ? tx.amount : 0), 0)
    : 0;
  const selectedNetAfterRefund = selectedExpense
    ? selectedExpense.amount - selectedRefundedAmount - tx.amount
    : null;
  const selectedRefund = incomingRefunds.find((refund) => refund.id === refundTransactionId);
  const currentExpenseRefundedAmount = tx.refundedAmount ?? 0;
  const expenseNetAfterRefund = selectedRefund
    ? tx.amount - currentExpenseRefundedAmount - selectedRefund.amount
    : null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['refund-candidates'] });
    qc.invalidateQueries({ queryKey: ['incoming-refund-candidates'] });
    qc.invalidateQueries({ queryKey: ['budgets'] });
    qc.invalidateQueries({ queryKey: ['budgets-actuals'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['profit-and-loss'] });
  };

  const linkMutation = useMutation({
    mutationFn: () => {
      if (isOriginalExpense) {
        return api.put(`/transactions/${refundTransactionId}/refund-link`, { refundForTransactionId: tx.id });
      }
      return api.put(`/transactions/${tx.id}/refund-link`, { refundForTransactionId });
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: isOriginalExpense
          ? 'Refund linked to expense'
          : isEditing ? 'Refund link updated' : 'Transaction marked as refund',
        variant: 'success',
      });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Could not link refund',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/transactions/${tx.id}/refund-link`),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Refund link removed', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Could not remove refund link',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  const formatExpense = (expense: Transaction) =>
    `${new Date(expense.date).toLocaleDateString('en-IN')} · ${expense.description} · ${formatINR(expense.amount)}${expense.categoryName ? ` · ${expense.categoryName}` : ''}`;
  const formatIncomingRefund = (refund: Transaction) =>
    `${new Date(refund.date).toLocaleDateString('en-IN')} · ${refund.description} · ${formatINR(refund.amount)}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {isOriginalExpense ? 'Link Refund Credit' : isEditing ? 'Change Refund Link' : 'Mark as Refund'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
          <p className="font-medium truncate">{tx.description}</p>
          <p className="text-muted-foreground">
            {new Date(tx.date).toLocaleDateString('en-IN')} · <INRDisplay amount={tx.amount} />
          </p>
          {tx.bankAccountName && <p className="text-muted-foreground">To: {tx.bankAccountName}</p>}
          {tx.refundForDescription && (
            <p className="text-muted-foreground">Current original expense: {tx.refundForDescription}</p>
          )}
          {isOriginalExpense && currentExpenseRefundedAmount > 0 && (
            <p className="text-muted-foreground">Already refunded: <INRDisplay amount={currentExpenseRefundedAmount} /></p>
          )}
        </div>

        {isOriginalExpense ? (
          <div className="space-y-1">
            <Label required>Refund Credit</Label>
            <select
              value={refundTransactionId}
              onChange={(e) => setRefundTransactionId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              disabled={isIncomingRefundsLoading || incomingRefunds.length === 0}
            >
              <option value="">{isIncomingRefundsLoading ? 'Loading credits…' : 'Select incoming refund'}</option>
              {incomingRefunds.map((refund) => (
                <option key={refund.id} value={refund.id}>
                  {formatIncomingRefund(refund)}
                </option>
              ))}
            </select>
            {!isIncomingRefundsLoading && incomingRefunds.length === 0 && (
              <p className="text-xs text-muted-foreground">Add or import the incoming refund before linking it.</p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <Label required>Original Expense</Label>
            <select
              value={refundForTransactionId}
              onChange={(e) => setRefundForTransactionId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              disabled={isExpensesLoading || expenses.length === 0}
            >
              <option value="">{isExpensesLoading ? 'Loading expenses…' : 'Select original expense'}</option>
              {expenses.map((expense) => (
                <option key={expense.id} value={expense.id}>
                  {formatExpense(expense)}
                </option>
              ))}
            </select>
            {!isExpensesLoading && expenses.length === 0 && (
              <p className="text-xs text-muted-foreground">Add the original expense before linking this refund.</p>
            )}
          </div>
        )}

        {selectedRefund && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p>Original expense: <INRDisplay amount={tx.amount} /></p>
            {currentExpenseRefundedAmount > 0 && <p>Already refunded: <INRDisplay amount={currentExpenseRefundedAmount} /></p>}
            <p>This refund: <INRDisplay amount={selectedRefund.amount} /></p>
            <p>Net after this refund: <INRDisplay amount={Math.max(expenseNetAfterRefund ?? 0, 0)} /></p>
          </div>
        )}

        {selectedExpense && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p>Original expense: <INRDisplay amount={selectedExpense.amount} /></p>
            {selectedRefundedAmount > 0 && <p>Already refunded: <INRDisplay amount={selectedRefundedAmount} /></p>}
            <p>Net after this refund: <INRDisplay amount={Math.max(selectedNetAfterRefund ?? 0, 0)} /></p>
          </div>
        )}

        {isOriginalExpense && tx.refunds && tx.refunds.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Linked refunds</p>
            {tx.refunds.map((refund) => (
              <p key={refund.id}>
                {new Date(refund.date).toLocaleDateString('en-IN')} · {refund.description} · <INRDisplay amount={Number(refund.amount)} />
              </p>
            ))}
          </div>
        )}

        {isOriginalExpense && (
          <p className="text-xs text-muted-foreground">
            To remove or change an existing refund, open the linked income transaction and use Change Refund Link.
          </p>
        )}

        {linkMutation.isError && (
          <p className="text-sm text-destructive">
            {(linkMutation.error as any)?.response?.data?.message ?? 'Link failed'}
          </p>
        )}

        <div className="flex justify-end gap-3">
          {isEditing && isRefundTransaction && (
            <Button
              variant="destructive"
              onClick={() => removeMutation.mutate()}
              disabled={linkMutation.isPending || removeMutation.isPending}
              className="mr-auto"
            >
              {removeMutation.isPending ? 'Removing…' : 'Remove Link'}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => linkMutation.mutate()}
            disabled={!(isOriginalExpense ? refundTransactionId : refundForTransactionId) || linkMutation.isPending || removeMutation.isPending}
          >
            {linkMutation.isPending ? 'Saving…' : 'Save Link'}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DocumentAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TransactionDocumentsModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', 'Transaction', tx.id],
    queryFn: () => api.get<{ data: DocumentAttachment[] }>('/documents', {
      params: { entityType: 'Transaction', entityId: tx.id },
    }).then((r) => r.data.data),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityType', 'Transaction');
      formData.append('entityId', tx.id);
      return api.post('/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['documents', 'Transaction', tx.id] });
      toast({ title: 'Document uploaded', variant: 'success' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents', 'Transaction', tx.id] });
      toast({ title: 'Document deleted', variant: 'success' });
    },
  });

  async function downloadDocument(doc: DocumentAttachment) {
    const res = await api.get(`/documents/${doc.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Documents</h2>
            <p className="text-sm text-muted-foreground truncate max-w-sm">{tx.description}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="space-y-2">
          <Label required>Upload receipt or proof</Label>
          <div className="flex gap-2">
            <Input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button onClick={() => uploadMutation.mutate()} disabled={!file || uploadMutation.isPending}>
              {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
          {uploadMutation.isError && (
            <p className="text-sm text-destructive">{(uploadMutation.error as any)?.response?.data?.message ?? 'Upload failed'}</p>
          )}
        </div>

        <div className="border rounded-lg divide-y">
          {isLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading documents…</p>
          ) : documents.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No documents attached</p>
          ) : documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{doc.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(doc.fileSize)} · {new Date(doc.createdAt).toLocaleDateString('en-IN')}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" title="Download document" onClick={() => downloadDocument(doc)}>
                  <Download className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete document"
                  className="text-destructive hover:text-destructive"
                  onClick={() => deleteMutation.mutate(doc.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddTransactionModal({
  onClose,
  budgetActuals,
  targetUserId,
  showAccountOwner = false,
  fallbackAccountOwnerName,
}: {
  onClose: () => void;
  budgetActuals: BudgetActualItem[];
  targetUserId?: string;
  showAccountOwner?: boolean;
  fallbackAccountOwnerName?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts(targetUserId);
  const { data: loans = [] } = useLoans(targetUserId);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<TxForm>({
    resolver: zodResolver(txSchema),
    defaultValues: { type: 'EXPENSE', date: new Date().toISOString().slice(0, 10) },
  });

  const amount = watch('amount');
  const selectedType = watch('type');

  // Reset categoryId when transaction type changes so a stale cross-type category is never submitted
  useEffect(() => {
    setValue('categoryId', '');
  }, [selectedType, setValue]);

  const transactionCategories = categories.filter((c: any) => {
    if (selectedType === 'INCOME') return c.type === 'INCOME';
    if (selectedType === 'EXPENSE') return c.type === 'EXPENSE';
    return false; // TRANSFER — no categories
  });
  const formatModalAccountOption = (account: any) => formatAccountOption(account, {
    showOwner: showAccountOwner,
    fallbackOwnerName: fallbackAccountOwnerName,
  });

  const createMutation = useMutation({
    mutationFn: (data: TxForm) => api.post('/transactions', {
      ...data,
      remark: data.remark?.trim() || undefined,
      tags: data.tags ? data.tags.split(',').map((t) => t.trim()) : [],
      loanId: data.loanId || undefined,
    }, {
      params: targetUserId ? { targetUserId } : {},
    }),
    onSuccess: (_, submittedData) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      toast({ title: 'Transaction added', variant: 'success' });
      // Check if this EXPENSE pushes a budget over 80% or 100%
      if (submittedData.type === 'EXPENSE' && submittedData.categoryId) {
        const budget = budgetActuals.find((b) => b.categoryId === submittedData.categoryId);
        if (budget) {
          const projectedActual = budget.actual + Number(submittedData.amount);
          const projectedPct = (projectedActual / Number(budget.amount)) * 100;
          if (projectedPct >= 100) {
            toast({
              title: `Budget exceeded: ${budget.category.name}`,
              description: `${formatINR(projectedActual)} spent of ${formatINR(Number(budget.amount))} budget`,
              variant: 'error',
            });
          } else if (projectedPct >= 80) {
            toast({
              title: `Budget warning: ${budget.category.name}`,
              description: `${projectedPct.toFixed(0)}% used — ${formatINR(Number(budget.amount) - projectedActual)} remaining`,
              variant: 'warning',
            });
          }
        }
      }
      onClose();
      reset();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Add Transaction</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <form onSubmit={handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
              <Label required>Description</Label>
              <Input {...register('description')} placeholder="e.g. Swiggy order" />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Remark (optional)</Label>
              <Input {...register('remark')} placeholder="Bank transaction remark or note" />
            </div>
            <div className="space-y-1">
              <Label required>Amount (₹)</Label>
              <Input {...register('amount')} type="number" step="0.01" />
              {amount && <p className="text-xs text-muted-foreground">{formatINR(Number(amount))}</p>}
            </div>
            <div className="space-y-1">
              <Label required>Type</Label>
              <select {...register('type')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Income</option>
                <option value="TRANSFER">Transfer</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label required>Date</Label>
              <Input {...register('date')} type="date" />
            </div>
            <div className="space-y-1">
              <Label>Payment Mode (optional)</Label>
              <select {...register('paymentMode')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Select —</option>
                {['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Category (optional)</Label>
              <select {...register('categoryId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Uncategorized —</option>
                {sortCategoriesByNameAsc(transactionCategories).map((c: any) => (
                  <option key={c.id} value={c.id}>{getCategoryLabel(c, categories)}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>{selectedType === 'TRANSFER' ? 'From Account (optional)' : 'Bank Account (optional)'}</Label>
              <select {...register('bankAccountId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— None —</option>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{formatModalAccountOption(a)}</option>)}
              </select>
            </div>
            {selectedType === 'TRANSFER' && (
              <div className="col-span-2 space-y-1">
                <Label required>To Account</Label>
                <select {...register('transferToAccountId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— Select destination —</option>
                  {accounts.map((a: any) => <option key={a.id} value={a.id}>{formatModalAccountOption(a)}</option>)}
                </select>
              </div>
            )}
            {selectedType === 'EXPENSE' && loans.length > 0 && (
              <div className="col-span-2 space-y-1">
                <Label>Link to Loan (optional)</Label>
                <select {...register('loanId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— None —</option>
                  {loans.map((l: any) => (
                    <option key={l.id} value={l.id}>
                      {l.lenderName} ({l.loanType}) — {formatINR(Number(l.outstandingBalance))} outstanding
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-2 space-y-1">
              <Label>Tags (comma-separated, optional)</Label>
              <Input {...register('tags')} placeholder="food, work, travel" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>Add Transaction</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

async function downloadTransactionsCsv(fy: string, targetUserId?: string) {
  const res = await api.get('/transactions/export', {
    params: { fy, ...(targetUserId ? { targetUserId } : {}) },
    responseType: 'blob',
  });
  const blob = res.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${fy}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function TransactionsPage() {
  const { selectedFY } = useFY();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingFamilyWide = isAdmin && !viewUserId;
  const canCreateForView = !isViewingFamilyWide;
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [convertingTx, setConvertingTx] = useState<Transaction | null>(null);
  const [convertingSIPTx, setConvertingSIPTx] = useState<Transaction | null>(null);
  const [linkingPolicyTx, setLinkingPolicyTx] = useState<Transaction | null>(null);
  const [linkingRefundTx, setLinkingRefundTx] = useState<Transaction | null>(null);
  const [documentsTx, setDocumentsTx] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkCategorizing, setIsBulkCategorizing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'transactions';
  function setActiveTab(tab: 'transactions' | 'recurring') {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'transactions') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  }
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<TxFilters>({
    ...EMPTY_FILTERS,
    startDate: searchParams.get('startDate') ?? '',
    endDate: searchParams.get('endDate') ?? '',
  });
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  const activeFilterCount =
    (filters.search ? 1 : 0) +
    filters.types.length +
    filters.categoryIds.length +
    filters.paymentModes.length +
    (filters.startDate || filters.endDate ? 1 : 0);

  // Clear selection whenever the visible dataset changes
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkConfirmDelete(false);
  }, [filters, selectedFY, viewUserId]);

  // Auto-open add modal or filters from URL params
  useEffect(() => {
    // Wait for `user` before acting. Until the session resolves, isAdmin is false, which
    // makes canCreateForView misleadingly true — so the first branch below fired, and the
    // same pass stripped `add` from the URL. By the time the user resolved as ADMIN,
    // canCreateForView had flipped false, the render gate hid the modal, and the param
    // was already gone: the deep link silently did nothing, and the ADMIN fallback was
    // unreachable code. Nothing here is decidable until we know who they are.
    if (!user) return;

    const shouldOpenAdd = searchParams.get('add') === '1';
    if (shouldOpenAdd) {
      if (canCreateForView) {
        setShowAdd(true);
      } else if (isAdmin && !viewUserId && user?.id) {
        setViewUserId(user.id);
        setShowAdd(true);
      }
    }
    if (searchParams.get('startDate') || searchParams.get('endDate')) {
      setShowFilters(true);
    }
    if (searchParams.get('add') || searchParams.get('startDate') || searchParams.get('endDate')) {
      setSearchParams((prev) => {
        const next = new URLSearchParams();
        const tab = prev.get('tab');
        if (tab) next.set('tab', tab);
        return next;
      }, { replace: true });
    }
  }, [canCreateForView, isAdmin, searchParams, setSearchParams, setViewUserId, user, viewUserId]);

  // Close category dropdown on outside click
  useEffect(() => {
    if (!showCategoryDropdown) return;
    const handler = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setShowCategoryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCategoryDropdown]);

  function toggleFilter(field: 'types' | 'categoryIds' | 'paymentModes', value: string) {
    setFilters(f => ({
      ...f,
      [field]: f[field].includes(value) ? f[field].filter(v => v !== value) : [...f[field], value],
    }));
  }

  const canEdit = (tx: Transaction) =>
    user?.role === 'ADMIN' || user?.id === tx.userId;
  const canConvertToTransfer = (tx: Transaction) =>
    canEdit(tx)
    && !tx.transferPairId
    && !tx.sipId
    && !tx.sipTransactionId
    && !tx.insurancePolicyId
    && !tx.refundForTransactionId
    && (tx.refundedAmount ?? 0) === 0
    && (tx.type === 'EXPENSE' || tx.type === 'INCOME')
    && !!tx.bankAccountId;
  const canConvertToSIP = (tx: Transaction) =>
    canEdit(tx) && !tx.transferPairId && !tx.sipId && !tx.sipTransactionId && !tx.insurancePolicyId && (tx.refundedAmount ?? 0) === 0 && tx.type === 'EXPENSE';
  const canManageSIPLink = (tx: Transaction) =>
    canEdit(tx) && !tx.transferPairId && !!(tx.sipId || tx.sipTransactionId) && tx.type === 'EXPENSE';
  const canManagePolicyLink = (tx: Transaction) =>
    canEdit(tx) && !tx.transferPairId && !tx.sipId && !tx.sipTransactionId && (tx.refundedAmount ?? 0) === 0 && tx.type === 'EXPENSE';
  const canManageRefundLink = (tx: Transaction) =>
    canEdit(tx)
    && !tx.transferPairId
    && !tx.sipId
    && !tx.sipTransactionId
    && !tx.insurancePolicyId
    && (tx.type === 'INCOME' || tx.type === 'EXPENSE');

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    setIsBulkDeleting(true);
    try {
      const ids = [...selectedIds];
      const results = await Promise.allSettled(ids.map((id) => api.delete(`/transactions/${id}`)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = ids.length - failed;
      qc.invalidateQueries({ queryKey: ['transactions'] });
      if (failed === 0) {
        toast({ title: `Deleted ${succeeded} transaction${succeeded !== 1 ? 's' : ''}`, variant: 'success' });
      } else {
        toast({ title: `Deleted ${succeeded}/${ids.length} — ${failed} failed`, variant: 'warning' });
      }
      setSelectedIds(new Set());
      setBulkConfirmDelete(false);
    } finally {
      setIsBulkDeleting(false);
    }
  }

  async function handleBulkCategorize() {
    if (!bulkCategoryId) return;
    setIsBulkCategorizing(true);
    try {
      const ids = [...selectedIds];
      const results = await Promise.allSettled(ids.map((id) => api.put(`/transactions/${id}`, { categoryId: bulkCategoryId })));
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = ids.length - failed;
      qc.invalidateQueries({ queryKey: ['transactions'] });
      if (failed === 0) {
        toast({ title: `Categorized ${succeeded} transaction${succeeded !== 1 ? 's' : ''}`, variant: 'success' });
      } else {
        toast({ title: `Categorized ${succeeded}/${ids.length} — ${failed} failed`, variant: 'warning' });
      }
      setSelectedIds(new Set());
      setBulkCategoryId('');
    } finally {
      setIsBulkCategorizing(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await downloadTransactionsCsv(selectedFY, viewUserId);
    } finally {
      setExporting(false);
    }
  }

  const { data: categories = [] } = useCategories();
  const { data: budgetActuals = [] } = useBudgetsVsActuals(selectedFY, viewUserId);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ['transactions', selectedFY, filters, viewUserId],
    queryFn: ({ pageParam }) => fetchTransactions(selectedFY, filters, pageParam as string | undefined, viewUserId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
  });

  // Avatar colour per member, keyed by user id and assigned by position in the family
  // list. Positional assignment means two members can never share a fallback colour —
  // which a name hash could not guarantee, and matters because the compact avatar drops
  // the name. An explicit colorTag still wins; this only fills the gap.
  // Must stay above the `isLoading` early return: a hook called conditionally changes the
  // hook count between renders and React throws once loading completes.
  const memberFallbackColors = useMemo(() => buildMemberColorMap(members), [members]);

  if (isLoading) return <PageLoader />;

  const transactions = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.pagination.total ?? 0;
  const showMemberIndicator = isAdmin && !viewUserId;
  const selectedMemberName = viewUserId
    ? members.find((m) => m.id === viewUserId)?.name ?? (viewUserId === user?.id ? user.name : undefined)
    : undefined;

  const allSelectableIds = transactions
    .filter((tx) => !tx.transferPairId && !tx.sipId && !tx.sipTransactionId && canEdit(tx))
    .map((tx) => tx.id);
  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every((id) => selectedIds.has(id));

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allSelectableIds));
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Transactions</h1>
          {activeTab === 'transactions' && (
            <>
              <p className="text-muted-foreground">
                FY {selectedFY} · {total} transactions
                {isAdmin && viewUserId
                  ? ` · ${members.find((m) => m.id === viewUserId)?.name ?? 'Member'}`
                  : isAdmin ? ' · All Family' : ''}
              </p>
              {isAdmin && !isMembersLoading && (
                <div className="flex items-center gap-2 mt-2">
                  <label htmlFor="tx-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
                  {isMembersError ? (
                    <span className="text-xs text-destructive">Could not load members</span>
                  ) : (
                    <select
                      id="tx-member-select"
                      value={viewUserId ?? ''}
                      onChange={(e) => setViewUserId(e.target.value || undefined)}
                      className="rounded-md border bg-background px-3 py-1.5 text-sm"
                    >
                      <option value="">All Family</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        {activeTab === 'transactions' && <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setShowFilters((v) => !v)} className="relative">
            <SlidersHorizontal className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export CSV'}</span>
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Import CSV</span>
          </Button>
        </div>}
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-border">
        {(['transactions', 'recurring'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
            )}
          >
            {tab === 'transactions' ? <Receipt className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
            {tab === 'transactions' ? 'Transactions' : 'Recurring'}
          </button>
        ))}
      </div>

      {activeTab === 'recurring' && <RecurringRulesPage />}

      {/* Filter bar */}
      {activeTab === 'transactions' && showFilters && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          {/* Row 1: Search */}
          <Input
            placeholder="Search description or remark…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />

          {/* Row 2: Type chips */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Type</Label>
            <div className="flex flex-wrap gap-1.5">
              {TRANSACTION_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleFilter('types', value)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors border',
                    filters.types.includes(value)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-input bg-background hover:bg-muted text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Row 3: Payment mode chips */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-medium">Payment mode</Label>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => toggleFilter('paymentModes', mode)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors border',
                    filters.paymentModes.includes(mode)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-input bg-background hover:bg-muted text-foreground',
                  )}
                >
                  <span className="mr-1.5">{PAYMENT_MODE_ICONS[mode]}</span>
                  {PAYMENT_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>

          {/* Row 4: Category dropdown + date range */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Category multi-select dropdown */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Category</Label>
              <div ref={categoryDropdownRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowCategoryDropdown(v => !v)}
                  className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted transition-colors"
                >
                  <span className={filters.categoryIds.length === 0 ? 'text-muted-foreground' : ''}>
                    {filters.categoryIds.length === 0
                      ? 'All categories'
                      : `${filters.categoryIds.length} selected`}
                  </span>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showCategoryDropdown && 'rotate-180')} />
                </button>
                {showCategoryDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-20 rounded-md border border-border bg-popover shadow-md max-h-52 overflow-y-auto">
                    {categories.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">No categories</p>
                    ) : (
                      sortCategoriesByNameAsc(categories).map((c: any) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={filters.categoryIds.includes(c.id)}
                            onChange={() => toggleFilter('categoryIds', c.id)}
                            className="rounded"
                          />
                          {c.icon && <span>{c.icon}</span>}
                          <span>{getCategoryPath(c, categories)}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* From date */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">From date</Label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
                className="text-sm"
              />
            </div>

            {/* To date */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">To date</Label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
                className="text-sm"
              />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setFilters(EMPTY_FILTERS); setShowCategoryDropdown(false); }}
              >
                <X className="h-3.5 w-3.5 mr-1" /> Clear all
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {activeTab === 'transactions' && selectedIds.size > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <select
              value={bulkCategoryId}
              onChange={(e) => setBulkCategoryId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="">Assign category…</option>
              {sortCategoriesByNameAsc(categories).map((c: any) => (
                <option key={c.id} value={c.id}>{getCategoryLabel(c, categories)}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={handleBulkCategorize} disabled={!bulkCategoryId || isBulkCategorizing}>
              {isBulkCategorizing ? 'Applying…' : 'Apply'}
            </Button>
            {bulkConfirmDelete ? (
              <>
                <span className="text-sm text-destructive font-medium">Delete {selectedIds.size}?</span>
                <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting}>
                  {isBulkDeleting ? 'Deleting…' : 'Confirm'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setBulkConfirmDelete(false)}>Cancel</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive border-destructive/30" onClick={() => setBulkConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setSelectedIds(new Set()); setBulkConfirmDelete(false); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'transactions' && (transactions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No transactions yet"
          description="Add your first transaction or import a bank statement to start tracking."
          actionLabel="Import Bank Statement"
          onAction={() => setShowImport(true)}
        />
      ) : (<>
        <div className="hidden xl:block rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              <col className="w-8" />
              <col className="w-[8%]" />
              {showMemberIndicator && <col className="w-16" />}
              <col className={showMemberIndicator ? 'w-[20%]' : 'w-[16%]'} />
              <col className="w-[15%]" />
              <col className="w-[9%]" />
              <col className={showMemberIndicator ? 'w-[18%]' : 'w-[20%]'} />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-2 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded"
                    title="Select all"
                  />
                </th>
                <th className="px-2 py-3 text-left font-medium text-muted-foreground">Date</th>
                {showMemberIndicator && (
                  <th className="px-2 py-3 text-center font-medium text-muted-foreground">Member</th>
                )}
                <th className="px-2 py-3 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-2 py-3 text-left font-medium text-muted-foreground">Remark</th>
                <th className="px-2 py-3 text-left font-medium text-muted-foreground">Account</th>
                <th className="px-2 py-3 text-left font-medium text-muted-foreground">Category</th>
                <th className="px-2 py-3 text-left font-medium text-muted-foreground">Mode</th>
                <th className="px-2 py-3 text-right font-medium text-muted-foreground">Amount</th>
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className={cn('border-b border-border last:border-0 hover:bg-muted/30 transition-colors', selectedIds.has(tx.id) && 'bg-primary/5')}>
                  <td className="px-2 py-3 align-top">
                    {!tx.transferPairId && !tx.sipId && !tx.sipTransactionId && canEdit(tx) && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(tx.id)}
                        onChange={() => toggleSelect(tx.id)}
                        className="rounded"
                      />
                    )}
                  </td>
                  <td className="px-2 py-3 align-top text-muted-foreground whitespace-nowrap">
                    {new Date(tx.date).toLocaleDateString('en-IN')}
                  </td>
                  {showMemberIndicator && (
                    <td className="px-2 py-3 align-top text-center">
                      <MemberBadge name={tx.memberName} color={tx.memberColor} fallbackColor={memberFallbackColors.get(tx.userId)} compact />
                    </td>
                  )}
                  <td className="px-2 py-3 align-top font-medium truncate" title={tx.description}>{tx.description}</td>
                  <td className="px-2 py-3 align-top text-muted-foreground truncate" title={tx.remark || undefined}>{tx.remark || '—'}</td>
                  <td className="px-2 py-3 align-top">
                    <BankAccountBadge accountName={tx.bankAccountName} />
                  </td>
                  <td className="px-2 py-3 align-top text-muted-foreground">
                    {tx.transferPairId ? (
                      <TransferCategoryInfo tx={tx} />
                    ) : tx.refundForTransactionId ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          <Undo2 className="h-3 w-3" />
                          Refund
                        </span>
                        <div className="text-xs text-muted-foreground truncate">
                          For: {tx.refundForDescription ?? 'Original expense'}
                        </div>
                      </div>
                    ) : (tx.sipId || tx.sipTransactionId) ? (
                      <SIPCategoryInfo tx={tx} />
                    ) : tx.insurancePolicyId ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
                          <Shield className="h-3 w-3" />
                          Policy{tx.insurancePolicyName ? ` · ${tx.insurancePolicyName}` : ''}
                        </span>
                        {tx.categoryName && (
                          <div className="text-xs text-muted-foreground">
                            {tx.categoryIcon && <span className="mr-1">{tx.categoryIcon}</span>}
                            {tx.categoryName}
                          </div>
                        )}
                      </div>
                    ) : tx.transferPairId ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        Transfer
                      </span>
                    ) : (
                      <div className="space-y-1">
                        {tx.categoryIcon && <span className="mr-1">{tx.categoryIcon}</span>}
                        {tx.categoryName ?? '—'}
                        {(tx.refundedAmount ?? 0) > 0 && (
                          <div className="text-xs text-amber-600">
                            Refunded <INRDisplay amount={tx.refundedAmount} />
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-3 align-top">
                    {tx.paymentMode && (
                      <span className={cn('inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium', PAYMENT_MODE_COLORS[tx.paymentMode] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300')}>
                        {PAYMENT_MODE_ICONS[tx.paymentMode]}
                        <span className="truncate">{tx.paymentMode}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3 align-top text-right text-[11px]">
                    <INRDisplay
                      amount={tx.type === 'EXPENSE' ? -tx.amount : tx.amount}
                      colorCode
                      className="whitespace-nowrap"
                    />
                  </td>
                  <td className="px-2 py-3 align-top text-right">
                    <TransactionActionMenu
                      tx={tx}
                      canControl={canEdit(tx)}
                      canConvertToTransfer={canConvertToTransfer(tx)}
                      canConvertToSIP={canConvertToSIP(tx)}
                      canManageSIPLink={canManageSIPLink(tx)}
                      canManagePolicyLink={canManagePolicyLink(tx)}
                      canManageRefundLink={canManageRefundLink(tx)}
                      onDocuments={() => setDocumentsTx(tx)}
                      onTransfer={() => setConvertingTx(tx)}
                      onSIP={() => setConvertingSIPTx(tx)}
                      onPolicy={() => setLinkingPolicyTx(tx)}
                      onRefund={() => setLinkingRefundTx(tx)}
                      onEdit={() => setEditingTx(tx)}
                      onDelete={() => setDeletingTx(tx)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Compact card list — shown until the table has enough room. */}
        <div className="xl:hidden rounded-xl border border-border bg-card divide-y divide-border">
          {transactions.map((tx) => {
            const isTransfer = !!tx.transferPairId;
            const isSIP = !!(tx.sipId || tx.sipTransactionId);
            const isPolicy = !!tx.insurancePolicyId;
            const isRefund = !!tx.refundForTransactionId;
            return (
              <div key={tx.id} className={cn('p-3 space-y-1.5', selectedIds.has(tx.id) && 'bg-primary/5')}>
                {/* Row 1: description + date */}
                <div className="flex items-start justify-between gap-2">
                  {!isTransfer && !isSIP && canEdit(tx) && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(tx.id)}
                      onChange={() => toggleSelect(tx.id)}
                      className="rounded mt-0.5 shrink-0"
                    />
                  )}
                  <span className="font-medium text-sm truncate">{tx.description}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {new Date(tx.date).toLocaleDateString('en-IN')}
                  </span>
                </div>
                {tx.remark && (
                  <p className="text-xs text-muted-foreground truncate pl-6">{tx.remark}</p>
                )}
                {/* Row 2: badges */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {showMemberIndicator && (
                    <MemberBadge name={tx.memberName} color={tx.memberColor} fallbackColor={memberFallbackColors.get(tx.userId)} />
                  )}
                  {!isTransfer && (
                    <BankAccountBadge accountName={tx.bankAccountName} compact />
                  )}
                  {isTransfer && <TransferCategoryInfo tx={tx} compact />}
                  {isSIP && <SIPCategoryInfo tx={tx} compact />}
                  {isPolicy && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
                      <Shield className="h-3 w-3" />
                      Policy{tx.insurancePolicyName ? ` · ${tx.insurancePolicyName}` : ''}
                    </span>
                  )}
                  {isRefund && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      <Undo2 className="h-3 w-3" />
                      Refund{tx.refundForDescription ? ` · ${tx.refundForDescription}` : ''}
                    </span>
                  )}
                  {!isRefund && (tx.refundedAmount ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      Refunded <INRDisplay amount={tx.refundedAmount} />
                    </span>
                  )}
                  {tx.categoryName && !isSIP ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                      {tx.categoryIcon}
                      {tx.categoryName}
                    </span>
                  ) : !isTransfer && !isSIP && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                  {tx.paymentMode && (
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', PAYMENT_MODE_COLORS[tx.paymentMode] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300')}>
                      {PAYMENT_MODE_ICONS[tx.paymentMode]}
                      {tx.paymentMode}
                    </span>
                  )}
                </div>
                {/* Row 3: amount + actions */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <TransactionActionMenu
                      tx={tx}
                      compact
                      canControl={canEdit(tx)}
                      canConvertToTransfer={canConvertToTransfer(tx)}
                      canConvertToSIP={canConvertToSIP(tx)}
                      canManageSIPLink={canManageSIPLink(tx)}
                      canManagePolicyLink={canManagePolicyLink(tx)}
                      canManageRefundLink={canManageRefundLink(tx)}
                      onDocuments={() => setDocumentsTx(tx)}
                      onTransfer={() => setConvertingTx(tx)}
                      onSIP={() => setConvertingSIPTx(tx)}
                      onPolicy={() => setLinkingPolicyTx(tx)}
                      onRefund={() => setLinkingRefundTx(tx)}
                      onEdit={() => setEditingTx(tx)}
                      onDelete={() => setDeletingTx(tx)}
                    />
                  </div>
                  <INRDisplay amount={tx.type === 'EXPENSE' ? -tx.amount : tx.amount} colorCode />
                </div>
              </div>
            );
          })}
        </div>
      </>))}

      {activeTab === 'transactions' && hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : `Load more (${transactions.length} of ${total} shown)`}
          </Button>
        </div>
      )}

      {/* Import always targets a concrete owner: the selected member, or the admin's own
          account when viewing "All Family" — without changing the page's own view scope. */}
      {showImport && <ImportModal onClose={() => setShowImport(false)} targetUserId={viewUserId ?? user?.id} />}
      {showAdd && canCreateForView && (
        <AddTransactionModal
          onClose={() => setShowAdd(false)}
          budgetActuals={budgetActuals}
          targetUserId={viewUserId}
          showAccountOwner={isAdmin}
          fallbackAccountOwnerName={selectedMemberName}
        />
      )}
      {documentsTx && <TransactionDocumentsModal tx={documentsTx} onClose={() => setDocumentsTx(null)} />}
      {convertingTx && <ConvertToTransferModal tx={convertingTx} onClose={() => setConvertingTx(null)} />}
      {convertingSIPTx && <ConvertToSIPModal tx={convertingSIPTx} onClose={() => setConvertingSIPTx(null)} />}
      {linkingPolicyTx && <LinkPolicyModal tx={linkingPolicyTx} onClose={() => setLinkingPolicyTx(null)} />}
      {linkingRefundTx && <LinkRefundModal tx={linkingRefundTx} onClose={() => setLinkingRefundTx(null)} />}
      {editingTx && <EditTransactionModal tx={editingTx} onClose={() => setEditingTx(null)} />}
      {deletingTx && <DeleteConfirmModal tx={deletingTx} onClose={() => setDeletingTx(null)} />}
    </div>
  );
}
