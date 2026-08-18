import { useState, useEffect, useId, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreditCard, Plus, Trash2, Edit2, Calculator, X } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { loansApi, type Loan, type AmortizationRow, type LoanPrepayment } from '@/api/loans';
import { assetsApi, ASSET_TYPES, type AssetType } from '@/api/assets';
import { investmentsApi } from '@/api/investments';
import { formatINRShort } from '@/lib/indianFormat';
import { formatDate, formatNextOccurrence, toDateInputValue, addMonths } from '@/lib/dateFormat';
import { CHART_PALETTE, AXIS_STYLE, GRID_STYLE, CustomTooltip } from '@/lib/chartUtils';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { formatAccountOption } from '@/lib/accountFormat';
import { toCategoryTreeOptions, getCategoryTreeOptionLabel } from '@/lib/categoryUtils';
import api from '@/lib/api';

const LOAN_TYPES: Record<string, string> = {
  HOME: 'Home Loan', AUTO: 'Car Loan', PERSONAL: 'Personal Loan',
  EDUCATION: 'Education Loan', GOLD: 'Gold Loan', LAP: 'Loan Against Property',
  BUSINESS: 'Business Loan', OTHER: 'Other',
};

/** Whole months between two dates — display-only rounding, not the financial math
 *  computeEmi/deriveEndDate own. "About 3 months early" tolerates a day of imprecision;
 *  what you actually owe never does. */
function monthsEarly(closedAt: string, endDate: string): number {
  const closed = new Date(closedAt);
  const end = new Date(endDate);
  let months = (end.getFullYear() - closed.getFullYear()) * 12 + (end.getMonth() - closed.getMonth());
  if (end.getDate() < closed.getDate()) months -= 1;
  return Math.max(months, 0);
}

/** The asset kind a secured loan is normally held against, used to pre-select the type
 *  when creating one inline. A guess, not a constraint — the user can change it. */
function defaultAssetTypeFor(loanType: string): AssetType {
  if (loanType === 'HOME' || loanType === 'LAP') return 'PROPERTY';
  if (loanType === 'AUTO') return 'VEHICLE';
  if (loanType === 'GOLD') return 'GOLD';
  return 'OTHER';
}

/** Secured against collateral — the backend rejects these (422) without an assetId. */
const SECURED_LOAN_TYPES = ['HOME', 'AUTO', 'LAP', 'GOLD'];
export const isSecuredLoanType = (t: string) => SECURED_LOAN_TYPES.includes(t);

const ownerSchema = z.object({
  userId: z.string().min(1, 'Owner required'),
  sharePercent: z.coerce.number().positive('Share must be greater than 0').max(100, 'Share cannot exceed 100'),
});

const ownersSchema = z.array(ownerSchema).min(1, 'Add at least one owner').superRefine((owners, ctx) => {
  const seen = new Set<string>();
  owners.forEach((owner, index) => {
    if (seen.has(owner.userId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Owner already added', path: [index, 'userId'] });
    }
    seen.add(owner.userId);
  });

  const total = owners.reduce((sum, owner) => sum + Number(owner.sharePercent || 0), 0);
  if (Math.abs(total - 100) > 0.01) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Owner shares must add up to 100%' });
  }
});

export const loanSchema = z.object({
  lenderName: z.string().min(1, 'Required'),
  loanAccountNumber: z.string().optional(),
  loanType: z.string(),
  principalAmount: z.coerce.number().positive(),
  outstandingBalance: z.coerce.number().min(0),
  interestRate: z.coerce.number().positive(),
  emiAmount: z.coerce.number().positive(),
  // Derived from firstEmiDate rather than typed. Still validated: it is what actually
  // gets stored as the recurring day-of-month.
  emiDate: z.coerce.number().int().min(1).max(28),
  tenureMonths: z.coerce.number().int().positive(),
  disbursementDate: z.string().min(1, 'Required'),
  endDate: z.string(),
  // Now a primary input. Every loan has a first EMI date, and making it explicit is what
  // lets the form derive emiDate, the end date and the pre-EMI amount.
  firstEmiDate: z.string().min(1, 'Required'),
  // NOT z.coerce.number(): that turns a cleared input's '' into 0, so editing a loan
  // with no pre-EMI wrote 0 over NULL and the dashboard then alerted "Pre-EMI ₹0 due".
  // Empty must stay empty.
  preEmiAmount: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().min(0).optional(),
  ),
  isTaxDeductible: z.boolean().default(false),
  section24bEligible: z.boolean().default(false),
  prepaymentChargesAmount: z.coerce.number().min(0).default(0),
  assetId: z.string().optional(),
  owners: ownersSchema,
}).superRefine((val, ctx) => {
  // emiDate is stored as a day-of-month capped at 28, because the 29th-31st do not exist
  // in every month. Since it is now derived from firstEmiDate, that cap has to be
  // explained at the field the user actually chose.
  if (val.firstEmiDate) {
    const day = new Date(val.firstEmiDate).getDate();
    if (day > 28) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['firstEmiDate'],
        message: `Pick a date on or before the 28th — not every month has a ${day}th, so the EMI could not recur.`,
      });
    }
  }
  // Mirrors the backend rule so the user sees it inline rather than as a 422.
  if (isSecuredLoanType(val.loanType) && !val.assetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetId'],
      message: `A ${LOAN_TYPES[val.loanType] ?? val.loanType} is secured — link the asset it is held against`,
    });
  }
});

type LoanForm = z.infer<typeof loanSchema>;

interface AmortData {
  schedule: AmortizationRow[];
  summary: { totalInterest: number; remainingMonths: number };
}

function AmortizationModal({ loan, amortData, prepayments, onClose }: { loan: Loan; amortData: AmortData; prepayments: LoanPrepayment[]; onClose: () => void }) {
  const uid = useId().replace(/:/g, '');
  const balanceGradId = `amort-balance-${uid}`;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const { schedule, summary } = amortData;
  const totalEmiCost = schedule.reduce((s, r) => s + r.emi, 0);

  // Yearly aggregates for stacked bar chart (max 30 bars for 30-year loan)
  const yearlyData = schedule.reduce<{ year: number; principal: number; interest: number }[]>((acc, row) => {
    const yr = Math.ceil(row.month / 12);
    const existing = acc.find((y) => y.year === yr);
    if (existing) {
      existing.principal += row.principal;
      existing.interest += row.interest;
    } else {
      acc.push({ year: yr, principal: row.principal, interest: row.interest });
    }
    return acc;
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{loan.lenderName} — Amortization Schedule</h2>
            <p className="text-sm text-muted-foreground">{LOAN_TYPES[loan.loanType] ?? loan.loanType} · {loan.interestRate}% p.a.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Interest Payable</p>
            <INRDisplay amount={summary.totalInterest} className="font-bold text-base text-red-500" />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">Months Remaining</p>
            <p className="font-bold text-base">{summary.remainingMonths}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">Total EMI Cost</p>
            <INRDisplay amount={totalEmiCost} className="font-bold text-base" />
          </div>
        </div>

        {/* Prepayment history — a table with rows and no reader is as broken as a
            feature nobody can use; this is the read half of "log a prepayment". */}
        {prepayments.length > 0 && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Prepayment History ({prepayments.length})
            </p>
            <div className="rounded-lg border divide-y">
              {prepayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{formatDate(p.date)}</p>
                    {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                  </div>
                  <div className="text-right">
                    <INRDisplay amount={p.amount} className="font-semibold" />
                    <p className="text-xs text-muted-foreground">
                      {p.reducedEmi != null
                        ? <>EMI reduced to <INRDisplay amount={p.reducedEmi} /></>
                        : p.tenureReduced != null
                        ? `${p.tenureReduced} month${p.tenureReduced === 1 ? '' : 's'} saved`
                        : null}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Balance decay */}
          <div className="min-w-0 overflow-hidden">
            <p className="text-sm font-medium text-muted-foreground mb-2">Outstanding Balance</p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={schedule} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={balanceGradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_PALETTE.net} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={CHART_PALETTE.net} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis
                  dataKey="date"
                  {...AXIS_STYLE}
                  tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
                  interval={Math.max(1, Math.floor(schedule.length / 6) - 1)}
                />
                <YAxis {...AXIS_STYLE} tickFormatter={formatINRShort} width={56} />
                <Tooltip content={<CustomTooltip formatter={(v) => formatINRShort(Number(v))} />} />
                <Area
                  type="monotone"
                  dataKey="closingBalance"
                  name="Balance"
                  stroke={CHART_PALETTE.net}
                  fill={`url(#${balanceGradId})`}
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Principal vs Interest yearly */}
          <div className="min-w-0 overflow-hidden">
            <p className="text-sm font-medium text-muted-foreground mb-2">Principal vs Interest (by year)</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={yearlyData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="year" {...AXIS_STYLE} tickFormatter={(y) => `Yr ${y}`} />
                <YAxis {...AXIS_STYLE} tickFormatter={formatINRShort} width={56} />
                <Tooltip content={<CustomTooltip formatter={(v) => formatINRShort(Number(v))} />} />
                <Bar dataKey="principal" name="Principal" stackId="a" fill={CHART_PALETTE.income} radius={[0, 0, 0, 0]} />
                <Bar dataKey="interest" name="Interest" stackId="a" fill={CHART_PALETTE.expense} radius={[2, 2, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Full table */}
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">Full Schedule ({schedule.length} months)</p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="text-muted-foreground border-b bg-muted/50">
                  <th className="text-left px-3 py-2">Month</th>
                  <th className="text-right px-3 py-2">EMI</th>
                  <th className="text-right px-3 py-2">Principal</th>
                  <th className="text-right px-3 py-2">Interest</th>
                  <th className="text-right px-3 py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr key={row.month} className="border-b border-muted last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-1.5">{new Date(row.date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}</td>
                    <td className="text-right px-3 py-1.5"><INRDisplay amount={row.emi} /></td>
                    <td className="text-right px-3 py-1.5 text-green-600"><INRDisplay amount={row.principal} /></td>
                    <td className="text-right px-3 py-1.5 text-red-500"><INRDisplay amount={row.interest} /></td>
                    <td className="text-right px-3 py-1.5"><INRDisplay amount={row.closingBalance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoanCard({ loan, onEdit, onDelete, readOnly = false }: { loan: Loan; onEdit: () => void; onDelete: () => void; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [prepayAmt, setPrepayAmt] = useState('');
  const [prepayMode, setPrepayMode] = useState<'reduce_tenure' | 'reduce_emi'>('reduce_tenure');
  const [prepayResult, setPrepayResult] = useState<any>(null);

  // Confirmation details, shown only once a simulation exists — recording without first
  // seeing the effect would ask for trust the simulator already earns for free.
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [recordDate, setRecordDate] = useState(toDateInputValue(new Date()));
  const [recordNotes, setRecordNotes] = useState('');
  const [recordBankAccountId, setRecordBankAccountId] = useState('');
  const [recordCategoryId, setRecordCategoryId] = useState('');

  const { data: amortData, isLoading: amortLoading } = useQuery({
    queryKey: ['loan-amort', loan.id],
    queryFn: () => loansApi.getAmortization(loan.id),
    enabled: showModal,
  });

  const { data: prepayments = [] } = useQuery({
    queryKey: ['loan-prepayments', loan.id],
    queryFn: () => loansApi.getPrepayments(loan.id),
    enabled: showModal,
  });

  // Fetched only once the record form is open — every other loan card on the page would
  // otherwise fire the same two requests for no reason.
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', loan.userId],
    queryFn: () => api.get<{ data: any[] }>('/accounts', { params: { userId: loan.userId } }).then((r) => r.data.data),
    enabled: showRecordForm,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api.get<{ data: any[] }>('/categories').then((r) => r.data.data),
    enabled: showRecordForm,
  });
  const categoryOptions = useMemo(() => toCategoryTreeOptions(categories), [categories]);

  const simulateMutation = useMutation({
    mutationFn: () => loansApi.simulatePrepayment(loan.id, { prepaymentAmount: Number(prepayAmt), mode: prepayMode }),
    onSuccess: (data) => { setPrepayResult(data); setShowRecordForm(false); },
  });

  const recordMutation = useMutation({
    mutationFn: () => loansApi.recordPrepayment(loan.id, {
      amount: Number(prepayAmt),
      date: recordDate,
      mode: prepayMode,
      notes: recordNotes || undefined,
      bankAccountId: recordBankAccountId || null,
      categoryId: recordCategoryId || null,
    }),
    onSuccess: () => {
      // The loan's own numbers (outstanding, EMI, endDate) changed, the amortization
      // schedule and prepayment history are now stale, and a real expense landed in the
      // ledger — each has its own cache key, so each needs its own invalidation.
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['loan-amort', loan.id] });
      qc.invalidateQueries({ queryKey: ['loan-prepayments', loan.id] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      setShowRecordForm(false);
      setPrepayResult(null);
      setPrepayAmt('');
      setRecordNotes('');
      setRecordBankAccountId('');
      setRecordCategoryId('');
      toast({ title: 'Prepayment recorded', variant: 'success' });
    },
    onError: (err: any) => {
      toast({ title: err?.response?.data?.message ?? 'Failed to record prepayment', variant: 'error' });
    },
  });

  const paidPct = loan.principalAmount > 0
    ? ((loan.principalAmount - loan.outstandingBalance) / loan.principalAmount) * 100
    : 0;

  // closedAt is set exactly once, by a prepayment reaching 0 — never by an ordinary
  // linked payment or a manual edit, so a loan that simply hasn't caught up to its
  // scheduled endDate yet is never mistaken for closed.
  const isClosed = Boolean(loan.closedAt);
  const early = isClosed && loan.closedAt ? monthsEarly(loan.closedAt, loan.endDate) : 0;

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
              {LOAN_TYPES[loan.loanType] ?? loan.loanType}
            </span>
            {loan.section24bEligible && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Sec 24(b)</span>
            )}
            {isClosed && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Closed{early > 0 ? ` · ${early} month${early === 1 ? '' : 's'} early` : ''}
              </span>
            )}
          </div>
          <h3 className="font-semibold mt-1">{loan.lenderName}</h3>
          {loan.loanAccountNumber && <p className="text-xs text-muted-foreground">Ac: ···{loan.loanAccountNumber.slice(-4)}</p>}
          {loan.userName && <p className="text-xs text-muted-foreground mt-0.5">{loan.userName}</p>}
        </div>
        {!readOnly && (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit loan"><Edit2 className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete loan"><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">Outstanding</p>
          <INRDisplay amount={loan.outstandingBalance} className="font-bold text-base" />
        </div>
        <div>
          <p className="text-muted-foreground">EMI</p>
          <p className="font-semibold"><INRDisplay amount={loan.emiAmount} /></p>
          {/* emiDate is a day-of-month Int, so the bare number made the reader do the
              arithmetic — and the hardcoded "th" rendered day 1 as "1th". Once closed
              there is no next payment — showing one anyway implies money still due. */}
          {!isClosed && (
            <p className="text-xs text-muted-foreground">Next: {formatNextOccurrence(loan.emiDate)}</p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground">Rate</p>
          <p className="font-semibold">{loan.interestRate}% p.a.</p>
        </div>
        <div>
          <p className="text-muted-foreground">End Date</p>
          <p className="font-semibold">{formatDate(loan.endDate)}</p>
        </div>
        {loan.preEmiAmount != null && loan.preEmiAmount > 0 && (
          <div>
            <p className="text-muted-foreground">Pre-EMI Interest</p>
            <INRDisplay amount={loan.preEmiAmount} className="font-semibold" />
          </div>
        )}
        {loan.asset && (
          <div>
            <p className="text-muted-foreground">Secured Against</p>
            <p className="font-semibold">{loan.asset.name}</p>
          </div>
        )}
      </div>

      {loan.owners && loan.owners.length > 0 && (
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground mb-1">Owners</p>
          <div className="flex flex-wrap gap-1.5">
            {loan.owners.map((owner) => (
              <span key={owner.userId} className="text-xs rounded-full border bg-background px-2 py-0.5">
                {owner.userName || 'Owner'} {owner.sharePercent}%
              </span>
            ))}
          </div>
          {loan.sharePercent != null && loan.sharePercent < 100 && (
            <p className="text-xs text-muted-foreground mt-1">
              This view counts {loan.sharePercent}% of this loan:
              {' '}
              <INRDisplay amount={loan.outstandingBalanceShare ?? 0} className="text-xs font-medium" />
            </p>
          )}
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Repaid {paidPct.toFixed(0)}%</span>
          <span><INRDisplay amount={loan.principalAmount - loan.outstandingBalance} /> of <INRDisplay amount={loan.principalAmount} /></span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
        </div>
      </div>

      {/* Prepayment Simulator — nothing left to prepay once closed. */}
      {!isClosed && (
      <div className="border-t pt-3 space-y-2">
        <p className="text-sm font-medium flex items-center gap-1"><Calculator className="h-4 w-4" /> Prepayment Simulator</p>
        <div className="flex gap-2">
          <Input
            placeholder="Prepay amount (₹)"
            value={prepayAmt}
            onChange={(e) => {
              // Editing after a simulation invalidates it — the confirm step below
              // would otherwise record whatever amount is currently typed while still
              // showing savings computed for a DIFFERENT amount. Force a fresh
              // simulation before recording can happen again.
              setPrepayAmt(e.target.value);
              setPrepayResult(null);
              setShowRecordForm(false);
            }}
            className="text-sm h-8"
          />
          <select
            value={prepayMode}
            onChange={(e) => {
              setPrepayMode(e.target.value as any);
              setPrepayResult(null);
              setShowRecordForm(false);
            }}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="reduce_tenure">Reduce Tenure</option>
            <option value="reduce_emi">Reduce EMI</option>
          </select>
          <Button size="sm" onClick={() => simulateMutation.mutate()} disabled={!prepayAmt || simulateMutation.isPending}>
            Simulate
          </Button>
        </div>
        {prepayResult && (
          <div className="rounded-md bg-green-50 dark:bg-green-950 p-3 text-sm space-y-2">
            <p className="font-medium text-green-700 dark:text-green-300">Savings with prepayment:</p>
            <p>Interest saved: <INRDisplay amount={prepayResult.savings.interestSaved} className="font-semibold" /></p>
            <p>Months saved: <span className="font-semibold">{prepayResult.savings.monthsSaved}</span></p>
            <p>New tenure: <span className="font-semibold">{prepayResult.after.months} months</span></p>
            {prepayResult.prepaymentCharges > 0 && (
              <p className="text-xs text-muted-foreground">
                This lender charges <INRDisplay amount={prepayResult.prepaymentCharges} /> to
                prepay — not included above; add it to the amount yourself if you are
                paying it as part of this payment.
              </p>
            )}

            {!showRecordForm ? (
              <Button size="sm" variant="outline" onClick={() => setShowRecordForm(true)}>
                Record this prepayment
              </Button>
            ) : (
              <div className="space-y-2 border-t pt-2">
                <p className="text-xs text-muted-foreground">
                  This is real — it will reduce the outstanding balance and add an expense
                  to the ledger.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`prepay-date-${loan.id}`} className="text-xs">Date</Label>
                    <Input
                      id={`prepay-date-${loan.id}`}
                      type="date"
                      value={recordDate}
                      onChange={(e) => setRecordDate(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`prepay-account-${loan.id}`} className="text-xs">Paid from</Label>
                    <select
                      id={`prepay-account-${loan.id}`}
                      value={recordBankAccountId}
                      onChange={(e) => setRecordBankAccountId(e.target.value)}
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm h-8"
                    >
                      <option value="">— Not set —</option>
                      {accounts.map((a: any) => (
                        <option key={a.id} value={a.id}>{formatAccountOption(a)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <Label htmlFor={`prepay-category-${loan.id}`} className="text-xs">Category</Label>
                  <select
                    id={`prepay-category-${loan.id}`}
                    value={recordCategoryId}
                    onChange={(e) => setRecordCategoryId(e.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm h-8"
                  >
                    <option value="">— Not set —</option>
                    {categoryOptions.map(({ category, depth }) => (
                      <option key={category.id} value={category.id}>
                        {getCategoryTreeOptionLabel(category, depth)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`prepay-notes-${loan.id}`} className="text-xs">Notes (optional)</Label>
                  <Input
                    id={`prepay-notes-${loan.id}`}
                    value={recordNotes}
                    onChange={(e) => setRecordNotes(e.target.value)}
                    placeholder="e.g. Annual bonus"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setShowRecordForm(false)}>Cancel</Button>
                  <Button size="sm" onClick={() => recordMutation.mutate()} disabled={recordMutation.isPending}>
                    {recordMutation.isPending ? 'Recording…' : 'Confirm'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-muted-foreground hover:text-foreground"
        onClick={() => setShowModal(true)}
      >
        View Full Schedule →
      </Button>

      {showModal && (
        amortLoading
          ? (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-background rounded-lg border p-8 text-sm text-muted-foreground">Loading schedule…</div>
            </div>
          )
          : amortData && (
            <AmortizationModal
              loan={loan}
              amortData={amortData}
              prepayments={prepayments}
              onClose={() => setShowModal(false)}
            />
          )
      )}
    </div>
  );
}

export default function LoansPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingFamilyWide = isAdmin && !viewUserId;

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ['loans', viewUserId],
    queryFn: () => loansApi.getAll(viewUserId),
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['assets', viewUserId],
    queryFn: () => assetsApi.getAll(viewUserId),
  });

  // Secured loans require an asset, and there is no Assets page yet — so without an
  // inline way to create one, a user with no matching asset simply cannot create the
  // loan. Defaults the new asset's type from the loan type, since that is almost always
  // what they want (a car loan is secured against a vehicle).
  const [showNewAsset, setShowNewAsset] = useState(false);
  const [newAsset, setNewAsset] = useState({ name: '', value: '', assetType: 'OTHER' as AssetType });
  /**
   * The detailed record this asset stands for, when one already exists.
   *
   * Without it the asset counts toward net worth in its own right — and if the same flat
   * or gold is also tracked as a property or a holding, it is counted twice. The link is
   * what tells net worth to defer to the detailed record.
   */
  const [newAssetLinkId, setNewAssetLinkId] = useState('');

  const { data: linkableProperties = [] } = useQuery({
    queryKey: ['real-estate', viewUserId],
    queryFn: () => investmentsApi.getRealEstate(viewUserId ? { targetUserId: viewUserId } : undefined)
      .then((r: any) => r.properties ?? []),
    enabled: showNewAsset && newAsset.assetType === 'PROPERTY',
  });

  const { data: linkableGold = [] } = useQuery({
    queryKey: ['gold', viewUserId],
    queryFn: () => investmentsApi.getGold(viewUserId ? { targetUserId: viewUserId } : undefined)
      .then((r) => r.holdings ?? []),
    enabled: showNewAsset && newAsset.assetType === 'GOLD',
  });

  const createAssetMutation = useMutation({
    mutationFn: () => assetsApi.create({
      assetType: newAsset.assetType,
      name: newAsset.name.trim(),
      value: Number(newAsset.value) || 0,
      // Only one of these can apply, and only for the matching type.
      ...(newAssetLinkId && newAsset.assetType === 'PROPERTY' ? { realEstateId: newAssetLinkId } : {}),
      ...(newAssetLinkId && newAsset.assetType === 'GOLD' ? { goldHoldingId: newAssetLinkId } : {}),
    }, viewUserId ? { targetUserId: viewUserId } : undefined),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      setValue('assetId', created.id, { shouldValidate: true });
      setShowNewAsset(false);
      setNewAsset({ name: '', value: '', assetType: 'OTHER' });
      setNewAssetLinkId('');
    },
  });

  // A <select> cannot display a value it has no <option> for. A MEMBER's `members` list
  // is always empty (useMemberSelector fetches /admin/users with `enabled: isAdmin`), so
  // when a co-owner opened a shared loan the other owners' rows collapsed to blank and
  // saving silently reassigned the loan. Merging the loan's existing owners in keeps
  // edit lossless regardless of who is looking.
  //
  // NOTE: a MEMBER still cannot ADD a co-owner they do not already share a loan with —
  // there is no non-admin member-listing endpoint. RealEstate.tsx:67 has the identical
  // limitation, so this is a pre-existing product-wide gap rather than something the
  // loans work introduced. Fixing it needs a new endpoint and is filed separately.
  const ownerOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    if (user) byId.set(user.id, { id: user.id, name: user.name });
    members.forEach((m) => byId.set(m.id, { id: m.id, name: m.name }));
    editing?.owners?.forEach((o) => {
      if (!byId.has(o.userId)) byId.set(o.userId, { id: o.userId, name: o.userName ?? 'Co-owner' });
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [members, user, editing]);

  // Same problem for collateral: assets are scoped to the requester, so a co-owner never
  // receives the primary owner's asset and the picker rendered "Not secured" — which the
  // secured-loan rule then rejected, making every co-owned HOME/AUTO/LAP/GOLD loan
  // uneditable by anyone but its primary owner.
  const assetOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; assetType: string }>();
    assets.forEach((a) => byId.set(a.id, { id: a.id, name: a.name, assetType: a.assetType }));
    if (editing?.asset && !byId.has(editing.asset.id)) {
      byId.set(editing.asset.id, {
        id: editing.asset.id, name: editing.asset.name, assetType: editing.asset.assetType,
      });
    }
    return Array.from(byId.values());
  }, [assets, editing]);
  const defaultOwnerId = () => viewUserId || user?.id || ownerOptions[0]?.id || '';

  const {
    register, handleSubmit, reset, setValue, control, watch, formState: { errors },
  } = useForm<LoanForm>({
    resolver: zodResolver(loanSchema),
    defaultValues: {
      loanType: 'HOME',
      isTaxDeductible: false,
      section24bEligible: false,
      prepaymentChargesAmount: 0,
      owners: [{ userId: '', sharePercent: 100 }],
    },
  });

  const ownerFields = useFieldArray({ control, name: 'owners' });
  const watchedOwners = watch('owners') ?? [];
  const ownerTotal = watchedOwners.reduce((sum, o) => sum + Number(o?.sharePercent || 0), 0);
  const watchedLoanType = watch('loanType');

  const getNextOwnerId = () =>
    ownerOptions.find((option) => !watchedOwners.some((o) => o?.userId === option.id))?.id ?? '';

  /**
   * Ask the backend to derive EMI, end date, pre-EMI and opening balance.
   *
   * CREATE MODE ONLY. Deliberately not gated on `dirtyFields`: startEdit uses
   * setValue() without { shouldDirty: true }, so dirtyFields is empty right after the
   * edit modal opens — a dirtyFields guard would let a principal edit silently
   * overwrite the real outstandingBalance and wipe years of repayment.
   */
  const autoFill = async () => {
    if (editing !== null) return;

    const principalAmount = Number(watch('principalAmount'));
    const interestRate = Number(watch('interestRate'));
    const tenureMonths = Number(watch('tenureMonths'));
    if (!(principalAmount > 0) || !(interestRate > 0) || !(tenureMonths > 0)) return;

    const disbursementDate = watch('disbursementDate');
    const firstEmiDate = watch('firstEmiDate');

    // emiDate is the recurring day-of-month, and the first EMI is by definition on that
    // day — so it is read off firstEmiDate rather than asked for a second time. Days past
    // the 28th are rejected by the schema, so nothing is clamped or silently changed here.
    if (firstEmiDate) {
      const day = new Date(firstEmiDate).getDate();
      if (day >= 1 && day <= 28) {
        setValue('emiDate', day, { shouldValidate: true });
      } else {
        // Past the 28th this value is never saved — the schema's superRefine blocks the
        // submit and explains why on the First EMI Date field. It still has to be a legal
        // number, because zod skips refinements when the BASE parse fails: leaving emiDate
        // unset would fail .max(28) first and swallow the explanation entirely.
        setValue('emiDate', 28, { shouldValidate: false });
      }
    }

    try {
      const derived = await loansApi.derive({
        principalAmount,
        interestRate,
        tenureMonths,
        ...(disbursementDate ? { disbursementDate } : {}),
        ...(firstEmiDate ? { firstEmiDate } : {}),
      });
      // Suggestions only — every field stays editable. A lender's real EMI rarely
      // matches the textbook figure to the paisa.
      if (derived.emiAmount != null) setValue('emiAmount', derived.emiAmount);
      if (derived.outstandingBalance != null) setValue('outstandingBalance', derived.outstandingBalance);
      if (derived.endDate) setValue('endDate', derived.endDate.slice(0, 10));
      if (derived.preEmiAmount != null) setValue('preEmiAmount', derived.preEmiAmount);
    } catch {
      // A derive failure must never block manual entry; the toast already reports it.
    }
  };

  /**
   * A cleared <input> serializes as `""`, not as an absent key. Sent verbatim, the
   * backend turned `firstEmiDate: ""` into an Invalid Date and `assetId: ""` into an FK
   * matching no row — both surfacing as a bare HTTP 500 that made every pre-existing
   * loan uneditable. The API boundary now normalizes these too; stripping them here as
   * well keeps the wire payload honest about what the user actually left blank.
   */
  const stripBlanks = (data: LoanForm): LoanForm => {
    const out: Record<string, unknown> = { ...data };
    for (const key of ['firstEmiDate', 'assetId', 'bankAccountId', 'loanAccountNumber'] as const) {
      if (out[key] === '') out[key] = null;
    }
    if (out.preEmiAmount === '' || Number.isNaN(out.preEmiAmount)) out.preEmiAmount = null;
    return out as LoanForm;
  };

  const createMutation = useMutation({
    mutationFn: (data: LoanForm) => loansApi.create(stripBlanks(data), viewUserId ? { targetUserId: viewUserId } : undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); setShowForm(false); reset(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: LoanForm }) => loansApi.update(id, stripBlanks(data)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); setEditing(null); setShowForm(false); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: loansApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loans'] }),
  });

  function startEdit(loan: Loan) {
    setEditing(loan);
    // Explicit reset, not Object.entries(loan).forEach(setValue): `owners` is an array
    // and `asset` an object, and pushing those through form fields corrupts the form.
    // RealEstate handles owners the same way.
    reset({
      lenderName: loan.lenderName,
      loanAccountNumber: loan.loanAccountNumber ?? '',
      loanType: loan.loanType,
      principalAmount: loan.principalAmount,
      outstandingBalance: loan.outstandingBalance,
      interestRate: loan.interestRate,
      emiAmount: loan.emiAmount,
      emiDate: loan.emiDate,
      tenureMonths: loan.tenureMonths,
      disbursementDate: loan.disbursementDate.slice(0, 10),
      endDate: loan.endDate.slice(0, 10),
      // Every loan predating the firstEmiDate column has NULL here, and the field is now
      // required — so editing an old loan would be blocked by a field the user never had
      // the chance to set. A null firstEmiDate already MEANS "one month after
      // disbursement": that is exactly the branch deriveEndDate takes when it is absent.
      // Filling it in makes the implicit value explicit and visible, rather than
      // demanding the user reconstruct it.
      firstEmiDate: loan.firstEmiDate
        ? loan.firstEmiDate.slice(0, 10)
        : toDateInputValue(addMonths(loan.disbursementDate, 1)),
      preEmiAmount: loan.preEmiAmount ?? undefined,
      isTaxDeductible: loan.isTaxDeductible,
      section24bEligible: loan.section24bEligible,
      prepaymentChargesAmount: loan.prepaymentChargesAmount ?? 0,
      assetId: loan.assetId ?? '',
      owners: loan.owners?.length
        ? loan.owners.map((o) => ({ userId: o.userId, sharePercent: Number(o.sharePercent) }))
        : [{ userId: defaultOwnerId(), sharePercent: 100 }],
    } as LoanForm);
    setShowForm(true);
  }

  function startCreate() {
    setEditing(null);
    reset({
      loanType: 'HOME',
      isTaxDeductible: false,
      section24bEligible: false,
      prepaymentChargesAmount: 0,
      owners: [{ userId: defaultOwnerId(), sharePercent: 100 }],
    } as LoanForm);
    setShowForm(true);
  }

  // Share-weighted, matching the dashboard. Falls back to the full figure for loans
  // with no owner rows (pre-multi-owner records).
  const totalEMI = loans.reduce((s, l) => s + (l.emiAmountShare ?? l.emiAmount), 0);
  const totalOutstanding = loans.reduce((s, l) => s + (l.outstandingBalanceShare ?? l.outstandingBalance), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Loans & EMIs</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {loans.length} active loans · Total EMI <INRDisplay amount={totalEMI} /> /month
            {isAdmin && viewUserId
              ? ` · ${members.find((m) => m.id === viewUserId)?.name ?? 'Member'}`
              : isAdmin ? ' · All Family' : ''}
          </p>
          {isAdmin && !isMembersLoading && (
            <div className="flex items-center gap-2 mt-2">
              <label htmlFor="loans-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
              {isMembersError ? (
                <span className="text-xs text-destructive">Could not load members</span>
              ) : (
                <select
                  id="loans-member-select"
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
        {!isViewingFamilyWide && (
          <Button onClick={startCreate}>
            <Plus className="h-4 w-4 mr-2" /> Add Loan
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Outstanding</p>
          <INRDisplay amount={totalOutstanding} short className="text-2xl font-bold text-red-600" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Monthly EMI Burden</p>
          <INRDisplay amount={totalEMI} className="text-2xl font-bold" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Sec 24(b) Home Loans</p>
          <INRDisplay
            amount={loans.filter((l) => l.section24bEligible)
              .reduce((s, l) => s + (l.outstandingBalanceShare ?? l.outstandingBalance), 0)}
            short className="text-2xl font-bold text-green-600"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading loans…</div>
      ) : loans.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="font-medium">No loans added yet</p>
          <p className="text-sm text-muted-foreground mt-1">Track EMIs, amortization schedules, and prepayment savings</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {loans.map((loan) => (
            <LoanCard
              key={loan.id}
              loan={loan}
              onEdit={() => startEdit(loan)}
              onDelete={() => deleteMutation.mutate(loan.id)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">{editing ? 'Edit Loan' : 'Add Loan'}</h2>
            <form onSubmit={handleSubmit((data) => editing ? updateMutation.mutate({ id: editing.id, data }) : createMutation.mutate(data))} className="space-y-4">
              <div className="pt-2">
                <p className="text-sm font-semibold">Loan basics</p>
                <p className="text-xs text-muted-foreground mb-3">Who the loan is with, and what secures it.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label required htmlFor="loan-loanType">Loan Type</Label>
                    <select {...register('loanType')} id="loan-loanType" className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                      {Object.entries(LOAN_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label required htmlFor="loan-lenderName">Lender Name</Label>
                    <Input {...register('lenderName')} id="loan-lenderName" placeholder="HDFC Bank, SBI…" />
                    {errors.lenderName && <p className="text-xs text-destructive">{errors.lenderName.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label required={isSecuredLoanType(watchedLoanType)} htmlFor="loan-assetId">Secured Against</Label>
                    <select {...register('assetId')} id="loan-assetId" className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                      <option value="">
                        {isSecuredLoanType(watchedLoanType) ? 'Select an asset…' : 'Not secured'}
                      </option>
                      {assetOptions.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({ASSET_TYPES[a.assetType as AssetType] ?? a.assetType})</option>
                      ))}
                    </select>
                    {errors.assetId && <p className="text-xs text-destructive">{errors.assetId.message}</p>}

                    {!showNewAsset && (
                      <button
                        type="button"
                        className="text-xs text-primary underline"
                        onClick={() => {
                          setNewAsset((prev) => ({ ...prev, assetType: defaultAssetTypeFor(watchedLoanType) }));
                          setShowNewAsset(true);
                        }}
                      >
                        + Add a new asset
                      </button>
                    )}

                    {showNewAsset && (
                      <div className="rounded-md border p-3 space-y-2">
                        <div className="space-y-1">
                          <Label htmlFor="new-asset-name" required>Asset name</Label>
                          <Input
                            id="new-asset-name"
                            value={newAsset.name}
                            placeholder="Honda City, Flat 3B…"
                            onChange={(e) => setNewAsset((p) => ({ ...p, name: e.target.value }))}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label htmlFor="new-asset-type">Type</Label>
                            <select
                              id="new-asset-type"
                              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                              value={newAsset.assetType}
                              onChange={(e) => setNewAsset((p) => ({ ...p, assetType: e.target.value as AssetType }))}
                            >
                              {Object.entries(ASSET_TYPES).map(([k, label]) => (
                                <option key={k} value={k}>{label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="new-asset-value">Current value (₹)</Label>
                            <Input
                              id="new-asset-value"
                              type="number"
                              value={newAsset.value}
                              onChange={(e) => setNewAsset((p) => ({ ...p, value: e.target.value }))}
                            />
                          </div>
                        </div>

                        {/* Without this link the asset counts toward net worth in its own
                            right. If the same flat or gold is also tracked as a property or
                            a holding, it is then counted twice — so say which record this
                            stands for, or say it is new. */}
                        {(newAsset.assetType === 'PROPERTY' || newAsset.assetType === 'GOLD') && (
                          <div className="space-y-1">
                            <Label htmlFor="new-asset-link">
                              {newAsset.assetType === 'PROPERTY' ? 'Already tracked as a property?' : 'Already tracked as a gold holding?'}
                            </Label>
                            <select
                              id="new-asset-link"
                              value={newAssetLinkId}
                              onChange={(e) => setNewAssetLinkId(e.target.value)}
                              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                            >
                              <option value="">No — count it separately</option>
                              {newAsset.assetType === 'PROPERTY'
                                ? linkableProperties.map((prop: { id: string; propertyName: string }) => (
                                  <option key={prop.id} value={prop.id}>{prop.propertyName}</option>
                                ))
                                : linkableGold.map((g: { id: string; description?: string; quantityGrams: number }) => (
                                  <option key={g.id} value={g.id}>
                                    {g.description || 'Gold'} — {g.quantityGrams}g
                                  </option>
                                ))}
                            </select>
                            <p className="text-xs text-muted-foreground">
                              Linking it avoids counting the same thing twice in net worth.
                            </p>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={!newAsset.name.trim() || createAssetMutation.isPending}
                            onClick={() => createAssetMutation.mutate()}
                          >
                            {createAssetMutation.isPending ? 'Saving…' : 'Save asset'}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setShowNewAsset(false)}>
                            Cancel
                          </Button>
                        </div>
                        {createAssetMutation.isError && (
                          <p className="text-xs text-destructive">Could not save the asset. Please try again.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <p className="text-sm font-semibold">Loan terms</p>
                <p className="text-xs text-muted-foreground mb-3">These five drive everything below — fill them in and the rest is worked out for you.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label required htmlFor="loan-principalAmount">Principal Amount (₹)</Label>
                    <Input {...register('principalAmount', { onBlur: autoFill })} id="loan-principalAmount" type="number" />
                  </div>
                  <div className="space-y-1">
                    <Label required htmlFor="loan-interestRate">Interest Rate (% p.a.)</Label>
                    <Input {...register('interestRate', { onBlur: autoFill })} id="loan-interestRate" type="number" step="0.01" />
                  </div>
                  <div className="space-y-1">
                    <Label required htmlFor="loan-tenureMonths">Tenure (months)</Label>
                    <Input {...register('tenureMonths', { onBlur: autoFill })} id="loan-tenureMonths" type="number" />
                  </div>
                  <div className="space-y-1">
                    <Label required htmlFor="loan-disbursementDate">Disbursement Date</Label>
                    <Input {...register('disbursementDate', { onBlur: autoFill })} id="loan-disbursementDate" type="date" />
                  </div>
                    <div className="space-y-1">
                      <Label required htmlFor="loan-firstEmiDate">First EMI Date</Label>
                      <Input {...register('firstEmiDate', { onBlur: autoFill })} id="loan-firstEmiDate" type="date" />
                      {/* Without this the 1-28 rule rejects the form with nothing on screen
                          explaining why — the user would just find Save doing nothing. */}
                      {errors.firstEmiDate && <p className="text-xs text-destructive">{errors.firstEmiDate.message}</p>}
                      <p className="text-xs text-muted-foreground">Sets the day EMIs recur on. The gap from disbursement is the pre-EMI period.</p>
                    </div>
                </div>
              </div>

              <div className="pt-2">
                <p className="text-sm font-semibold">Calculated</p>
                <p className="text-xs text-muted-foreground mb-3">Worked out from the terms above. Adjust any of them if your lender's figures differ — a real EMI is often a rupee or two off the textbook amount, and the outstanding balance will be lower than the principal on a loan you have already been paying.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label required htmlFor="loan-emiAmount">EMI Amount (₹)</Label>
                    <Input {...register('emiAmount')} id="loan-emiAmount" type="number" />
                  </div>
                  <div className="space-y-1">
                    <Label required htmlFor="loan-emiDate">EMI Date (1-28)</Label>
                    <Input {...register('emiDate')} id="loan-emiDate" type="number" min="1" max="28" />
                  </div>
                  <div className="space-y-1">
                    <Label required htmlFor="loan-endDate">End Date</Label>
                    <Input {...register('endDate')} id="loan-endDate" type="date" />
                  </div>
                  <div className="space-y-1">
                    <Label required htmlFor="loan-outstandingBalance">Outstanding Balance (₹)</Label>
                    <Input {...register('outstandingBalance')} id="loan-outstandingBalance" type="number" />
                    {!editing && (
                      <p className="text-xs text-muted-foreground">Defaults to the principal — edit if the loan is already part-repaid.</p>
                    )}
                  </div>
                    <div className="space-y-1">
                      <Label htmlFor="loan-preEmiAmount">Pre-EMI Amount (₹, optional)</Label>
                      <Input {...register('preEmiAmount')} id="loan-preEmiAmount" type="number" step="0.01" />
                      <p className="text-xs text-muted-foreground">Interest accruing between disbursement and the first EMI.</p>
                    </div>
                </div>
              </div>

              <div className="pt-2">
                <p className="text-sm font-semibold">Optional details</p>
                <div className="mb-3" />
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="loan-loanAccountNumber">Loan Account Number (optional)</Label>
                      <Input {...register('loanAccountNumber')} id="loan-loanAccountNumber" placeholder="Optional" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="loan-prepaymentChargesAmount">Prepayment Charges (₹, optional)</Label>
                      <Input {...register('prepaymentChargesAmount')} id="loan-prepaymentChargesAmount" type="number" step="0.01" />
                      <p className="text-xs text-muted-foreground">A flat fee, not a percentage.</p>
                    </div>
                </div>
              </div>


              {/* Owners — mirrors the RealEstate co-ownership editor. */}
              <div className="space-y-2 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label required>Owners</Label>
                  <span className={`text-xs ${Math.abs(ownerTotal - 100) <= 0.01 ? 'text-muted-foreground' : 'text-destructive'}`}>
                    Total {ownerTotal || 0}%
                  </span>
                </div>
                <div className="space-y-2">
                  {ownerFields.fields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-[1fr_120px_32px] gap-2 items-start">
                      <div>
                        <select
                          {...register(`owners.${index}.userId`)}
                          aria-label={`Owner ${index + 1}`}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          <option value="">Select owner</option>
                          {ownerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        {errors.owners?.[index]?.userId && (
                          <p className="text-xs text-destructive mt-1">{errors.owners[index]?.userId?.message}</p>
                        )}
                      </div>
                      <div>
                        <Input
                          {...register(`owners.${index}.sharePercent`)}
                          aria-label={`Share ${index + 1}`}
                          type="number" min="0" max="100" step="0.01" placeholder="%"
                        />
                        {errors.owners?.[index]?.sharePercent && (
                          <p className="text-xs text-destructive mt-1">{errors.owners[index]?.sharePercent?.message}</p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={ownerFields.fields.length === 1}
                        onClick={() => ownerFields.remove(index)}
                        title="Remove owner"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                {errors.owners?.message && <p className="text-xs text-destructive">{errors.owners.message}</p>}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => ownerFields.append({ userId: getNextOwnerId(), sharePercent: 0 })}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Owner
                </Button>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register('isTaxDeductible')} className="rounded" />
                  <span className="text-sm">Tax Deductible</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register('section24bEligible')} className="rounded" />
                  <span className="text-sm">Section 24(b) — Home Loan Interest</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editing ? 'Update' : 'Add'} Loan
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
