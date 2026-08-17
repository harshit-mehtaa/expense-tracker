import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, CreditCard, Plus, Trash2, Edit2, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BankLogo } from '@/components/shared/BankLogo';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { ACCOUNT_TYPE_LABELS } from '@/lib/accountFormat';


const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  SAVINGS: 'bg-blue-100 text-blue-800', CURRENT: 'bg-gray-100 text-gray-800',
  SALARY: 'bg-green-100 text-green-800', NRE: 'bg-purple-100 text-purple-800',
  CREDIT_CARD: 'bg-rose-100 text-rose-800', DEBIT_CARD: 'bg-sky-100 text-sky-800', PREPAID_CARD: 'bg-violet-100 text-violet-800',
  NRO: 'bg-indigo-100 text-indigo-800', PPF: 'bg-amber-100 text-amber-800',
  EPF: 'bg-orange-100 text-orange-800', DEMAT: 'bg-teal-100 text-teal-800',
};

const BANKS = ['HDFC Bank', 'SBI', 'ICICI Bank', 'Axis Bank', 'Kotak Bank', 'PNB', 'Bank of Baroda', 'Canara Bank', 'Yes Bank', 'IDFC First Bank', 'Other'];
const OTHER_BANK = 'Other';
const CARD_ACCOUNT_TYPES = ['CREDIT_CARD', 'DEBIT_CARD', 'PREPAID_CARD'] as const;
const isCardTypeValue = (value?: string | null) => CARD_ACCOUNT_TYPES.includes(value as typeof CARD_ACCOUNT_TYPES[number]);
const BANK_ACCOUNT_TYPES = Object.entries(ACCOUNT_TYPE_LABELS).filter(([value]) => !isCardTypeValue(value));
const CARD_ACCOUNT_TYPE_OPTIONS = Object.entries(ACCOUNT_TYPE_LABELS).filter(([value]) => isCardTypeValue(value));
const BANK_ACCOUNT_ACCENTS: Array<{ match: RegExp; color: string }> = [
  { match: /\bhdfc\b/i, color: '#004C8F' },
  { match: /\b(state bank of india|sbi)\b/i, color: '#0284C7' },
  { match: /\bicici\b/i, color: '#B85B1E' },
  { match: /\baxis\b/i, color: '#97144D' },
  { match: /\bkotak\b/i, color: '#003974' },
  { match: /\b(punjab national bank|pnb)\b/i, color: '#A00000' },
  { match: /\b(bank of baroda|bob)\b/i, color: '#F15A24' },
  { match: /\bcanara\b/i, color: '#006CB5' },
  { match: /\byes\b/i, color: '#003399' },
  { match: /\bidfc\b/i, color: '#9D1D27' },
  { match: /\bindusind\b/i, color: '#8A1538' },
  { match: /\bfederal\b/i, color: '#005BAA' },
  { match: /\bau small|au bank|\bau\b/i, color: '#E87722' },
  { match: /\brbl\b/i, color: '#002F6C' },
  { match: /\bstandard chartered|stanchart\b/i, color: '#0072CE' },
  { match: /\bhsbc\b/i, color: '#DB0011' },
  { match: /\bciti\b/i, color: '#004B8D' },
  { match: /\bamerican express|amex\b/i, color: '#006FCF' },
];

const FALLBACK_BANK_ACCENTS = [
  '#2563EB',
  '#059669',
  '#7C3AED',
  '#D97706',
  '#0F766E',
  '#BE123C',
  '#4338CA',
  '#A16207',
];

const BANK_CARD_SURFACES: Array<{ match: RegExp; surface: string }> = [
  { match: /\bhdfc\b/i, surface: 'linear-gradient(135deg, #003b73 0%, #b91c1c 100%)' },
  { match: /\b(state bank of india|sbi)\b/i, surface: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)' },
  { match: /\bicici\b/i, surface: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)' },
  { match: /\baxis\b/i, surface: 'linear-gradient(135deg, #701a75 0%, #be123c 100%)' },
  { match: /\bkotak\b/i, surface: 'linear-gradient(135deg, #1e3a8a 0%, #dc2626 100%)' },
  { match: /\b(punjab national bank|pnb)\b/i, surface: 'linear-gradient(135deg, #7f1d1d 0%, #ca8a04 100%)' },
  { match: /\b(bank of baroda|bob)\b/i, surface: 'linear-gradient(135deg, #c2410c 0%, #f97316 100%)' },
  { match: /\bcanara\b/i, surface: 'linear-gradient(135deg, #075985 0%, #eab308 100%)' },
  { match: /\byes\b/i, surface: 'linear-gradient(135deg, #1d4ed8 0%, #dc2626 100%)' },
  { match: /\bidfc\b/i, surface: 'linear-gradient(135deg, #7f1d1d 0%, #b45309 100%)' },
  { match: /\bindusind\b/i, surface: 'linear-gradient(135deg, #581c87 0%, #9f1239 100%)' },
  { match: /\bfederal\b/i, surface: 'linear-gradient(135deg, #1e40af 0%, #047857 100%)' },
  { match: /\bau small|au bank|\bau\b/i, surface: 'linear-gradient(135deg, #b45309 0%, #7c2d12 100%)' },
  { match: /\brbl\b/i, surface: 'linear-gradient(135deg, #1e3a8a 0%, #be123c 100%)' },
  { match: /\bstandard chartered|stanchart\b/i, surface: 'linear-gradient(135deg, #0284c7 0%, #16a34a 100%)' },
  { match: /\bhsbc\b/i, surface: 'linear-gradient(135deg, #991b1b 0%, #111827 100%)' },
  { match: /\bciti\b/i, surface: 'linear-gradient(135deg, #1d4ed8 0%, #be123c 100%)' },
  { match: /\bamerican express|amex\b/i, surface: 'linear-gradient(135deg, #0f766e 0%, #0e7490 100%)' },
];

const FALLBACK_CARD_SURFACES = [
  'linear-gradient(135deg, #111827 0%, #0f766e 100%)',
  'linear-gradient(135deg, #1f2937 0%, #7f1d1d 100%)',
  'linear-gradient(135deg, #262626 0%, #a16207 100%)',
  'linear-gradient(135deg, #0f172a 0%, #155e75 100%)',
  'linear-gradient(135deg, #292524 0%, #065f46 100%)',
  'linear-gradient(135deg, #312e81 0%, #0e7490 100%)',
  'linear-gradient(135deg, #4c1d95 0%, #7e22ce 100%)',
  'linear-gradient(135deg, #164e63 0%, #365314 100%)',
];

const optionalDaySchema = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? undefined : value),
  z.coerce.number().int().min(1, 'Use day 1-31').max(31, 'Use day 1-31').optional(),
);

const optionalPositiveAmountSchema = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? undefined : value),
  z.coerce.number().min(0, 'Must be 0 or more').optional(),
);

const accountSchema = z.object({
  bankName: z.string().min(1, 'Required'),
  customBankName: z.string().trim().optional(),
  accountType: z.string(),
  accountNumber: z.string()
    .trim()
    .regex(/^[A-Za-z0-9 -]*$/, 'Only letters, numbers, spaces, and hyphens')
    .max(34, 'Too long')
    .optional(),
  ifscCode: z.string()
    .trim()
    .regex(/^$|^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'Enter a valid IFSC code')
    .optional(),
  currentBalance: z.coerce.number().default(0),
  upiId: z.string().optional(),
  interestRate: z.coerce.number().optional(),
  creditLimit: optionalPositiveAmountSchema,
  billingCycleStartDay: optionalDaySchema,
  billingCycleEndDay: optionalDaySchema,
  paymentDueDay: optionalDaySchema,
}).superRefine((data, ctx) => {
  if (data.bankName === OTHER_BANK && !data.customBankName?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Bank name is required',
      path: ['customBankName'],
    });
  }
});

type AccountForm = z.infer<typeof accountSchema>;
type AccountPayload = Omit<AccountForm, 'customBankName'>;
type AccountFormMode = 'BANK' | 'CREDIT_CARD';

function cleanAccountPayload(
  data: AccountForm,
  mode: AccountFormMode = data.accountType === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK',
  preservePositiveCreditBalance = false,
): AccountPayload {
  const bankName = data.bankName === OTHER_BANK ? data.customBankName?.trim() : data.bankName.trim();
  const accountType = mode === 'CREDIT_CARD'
    ? isCardTypeValue(data.accountType) ? data.accountType : 'CREDIT_CARD'
    : data.accountType;
  const isCard = isCardTypeValue(accountType);
  const currentBalance = accountType === 'CREDIT_CARD'
    ? preservePositiveCreditBalance
      ? Math.abs(Number(data.currentBalance) || 0)
      : -Math.abs(Number(data.currentBalance) || 0)
    : data.currentBalance;

  return {
    bankName: bankName ?? '',
    accountType,
    accountNumber: data.accountNumber?.trim() || undefined,
    ifscCode: isCard ? undefined : data.ifscCode?.trim().toUpperCase() || undefined,
    currentBalance,
    upiId: isCard ? undefined : data.upiId?.trim() || undefined,
    interestRate: Number.isFinite(data.interestRate) ? data.interestRate : undefined,
    creditLimit: isCard && Number.isFinite(data.creditLimit) ? data.creditLimit : undefined,
    billingCycleStartDay: isCard ? data.billingCycleStartDay : undefined,
    billingCycleEndDay: isCard ? data.billingCycleEndDay : undefined,
    paymentDueDay: isCard ? data.paymentDueDay : undefined,
  };
}

function useAccounts(viewUserId?: string) {
  return useQuery({
    queryKey: ['accounts', viewUserId],
    queryFn: () =>
      api.get<{ data: any[] }>('/accounts', { params: viewUserId ? { userId: viewUserId } : {} }).then((r) => r.data.data),
  });
}

function isCreditCardAccount(account: any) {
  return account.accountType === 'CREDIT_CARD';
}

function isCardAccount(account: any) {
  return isCardTypeValue(account.accountType);
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export default function AccountsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<AccountFormMode>('BANK');
  const [editing, setEditing] = useState<any>(null);
  const [maskedBalances, setMaskedBalances] = useState(true);
  const [visibleAccountNumbers, setVisibleAccountNumbers] = useState<Set<string>>(() => new Set());
  const [visibleIfscCodes, setVisibleIfscCodes] = useState<Set<string>>(() => new Set());
  const [reconciling, setReconciling] = useState<any>(null);
  const [reconcileBalance, setReconcileBalance] = useState('');
  const [reconcileNote, setReconcileNote] = useState('');

  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingFamilyWide = isAdmin && !viewUserId;

  const { data: accounts = [], isLoading } = useAccounts(viewUserId);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: { bankName: BANKS[0], accountType: 'SAVINGS', currentBalance: 0 },
  });
  const selectedBankName = watch('bankName');
  const selectedCustomBankName = watch('customBankName');
  const selectedAccountType = watch('accountType');
  const previewBankName = selectedBankName === OTHER_BANK ? selectedCustomBankName?.trim() : selectedBankName;

  const invalidateAccounts = () => qc.invalidateQueries({ queryKey: ['accounts'] });

  const createMutation = useMutation({
    mutationFn: (data: AccountForm) =>
      api.post('/accounts', cleanAccountPayload(data, formMode), { params: viewUserId ? { userId: viewUserId } : {} }),
    onSuccess: () => { invalidateAccounts(); setShowForm(false); reset(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: AccountForm }) => api.put(
      `/accounts/${id}`,
      cleanAccountPayload(
        data,
        formMode,
        formMode === 'CREDIT_CARD' && editing?.accountType === 'CREDIT_CARD' && Number(editing?.currentBalance) > 0,
      ),
    ),
    onSuccess: () => { invalidateAccounts(); setEditing(null); setShowForm(false); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/accounts/${id}`),
    onSuccess: () => invalidateAccounts(),
  });

  const reconcileMutation = useMutation({
    mutationFn: ({ id, actualBalance, note }: { id: string; actualBalance: number; note?: string }) =>
      api.post(`/accounts/${id}/reconcile`, { actualBalance, note }),
    onSuccess: () => {
      invalidateAccounts();
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setReconciling(null);
      setReconcileBalance('');
      setReconcileNote('');
    },
  });

  function startEdit(account: any) {
    const mode: AccountFormMode = isCardAccount(account) ? 'CREDIT_CARD' : 'BANK';
    const isKnownBank = BANKS.includes(account.bankName) && account.bankName !== OTHER_BANK;
    setEditing(account);
    setFormMode(mode);
    setValue('bankName', isKnownBank ? account.bankName : OTHER_BANK);
    setValue('customBankName', isKnownBank ? '' : account.bankName);
    setValue('accountType', mode === 'CREDIT_CARD' ? account.accountType : account.accountType);
    setValue('accountNumber', account.accountNumber ?? '');
    setValue('ifscCode', mode === 'CREDIT_CARD' ? '' : account.ifscCode ?? '');
    setValue('currentBalance', account.accountType === 'CREDIT_CARD' ? Math.max(Math.abs(Number(account.currentBalance)), 0) : account.currentBalance);
    setValue('upiId', mode === 'CREDIT_CARD' ? '' : account.upiId ?? '');
    setValue('creditLimit', account.creditLimit ?? undefined);
    setValue('billingCycleStartDay', account.billingCycleStartDay ?? undefined);
    setValue('billingCycleEndDay', account.billingCycleEndDay ?? undefined);
    setValue('paymentDueDay', account.paymentDueDay ?? undefined);
    setShowForm(true);
  }

  function openAddBankAccount() {
    setEditing(null);
    setFormMode('BANK');
    reset({ bankName: BANKS[0], accountType: 'SAVINGS', currentBalance: 0 });
    setShowForm(true);
  }

  function openAddCreditCard() {
    setEditing(null);
    setFormMode('CREDIT_CARD');
    reset({ bankName: BANKS[0], accountType: 'CREDIT_CARD', currentBalance: 0 });
    setShowForm(true);
  }

  function closeAccountForm() {
    setShowForm(false);
    setEditing(null);
    reset();
  }

  const bankAccounts = accounts.filter((account: any) => !isCardAccount(account));
  const cardAccounts = accounts.filter(isCardAccount);
  const creditCardAccounts = cardAccounts.filter(isCreditCardAccount);
  const bankBalance = bankAccounts.reduce((sum: number, account: any) => sum + Number(account.currentBalance), 0);
  const otherCardBalance = cardAccounts
    .filter((account: any) => !isCreditCardAccount(account))
    .reduce((sum: number, account: any) => sum + Number(account.currentBalance), 0);
  const creditCardOutstanding = creditCardAccounts.reduce(
    (sum: number, account: any) => sum + Math.max(-Number(account.currentBalance), 0),
    0,
  );
  const creditCardCreditBalance = creditCardAccounts.reduce(
    (sum: number, account: any) => sum + Math.max(Number(account.currentBalance), 0),
    0,
  );
  const netPosition = bankBalance + otherCardBalance - creditCardOutstanding + creditCardCreditBalance;

  function toggleAccountNumber(accountId: string) {
    setVisibleAccountNumbers((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  function toggleIfscCode(accountId: string) {
    setVisibleIfscCodes((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  function formatAccountNumber(account: any): string {
    if (visibleAccountNumbers.has(account.id) && account.accountNumber) return account.accountNumber;
    if (account.accountNumberLast4) return `•••• ${account.accountNumberLast4}`;
    return 'Account number not saved';
  }

  function formatIfscCode(account: any): string {
    if (visibleIfscCodes.has(account.id) && account.ifscCode) return account.ifscCode;
    if (account.ifscCode) return `IFSC •••• ${account.ifscCode.slice(-4)}`;
    if (account.ifscPrefix) return `IFSC ${account.ifscPrefix}••••`;
    return 'IFSC not saved';
  }

  function formatCardNumber(account: any): string {
    if (visibleAccountNumbers.has(account.id) && account.accountNumber) {
      const compact = String(account.accountNumber).replace(/[^A-Za-z0-9]/g, '');
      return compact.match(/.{1,4}/g)?.join(' ') ?? account.accountNumber;
    }
    if (account.accountNumberLast4) return `•••• •••• •••• ${account.accountNumberLast4}`;
    return '•••• •••• •••• ••••';
  }

  function getCardSurface(account: any) {
    const bankName = String(account.bankName ?? '').trim();
    const bankSurface = BANK_CARD_SURFACES.find((item) => item.match.test(bankName));
    if (bankSurface) return bankSurface.surface;
    return FALLBACK_CARD_SURFACES[hashString(bankName.toLowerCase()) % FALLBACK_CARD_SURFACES.length];
  }

  function getBankAccentColor(account: any) {
    const bankName = String(account.bankName ?? '').trim();
    const bankAccent = BANK_ACCOUNT_ACCENTS.find((item) => item.match.test(bankName));
    if (bankAccent) return bankAccent.color;
    return FALLBACK_BANK_ACCENTS[hashString(bankName.toLowerCase()) % FALLBACK_BANK_ACCENTS.length];
  }

  function submitAccount(data: AccountForm) {
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate(data);
  }

  const formTitle = editing
    ? formMode === 'CREDIT_CARD' ? 'Edit Card' : 'Edit Bank Account'
    : formMode === 'CREDIT_CARD' ? 'Add Card' : 'Add Bank Account';
  const issuerLabel = formMode === 'CREDIT_CARD' ? 'Issuer' : 'Bank Name';
  const numberLabel = formMode === 'CREDIT_CARD' ? 'Card Number (optional)' : 'Account Number (optional)';
  const numberPlaceholder = formMode === 'CREDIT_CARD' ? 'Full card number or last 4 digits' : 'Full account number';
  const isSelectedCreditCard = selectedAccountType === 'CREDIT_CARD';
  const isEditingCreditBalance = isSelectedCreditCard && Number(editing?.currentBalance) > 0;
  const balanceLabel = formMode === 'CREDIT_CARD'
    ? isSelectedCreditCard
      ? isEditingCreditBalance ? 'Current Credit Balance (₹)' : 'Current Outstanding (₹)'
      : 'Current Balance (₹)'
    : 'Current Balance (₹)';
  const balanceHelp = formMode === 'CREDIT_CARD' && isSelectedCreditCard && !isEditingCreditBalance
    ? 'Enter the amount currently due. It will be stored as card outstanding.'
    : isSelectedCreditCard && isEditingCreditBalance
    ? 'This card currently has a credit balance, so the amount will be kept positive.'
    : formMode === 'CREDIT_CARD'
    ? 'Use 0 when the card balance is already tracked by a linked bank account.'
    : null;

  function renderOwnerChip(account: any) {
    if (!isViewingFamilyWide || !account.userName) return null;

    return (
      <span
        className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
        title={`Owner: ${account.userName}`}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: account.userColorTag ?? '#64748b' }}
          aria-hidden="true"
        />
        <span className="truncate">{account.userName}</span>
      </span>
    );
  }

  function renderAccountCard(account: any) {
    const balance = Number(account.currentBalance);
    const accentColor = getBankAccentColor(account);
    const accountNumber = formatAccountNumber(account);
    const ifscCode = formatIfscCode(account);

    return (
      <div key={account.id} className={cn('relative overflow-hidden rounded-lg border bg-card p-4 pl-5 shadow-sm', !account.isActive && 'opacity-60')}>
        <span
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: accentColor }}
          aria-hidden="true"
        />
        <div className="flex items-start justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <BankLogo bankName={account.bankName} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', ACCOUNT_TYPE_COLORS[account.accountType] ?? 'bg-gray-100 text-gray-800')}>
                  {ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType}
                </span>
                {!account.isActive && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Inactive</span>
                )}
              </div>
              <h3 className="mt-2 truncate font-semibold">{account.bankName}</h3>
              {renderOwnerChip(account)}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" title="Reconcile balance" aria-label="Reconcile balance" onClick={() => { setReconciling(account); setReconcileBalance(String(balance)); setReconcileNote(''); }}><RefreshCw className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" title="Edit account" aria-label="Edit account" onClick={() => startEdit(account)}><Edit2 className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" title="Delete account" aria-label="Delete account" onClick={() => deleteMutation.mutate(account.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs text-muted-foreground">Available Balance</p>
          {maskedBalances ? (
            <p className="text-2xl font-bold leading-tight">₹ ••••••</p>
          ) : (
            <INRDisplay amount={balance} className="text-2xl font-bold leading-tight" colorCode />
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0 border-t pt-3">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Account</p>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 truncate font-mono font-medium" title={accountNumber}>{accountNumber}</p>
              {account.accountNumber && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={visibleAccountNumbers.has(account.id) ? 'Hide account number' : 'Show account number'}
                  title={visibleAccountNumbers.has(account.id) ? 'Hide account number' : 'Show account number'}
                  onClick={() => toggleAccountNumber(account.id)}
                >
                  {visibleAccountNumbers.has(account.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          </div>

          <div className="min-w-0 border-t pt-3">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">IFSC</p>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 truncate font-mono font-medium" title={ifscCode}>{ifscCode}</p>
              {account.ifscCode && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={visibleIfscCodes.has(account.id) ? 'Hide IFSC code' : 'Show IFSC code'}
                  title={visibleIfscCodes.has(account.id) ? 'Hide IFSC code' : 'Show IFSC code'}
                  onClick={() => toggleIfscCode(account.id)}
                >
                  {visibleIfscCodes.has(account.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          </div>

          <div className="min-w-0 border-t pt-3">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">UPI</p>
            <p className="mt-1 truncate font-medium" title={account.upiId || 'Not saved'}>
              {account.upiId || 'Not saved'}
            </p>
          </div>

          <div className="min-w-0 border-t pt-3">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Interest</p>
            <p className="mt-1 truncate font-medium">
              {account.interestRate ? `${account.interestRate}% p.a.` : 'Not saved'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  function renderPhysicalCard(account: any) {
    const balance = Number(account.currentBalance);
    const isCard = isCreditCardAccount(account);
    const cardOutstanding = Math.max(-balance, 0);
    const cardCredit = Math.max(balance, 0);
    const hasBillingDetails = (
      account.billingCycleStartDay
      || account.billingCycleEndDay
      || account.paymentDueDay
      || Number(account.creditLimit) > 0
    );
    const billingCycle = account.billingCycleStartDay || account.billingCycleEndDay
      ? `${account.billingCycleStartDay ? `Day ${account.billingCycleStartDay}` : 'Start not set'} - ${account.billingCycleEndDay ? `Day ${account.billingCycleEndDay}` : 'Statement not set'}`
      : 'Cycle not set';

    return (
      <div key={account.id} className={cn('space-y-2', !account.isActive && 'opacity-60')}>
        <div
          className="relative flex aspect-[1.586/1] min-h-[208px] flex-col overflow-hidden rounded-lg p-4 text-white shadow-sm"
          style={{ background: getCardSurface(account) }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_15%,rgba(255,255,255,0.18),transparent_34%)]" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <BankLogo bankName={account.bankName} size="sm" className="ring-white/30" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{account.bankName}</p>
                <p className="text-[11px] uppercase tracking-normal text-white/70">
                  {ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white hover:bg-white/15 hover:text-white"
                title="Reconcile balance"
                aria-label="Reconcile balance"
                onClick={() => { setReconciling(account); setReconcileBalance(String(balance)); setReconcileNote(''); }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white hover:bg-white/15 hover:text-white"
                title="Edit card"
                aria-label="Edit card"
                onClick={() => startEdit(account)}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white hover:bg-white/15 hover:text-white"
                title="Delete card"
                aria-label="Delete card"
                onClick={() => deleteMutation.mutate(account.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="relative mt-5 h-8 w-11 rounded-md border border-white/40 bg-[linear-gradient(135deg,#f8fafc,#a3a3a3)] shadow-inner" />

          <div className="relative mt-auto space-y-3">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-mono text-lg font-semibold tracking-normal">
                {formatCardNumber(account)}
              </p>
              {account.accountNumber && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-white hover:bg-white/15 hover:text-white"
                  aria-label={visibleAccountNumbers.has(account.id) ? 'Hide card number' : 'Show card number'}
                  title={visibleAccountNumbers.has(account.id) ? 'Hide card number' : 'Show card number'}
                  onClick={() => toggleAccountNumber(account.id)}
                >
                  {visibleAccountNumbers.has(account.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>

            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-normal text-white/60">Cardholder</p>
                <p className="truncate text-sm font-medium">{account.userName ?? 'Family Member'}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-normal text-white/60">Due</p>
                <p className="text-sm font-medium">{account.paymentDueDay ? `Day ${account.paymentDueDay}` : '--'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border bg-card p-2">
            <p className="text-muted-foreground">{isCard && balance < 0 ? 'Outstanding' : 'Card Balance'}</p>
            {maskedBalances ? (
              <p className="font-semibold">₹ ••••</p>
            ) : isCard && balance < 0 ? (
              <INRDisplay amount={cardOutstanding} className="font-semibold text-rose-700 dark:text-rose-400" />
            ) : isCard && balance > 0 ? (
              <INRDisplay amount={cardCredit} className="font-semibold text-emerald-700 dark:text-emerald-400" />
            ) : (
              <INRDisplay amount={balance} className="font-semibold" />
            )}
          </div>
          <div className="rounded-md border bg-card p-2">
            <p className="text-muted-foreground">Credit Limit</p>
            {Number(account.creditLimit) > 0 ? (
              <INRDisplay amount={Number(account.creditLimit)} className="font-semibold" />
            ) : (
              <p className="font-semibold">Not set</p>
            )}
          </div>
          <div className="rounded-md border bg-card p-2">
            <p className="text-muted-foreground">Billing Cycle</p>
            <p className="font-semibold">{billingCycle}</p>
          </div>
          <div className="rounded-md border bg-card p-2">
            <p className="text-muted-foreground">Status</p>
            <p className="font-semibold">
              {!account.isActive ? 'Inactive' : hasBillingDetails ? 'Tracked' : 'Details pending'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accounts & Cards</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {accounts.length} account{accounts.length !== 1 ? 's' : ''}
            {isAdmin && viewUserId ? ` · ${members.find((m) => m.id === viewUserId)?.name ?? 'Member'}` : isAdmin ? ' · All Family' : ''}
          </p>
          {isAdmin && !isMembersLoading && (
            <div className="flex items-center gap-2 mt-2">
              <label htmlFor="accounts-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
              {isMembersError ? (
                <span className="text-xs text-destructive">Could not load members</span>
              ) : (
                <select
                  id="accounts-member-select"
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
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setMaskedBalances(!maskedBalances)}>
            <Eye className="h-4 w-4 mr-1" /> {maskedBalances ? 'Show' : 'Hide'} Balances
          </Button>
          {!isViewingFamilyWide && (
            <>
              <Button variant="outline" onClick={openAddCreditCard}>
                <CreditCard className="h-4 w-4 mr-2" /> Add Card
              </Button>
              <Button onClick={openAddBankAccount}>
                <Plus className="h-4 w-4 mr-2" /> Add Bank Account
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            {isViewingFamilyWide ? 'Bank Balance — All Family' : 'Bank & Savings Balance'}
          </p>
          {maskedBalances ? (
            <p className="text-2xl font-bold mt-1">₹ ••••••</p>
          ) : (
            <INRDisplay amount={bankBalance} className="text-2xl font-bold mt-1" />
          )}
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">Credit Card Outstanding</p>
          {maskedBalances ? (
            <p className="text-2xl font-bold mt-1">₹ ••••••</p>
          ) : (
            <INRDisplay amount={creditCardOutstanding} className="text-2xl font-bold mt-1 text-rose-700 dark:text-rose-400" />
          )}
          {!maskedBalances && creditCardCreditBalance > 0 && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
              Credit balance: <INRDisplay amount={creditCardCreditBalance} />
            </p>
          )}
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">Net Position</p>
          {maskedBalances ? (
            <p className="text-2xl font-bold mt-1">₹ ••••••</p>
          ) : (
            <INRDisplay amount={netPosition} className="text-2xl font-bold mt-1" />
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading accounts…</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="font-medium">No accounts added yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add savings, salary, investment, or credit card accounts</p>
        </div>
      ) : (
        <div className="space-y-8">
          {bankAccounts.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <h2 className="font-semibold">Bank & Savings Accounts</h2>
                    <p className="text-xs text-muted-foreground">Savings, salary, current, deposits, and investment-linked accounts</p>
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {bankAccounts.length}
                </span>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {bankAccounts.map(renderAccountCard)}
              </div>
            </section>
          )}

          {cardAccounts.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <h2 className="font-semibold">Cards</h2>
                    <p className="text-xs text-muted-foreground">Credit, debit, prepaid cards, billing cycles, and payment tracking</p>
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {cardAccounts.length}
                </span>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cardAccounts.map(renderPhysicalCard)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Reconcile Modal */}
      {reconciling && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-xl font-semibold">Reconcile Balance</h2>
            <p className="text-sm text-muted-foreground">
              {reconciling.bankName} {reconciling.accountNumberLast4 ? `•••• ${reconciling.accountNumberLast4}` : ''}
            </p>
            <div className="space-y-1">
              <Label required>Actual Balance (₹)</Label>
              <Input
                type="number"
                step="0.01"
                value={reconcileBalance}
                onChange={(e) => setReconcileBalance(e.target.value)}
                placeholder="Enter your actual bank balance"
              />
            </div>
            <div className="space-y-1">
              <Label>Note (optional)</Label>
              <Input
                value={reconcileNote}
                onChange={(e) => setReconcileNote(e.target.value)}
                placeholder="e.g. Monthly bank statement check"
              />
            </div>
            {reconcileMutation.isError && (
              <p className="text-sm text-destructive">
                {(reconcileMutation.error as any)?.response?.data?.message ?? 'Reconciliation failed'}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => { setReconciling(null); setReconcileBalance(''); setReconcileNote(''); }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => reconcileMutation.mutate({
                  id: reconciling.id,
                  actualBalance: parseFloat(reconcileBalance),
                  note: reconcileNote || undefined,
                })}
                disabled={reconcileMutation.isPending || !reconcileBalance || isNaN(parseFloat(reconcileBalance))}
              >
                {reconcileMutation.isPending ? 'Reconciling…' : 'Reconcile'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">{formTitle}</h2>
            <form onSubmit={handleSubmit(submitAccount)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="account-bank-name" required>{issuerLabel}</Label>
                <select id="account-bank-name" {...register('bankName')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                {errors.bankName && <p className="text-xs text-destructive">{errors.bankName.message}</p>}
              </div>
              {selectedBankName === OTHER_BANK && (
                <div className="space-y-1">
                  <Label htmlFor="account-custom-bank-name" required>Custom Bank Name</Label>
                  <Input id="account-custom-bank-name" {...register('customBankName')} placeholder="Enter bank name" autoComplete="organization" />
                  {errors.customBankName && <p className="text-xs text-destructive">{errors.customBankName.message}</p>}
                </div>
              )}
              {previewBankName && (
                <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
                  <BankLogo bankName={previewBankName} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{previewBankName}</p>
                    <p className="text-xs text-muted-foreground">{formMode === 'CREDIT_CARD' ? 'Issuer logo preview' : 'Logo preview'}</p>
                  </div>
                </div>
              )}
              {formMode === 'BANK' && (
                <div className="space-y-1">
                  <Label htmlFor="account-type" required>Account Type</Label>
                  <select id="account-type" {...register('accountType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {BANK_ACCOUNT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              {formMode === 'CREDIT_CARD' && (
                <div className="space-y-1">
                  <Label htmlFor="card-type" required>Card Type</Label>
                  <select id="card-type" {...register('accountType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {CARD_ACCOUNT_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="account-number">{numberLabel}</Label>
                <Input id="account-number" {...register('accountNumber')} inputMode="numeric" autoComplete="off" placeholder={numberPlaceholder} />
                {errors.accountNumber && <p className="text-xs text-destructive">{errors.accountNumber.message}</p>}
              </div>
              {formMode === 'BANK' && (
                <div className="space-y-1">
                  <Label htmlFor="account-ifsc-code">IFSC Code (optional)</Label>
                  <Input id="account-ifsc-code" {...register('ifscCode')} maxLength={11} autoCapitalize="characters" placeholder="HDFC0001234" />
                  {errors.ifscCode && <p className="text-xs text-destructive">{errors.ifscCode.message}</p>}
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="account-current-balance" required>{balanceLabel}</Label>
                <Input id="account-current-balance" {...register('currentBalance')} type="number" step="0.01" />
                {balanceHelp && <p className="text-xs text-muted-foreground">{balanceHelp}</p>}
              </div>
              {formMode === 'BANK' && (
                <div className="space-y-1">
                  <Label htmlFor="account-upi-id">UPI ID (optional)</Label>
                  <Input id="account-upi-id" {...register('upiId')} placeholder="name@upi" />
                </div>
              )}
              {formMode === 'CREDIT_CARD' && (
                <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                  <div>
                    <p className="text-sm font-medium">Billing Cycle</p>
                    <p className="text-xs text-muted-foreground">Use monthly day numbers from 1 to 31.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="billing-cycle-start-day">Start Day</Label>
                      <Input id="billing-cycle-start-day" {...register('billingCycleStartDay')} type="number" min={1} max={31} inputMode="numeric" placeholder="1" />
                      {errors.billingCycleStartDay && <p className="text-xs text-destructive">{errors.billingCycleStartDay.message}</p>}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="billing-cycle-end-day">Statement Day</Label>
                      <Input id="billing-cycle-end-day" {...register('billingCycleEndDay')} type="number" min={1} max={31} inputMode="numeric" placeholder="30" />
                      {errors.billingCycleEndDay && <p className="text-xs text-destructive">{errors.billingCycleEndDay.message}</p>}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="payment-due-day">Due Day</Label>
                      <Input id="payment-due-day" {...register('paymentDueDay')} type="number" min={1} max={31} inputMode="numeric" placeholder="15" />
                      {errors.paymentDueDay && <p className="text-xs text-destructive">{errors.paymentDueDay.message}</p>}
                    </div>
                  </div>
                  {isSelectedCreditCard && (
                    <div className="space-y-1">
                      <Label htmlFor="credit-limit">Credit Limit (optional)</Label>
                      <Input id="credit-limit" {...register('creditLimit')} type="number" step="0.01" min={0} placeholder="Card limit" />
                      {errors.creditLimit && <p className="text-xs text-destructive">{errors.creditLimit.message}</p>}
                    </div>
                  )}
                </div>
              )}
              {(createMutation.isError || updateMutation.isError) && (
                <p className="text-sm text-destructive">
                  {((createMutation.error ?? updateMutation.error) as any)?.response?.data?.message ?? 'Account could not be saved'}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={closeAccountForm}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editing ? 'Update' : 'Add'} {formMode === 'CREDIT_CARD' ? 'Card' : 'Bank Account'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
