import { useState, useEffect, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreditCard, Plus, Trash2, Edit2, Calculator, X } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { loansApi, type Loan, type AmortizationRow } from '@/api/loans';
import { formatINRShort } from '@/lib/indianFormat';
import { CHART_PALETTE, AXIS_STYLE, GRID_STYLE, CustomTooltip } from '@/lib/chartUtils';
import { useMemberSelector } from '@/hooks/useMemberSelector';

const LOAN_TYPES: Record<string, string> = {
  HOME: 'Home Loan', AUTO: 'Car Loan', PERSONAL: 'Personal Loan',
  EDUCATION: 'Education Loan', GOLD: 'Gold Loan', LAP: 'Loan Against Property',
  BUSINESS: 'Business Loan', OTHER: 'Other',
};

const loanSchema = z.object({
  lenderName: z.string().min(1, 'Required'),
  loanAccountNumber: z.string().optional(),
  loanType: z.string(),
  principalAmount: z.coerce.number().positive(),
  outstandingBalance: z.coerce.number().min(0),
  interestRate: z.coerce.number().positive(),
  emiAmount: z.coerce.number().positive(),
  emiDate: z.coerce.number().int().min(1).max(28),
  tenureMonths: z.coerce.number().int().positive(),
  disbursementDate: z.string(),
  endDate: z.string(),
  isTaxDeductible: z.boolean().default(false),
  section24bEligible: z.boolean().default(false),
  prepaymentChargesPct: z.coerce.number().min(0).default(0),
});

type LoanForm = z.infer<typeof loanSchema>;

interface AmortData {
  schedule: AmortizationRow[];
  summary: { totalInterest: number; remainingMonths: number };
}

function AmortizationModal({ loan, amortData, onClose }: { loan: Loan; amortData: AmortData; onClose: () => void }) {
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

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Balance decay */}
          <div>
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
          <div>
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
  const [showModal, setShowModal] = useState(false);
  const [prepayAmt, setPrepayAmt] = useState('');
  const [prepayMode, setPrepayMode] = useState<'reduce_tenure' | 'reduce_emi'>('reduce_tenure');
  const [prepayResult, setPrepayResult] = useState<any>(null);

  const { data: amortData, isLoading: amortLoading } = useQuery({
    queryKey: ['loan-amort', loan.id],
    queryFn: () => loansApi.getAmortization(loan.id),
    enabled: showModal,
  });

  const simulateMutation = useMutation({
    mutationFn: () => loansApi.simulatePrepayment(loan.id, { prepaymentAmount: Number(prepayAmt), mode: prepayMode }),
    onSuccess: (data) => setPrepayResult(data),
  });

  const paidPct = loan.principalAmount > 0
    ? ((loan.principalAmount - loan.outstandingBalance) / loan.principalAmount) * 100
    : 0;

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
          </div>
          <h3 className="font-semibold mt-1">{loan.lenderName}</h3>
          {loan.loanAccountNumber && <p className="text-xs text-muted-foreground">Ac: ···{loan.loanAccountNumber.slice(-4)}</p>}
        </div>
        {!readOnly && (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit}><Edit2 className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
          <p className="font-semibold"><INRDisplay amount={loan.emiAmount} /> on {loan.emiDate}th</p>
        </div>
        <div>
          <p className="text-muted-foreground">Rate</p>
          <p className="font-semibold">{loan.interestRate}% p.a.</p>
        </div>
        <div>
          <p className="text-muted-foreground">End Date</p>
          <p className="font-semibold">{new Date(loan.endDate).toLocaleDateString('en-IN')}</p>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Repaid {paidPct.toFixed(0)}%</span>
          <span><INRDisplay amount={loan.principalAmount - loan.outstandingBalance} /> of <INRDisplay amount={loan.principalAmount} /></span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
        </div>
      </div>

      {/* Prepayment Simulator */}
      <div className="border-t pt-3 space-y-2">
        <p className="text-sm font-medium flex items-center gap-1"><Calculator className="h-4 w-4" /> Prepayment Simulator</p>
        <div className="flex gap-2">
          <Input
            placeholder="Prepay amount (₹)"
            value={prepayAmt}
            onChange={(e) => setPrepayAmt(e.target.value)}
            className="text-sm h-8"
          />
          <select
            value={prepayMode}
            onChange={(e) => setPrepayMode(e.target.value as any)}
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
          <div className="rounded-md bg-green-50 dark:bg-green-950 p-3 text-sm space-y-1">
            <p className="font-medium text-green-700 dark:text-green-300">Savings with prepayment:</p>
            <p>Interest saved: <INRDisplay amount={prepayResult.savings.interestSaved} className="font-semibold" /></p>
            <p>Months saved: <span className="font-semibold">{prepayResult.savings.monthsSaved}</span></p>
            <p>New tenure: <span className="font-semibold">{prepayResult.after.months} months</span></p>
          </div>
        )}
      </div>

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
              onClose={() => setShowModal(false)}
            />
          )
      )}
    </div>
  );
}

export default function LoansPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingOtherMember = isAdmin && viewUserId !== undefined;

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ['loans', viewUserId],
    queryFn: () => loansApi.getAll(viewUserId),
  });

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<LoanForm>({
    resolver: zodResolver(loanSchema),
    defaultValues: { loanType: 'HOME', isTaxDeductible: false, section24bEligible: false, prepaymentChargesPct: 0 },
  });

  const createMutation = useMutation({
    mutationFn: (data: LoanForm) => loansApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); setShowForm(false); reset(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: LoanForm }) => loansApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); setEditing(null); setShowForm(false); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: loansApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loans'] }),
  });

  function startEdit(loan: Loan) {
    setEditing(loan);
    Object.entries(loan).forEach(([k, v]) => setValue(k as any, v ?? ''));
    setValue('disbursementDate', loan.disbursementDate.slice(0, 10));
    setValue('endDate', loan.endDate.slice(0, 10));
    setShowForm(true);
  }

  const totalEMI = loans.reduce((s, l) => s + l.emiAmount, 0);
  const totalOutstanding = loans.reduce((s, l) => s + l.outstandingBalance, 0);

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
        {!isViewingOtherMember && (
          <Button onClick={() => { setEditing(null); reset(); setShowForm(true); }}>
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
            amount={loans.filter((l) => l.section24bEligible).reduce((s, l) => s + l.outstandingBalance, 0)}
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
              readOnly={isViewingOtherMember}
            />
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">{editing ? 'Edit Loan' : 'Add Loan'}</h2>
            <form onSubmit={handleSubmit((data) => editing ? updateMutation.mutate({ id: editing.id, data }) : createMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Loan Type</Label>
                  <select {...register('loanType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(LOAN_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Lender Name</Label>
                  <Input {...register('lenderName')} placeholder="HDFC Bank, SBI…" />
                  {errors.lenderName && <p className="text-xs text-destructive">{errors.lenderName.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Loan Account Number</Label>
                  <Input {...register('loanAccountNumber')} placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <Label>Principal Amount (₹)</Label>
                  <Input {...register('principalAmount')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label>Outstanding Balance (₹)</Label>
                  <Input {...register('outstandingBalance')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label>Interest Rate (% p.a.)</Label>
                  <Input {...register('interestRate')} type="number" step="0.01" />
                </div>
                <div className="space-y-1">
                  <Label>EMI Amount (₹)</Label>
                  <Input {...register('emiAmount')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label>EMI Date (1-28)</Label>
                  <Input {...register('emiDate')} type="number" min="1" max="28" />
                </div>
                <div className="space-y-1">
                  <Label>Tenure (months)</Label>
                  <Input {...register('tenureMonths')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label>Disbursement Date</Label>
                  <Input {...register('disbursementDate')} type="date" />
                </div>
                <div className="space-y-1">
                  <Label>End Date</Label>
                  <Input {...register('endDate')} type="date" />
                </div>
                <div className="space-y-1">
                  <Label>Prepayment Charges (%)</Label>
                  <Input {...register('prepaymentChargesPct')} type="number" step="0.01" />
                </div>
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
