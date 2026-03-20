import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileText, TrendingDown, Calendar, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { useFY } from '@/contexts/FYContext';
import { taxApi } from '@/api/tax';
import { cn } from '@/lib/utils';

function ProgressBar({ value, max, color = 'bg-green-500', label }: { value: number; max: number; color?: string; label?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="space-y-1">
      {label && <div className="flex justify-between text-sm"><span>{label}</span><span className="text-muted-foreground">{pct.toFixed(0)}%</span></div>}
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const profileSchema = z.object({
  regime: z.enum(['OLD', 'NEW']).optional(),
  grossSalary: z.coerce.number().min(0).optional(),
  hraReceived: z.coerce.number().min(0).optional(),
  rentPaidMonthly: z.coerce.number().min(0).optional(),
  cityType: z.enum(['METRO', 'NON_METRO']).optional(),
  deduction80C: z.coerce.number().min(0).optional(),
  deduction80D: z.coerce.number().min(0).optional(),
  deduction80E: z.coerce.number().min(0).optional(),
  deduction80G: z.coerce.number().min(0).optional(),
  deduction24B: z.coerce.number().min(0).optional(),
  nps80Ccd1B: z.coerce.number().min(0).optional(),
  taxPaidAdvance: z.coerce.number().min(0).optional(),
  taxPaidTds: z.coerce.number().min(0).optional(),
  taxPaidSelfAssessment: z.coerce.number().min(0).optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

export default function TaxCentrePage() {
  const { selectedFY } = useFY();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'summary' | '80c' | 'advance' | 'hra'>('summary');
  const [hraParams, setHraParams] = useState({ basicSalary: '', hraReceived: '', rentPaid: '', city: 'METRO' });
  const [hraResult, setHraResult] = useState<{ exempt: number; taxable: number } | null>(null);
  const [hraError, setHraError] = useState<string | null>(null);

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['tax-summary', selectedFY],
    queryFn: () => taxApi.getSummary(selectedFY),
  });

  const { data: tracker80C } = useQuery({
    queryKey: ['tax-80c', selectedFY],
    queryFn: () => taxApi.get80CTracker(selectedFY),
  });

  const { data: advanceTax = [] } = useQuery({
    queryKey: ['advance-tax', selectedFY],
    queryFn: () => taxApi.getAdvanceTaxCalendar(selectedFY),
  });

  const { data: profile } = useQuery({
    queryKey: ['tax-profile', selectedFY],
    queryFn: () => taxApi.getProfile(selectedFY),
  });

  const { register, handleSubmit, watch, formState: { isDirty } } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: profile ?? {},
  });

  const selectedRegime = watch('regime') ?? profile?.regime ?? 'OLD';

  const saveMutation = useMutation({
    mutationFn: (data: ProfileForm) => taxApi.saveProfile(selectedFY, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tax-summary', selectedFY] });
      qc.invalidateQueries({ queryKey: ['tax-profile', selectedFY] });
    },
  });

  const calcHRA = async () => {
    if (!hraParams.basicSalary) return;
    setHraError(null);
    try {
      const result = await taxApi.calcHRA({
        basicSalary: Number(hraParams.basicSalary),
        hraReceived: Number(hraParams.hraReceived),
        rentPaid: Number(hraParams.rentPaid),
        city: hraParams.city,
      });
      setHraResult(result);
    } catch (err) {
      setHraError(err instanceof Error ? err.message : 'Calculation failed');
    }
  };

  const tabs = [
    { id: 'summary', label: 'Tax Summary' },
    { id: '80c', label: '80C Tracker' },
    { id: 'advance', label: 'Advance Tax' },
    { id: 'hra', label: 'HRA Calculator' },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tax Centre</h1>
        <p className="text-muted-foreground text-sm mt-1">FY {selectedFY} · Indian Tax Planning</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tax Summary Tab */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {/* Profile Form */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="font-semibold mb-4">Income & Tax Profile</h2>
            <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1 col-span-full md:col-span-1">
                  <Label>Tax Regime</Label>
                  <select {...register('regime')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="OLD">Old Regime — with deductions</option>
                    <option value="NEW">New Regime — lower slabs, fewer deductions</option>
                  </select>
                </div>
                {selectedRegime === 'NEW' && (
                  <div className="col-span-full rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
                    <strong>New Regime:</strong> Only ₹75,000 standard deduction applies. Deductions like 80C, 80D, HRA, Section 24(b), and NPS are <strong>not available</strong>.
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Gross Salary (₹)</Label>
                  <Input {...register('grossSalary')} type="number" placeholder="Annual CTC" />
                </div>
                {/* Old-regime-only deductions — hidden when NEW regime selected */}
                {selectedRegime !== 'NEW' && (
                  <>
                    <div className="space-y-1">
                      <Label>HRA Received (₹)</Label>
                      <Input {...register('hraReceived')} type="number" />
                    </div>
                    <div className="space-y-1">
                      <Label>Rent Paid / Month (₹)</Label>
                      <Input {...register('rentPaidMonthly')} type="number" />
                    </div>
                    <div className="space-y-1">
                      <Label>City Type</Label>
                      <select {...register('cityType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                        <option value="METRO">Metro (Mumbai/Delhi/Kolkata/Chennai)</option>
                        <option value="NON_METRO">Non-Metro</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label>80C — Investments &amp; Ins. (₹)</Label>
                      <Input {...register('deduction80C')} type="number" max={150000} placeholder="Max ₹1,50,000" />
                    </div>
                    <div className="space-y-1">
                      <Label>80D — Health Insurance (₹)</Label>
                      <Input {...register('deduction80D')} type="number" placeholder="Self + parents" />
                    </div>
                    <div className="space-y-1">
                      <Label>Sec 24(b) — Home Loan Int. (₹)</Label>
                      <Input {...register('deduction24B')} type="number" max={200000} placeholder="Max ₹2,00,000" />
                    </div>
                    <div className="space-y-1">
                      <Label>80E — Education Loan Int. (₹)</Label>
                      <Input {...register('deduction80E')} type="number" />
                    </div>
                    <div className="space-y-1">
                      <Label>80G — Donations (₹)</Label>
                      <Input {...register('deduction80G')} type="number" />
                    </div>
                    <div className="space-y-1">
                      <Label>80CCD(1B) — NPS Extra (₹)</Label>
                      <Input {...register('nps80Ccd1B')} type="number" max={50000} />
                    </div>
                  </>
                )}
                {/* Tax paid — applicable for both regimes */}
                <div className="space-y-1">
                  <Label>TDS Deducted (₹)</Label>
                  <Input {...register('taxPaidTds')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label>Advance Tax Paid (₹)</Label>
                  <Input {...register('taxPaidAdvance')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label>Self Assessment Tax Paid (₹)</Label>
                  <Input {...register('taxPaidSelfAssessment')} type="number" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Saving…' : 'Calculate & Save'}
                </Button>
              </div>
            </form>
          </div>

          {/* Old vs New Regime Comparison */}
          {summary && !loadingSummary && (
            <div className="grid md:grid-cols-2 gap-6">
              <div className={cn(
                'rounded-lg border p-6 space-y-4',
                summary.recommendedRegime === 'OLD' ? 'border-green-500 bg-green-50 dark:bg-green-950' : 'bg-card',
              )}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">Old Regime</h3>
                  {summary.recommendedRegime === 'OLD' && (
                    <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Recommended
                    </span>
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Gross Salary</span><INRDisplay amount={summary.grossSalary} /></div>
                  <div className="flex justify-between"><span>Standard Deduction</span><INRDisplay amount={summary.deductions.standardDeduction} className="text-green-600" /></div>
                  <div className="flex justify-between"><span>HRA Exempt</span><INRDisplay amount={summary.deductions.hraExempt} className="text-green-600" /></div>
                  <div className="flex justify-between"><span>80C</span><INRDisplay amount={summary.deductions.s80C} className="text-green-600" /></div>
                  <div className="flex justify-between"><span>80D</span><INRDisplay amount={summary.deductions.s80D} className="text-green-600" /></div>
                  <div className="flex justify-between"><span>Section 24(b)</span><INRDisplay amount={summary.deductions.section24B} className="text-green-600" /></div>
                  <div className="border-t pt-2 flex justify-between font-medium"><span>Taxable Income</span><INRDisplay amount={summary.oldRegime.taxableIncome} /></div>
                  <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Tax + Cess</span><INRDisplay amount={summary.oldRegime.tax} className="text-red-600" /></div>
                  {summary.oldRegime.refund > 0
                    ? <div className="flex justify-between text-green-600 font-medium"><span>Refund Due</span><INRDisplay amount={summary.oldRegime.refund} positive /></div>
                    : <div className="flex justify-between text-orange-600 font-medium"><span>Tax Due</span><INRDisplay amount={summary.oldRegime.taxAfterPaid} /></div>
                  }
                </div>
              </div>

              <div className={cn(
                'rounded-lg border p-6 space-y-4',
                summary.recommendedRegime === 'NEW' ? 'border-green-500 bg-green-50 dark:bg-green-950' : 'bg-card',
              )}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">New Regime</h3>
                  {summary.recommendedRegime === 'NEW' && (
                    <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Recommended
                    </span>
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Gross Salary</span><INRDisplay amount={summary.grossSalary} /></div>
                  <div className="flex justify-between"><span>Standard Deduction</span><INRDisplay amount={75000} className="text-green-600" /></div>
                  <p className="text-xs text-muted-foreground">Most deductions not available in new regime</p>
                  <div className="border-t pt-2 flex justify-between font-medium"><span>Taxable Income</span><INRDisplay amount={summary.newRegime.taxableIncome} /></div>
                  <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Tax + Cess</span><INRDisplay amount={summary.newRegime.tax} className="text-red-600" /></div>
                  {summary.newRegime.refund > 0
                    ? <div className="flex justify-between text-green-600 font-medium"><span>Refund Due</span><INRDisplay amount={summary.newRegime.refund} positive /></div>
                    : <div className="flex justify-between text-orange-600 font-medium"><span>Tax Due</span><INRDisplay amount={summary.newRegime.taxAfterPaid} /></div>
                  }
                </div>
              </div>

              <div className="md:col-span-2 rounded-lg border bg-card p-4 text-center">
                <p className="text-sm text-muted-foreground">You save</p>
                <INRDisplay amount={summary.savings} className="text-3xl font-bold text-green-600" />
                <p className="text-sm text-muted-foreground mt-1">by choosing the {summary.recommendedRegime === 'OLD' ? 'Old' : 'New'} Regime</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 80C Tracker Tab */}
      {activeTab === '80c' && tracker80C && (
        <div className="space-y-6">
          {selectedRegime === 'NEW' && (
            <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 p-4 text-sm text-amber-800 dark:text-amber-200">
              <strong>Not applicable in New Regime.</strong> Section 80C deductions are not available under the New Tax Regime.
              Switch to Old Regime in your tax profile to benefit from these deductions.
            </div>
          )}
          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">80C Deduction Tracker</h2>
              <div className="text-right">
                <INRDisplay amount={tracker80C.utilized} className="text-2xl font-bold" />
                <p className="text-xs text-muted-foreground">of ₹1,50,000 limit</p>
              </div>
            </div>
            <ProgressBar
              value={tracker80C.utilized}
              max={tracker80C.limit}
              color={tracker80C.pctUtilized >= 100 ? 'bg-green-500' : tracker80C.pctUtilized >= 75 ? 'bg-yellow-500' : 'bg-red-500'}
            />
            <p className="text-sm text-muted-foreground mt-2">
              {tracker80C.remaining > 0
                ? <><INRDisplay amount={tracker80C.remaining} className="text-orange-600 font-medium" /> still available — invest to save more tax!</>
                : <span className="text-green-600 font-medium">80C limit fully utilized ✓</span>
              }
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {Object.entries(tracker80C.breakdown).map(([key, amount]) => {
              const labels: Record<string, string> = {
                elss: 'ELSS Mutual Funds', ppf: 'PPF', nps: 'NPS (80C)',
                epf: 'EPF (Employee)', fdTaxSaver: '5-Year Tax Saver FD', licPremiums: 'LIC / Insurance Premiums', others: 'Others',
              };
              return (
                <div key={key} className="rounded-lg border bg-card p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium">{labels[key] ?? key}</span>
                    <INRDisplay amount={amount as number} className="font-semibold" />
                  </div>
                  <ProgressBar value={amount as number} max={150000} color="bg-blue-500" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Advance Tax Tab */}
      {activeTab === 'advance' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Advance tax installments for FY {selectedFY}. Pay on time to avoid interest under Sec 234B/234C.</p>
          <div className="grid md:grid-cols-2 gap-4">
            {advanceTax.map((event: any) => {
              const due = new Date(event.dueDate);
              const today = new Date();
              const isPast = due < today;
              const daysLeft = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              return (
                <div key={event.id} className={cn(
                  'rounded-lg border p-5 space-y-2',
                  isPast ? 'border-muted opacity-60' : daysLeft <= 30 ? 'border-orange-400 bg-orange-50 dark:bg-orange-950' : 'bg-card',
                )}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{event.description}</h3>
                    {isPast
                      ? <span className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Past</span>
                      : daysLeft <= 30
                        ? <span className="text-xs text-orange-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {daysLeft}d left</span>
                        : <span className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> {daysLeft}d</span>
                    }
                  </div>
                  <p className="text-2xl font-bold">{event.percentageDue}%</p>
                  <p className="text-sm text-muted-foreground">Due: {due.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                  {summary && (
                    <p className="text-sm">
                      Est. amount: <INRDisplay
                        amount={(summary.electedRegime === 'NEW' ? summary.newRegime.tax : summary.oldRegime.tax) * event.percentageDue / 100}
                        className="font-semibold"
                      />
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* HRA Calculator Tab */}
      {activeTab === 'hra' && (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="font-semibold">HRA Exemption Calculator</h2>
            <p className="text-sm text-muted-foreground">Minimum of: (a) Actual HRA received, (b) Rent paid − 10% of basic, (c) 50%/40% of basic (metro/non-metro)</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Basic Salary (₹ / year)</Label>
                <Input
                  type="number"
                  value={hraParams.basicSalary}
                  onChange={(e) => setHraParams((p) => ({ ...p, basicSalary: e.target.value }))}
                  placeholder="e.g., 600000"
                />
              </div>
              <div className="space-y-1">
                <Label>HRA Received (₹ / year)</Label>
                <Input
                  type="number"
                  value={hraParams.hraReceived}
                  onChange={(e) => setHraParams((p) => ({ ...p, hraReceived: e.target.value }))}
                  placeholder="e.g., 240000"
                />
              </div>
              <div className="space-y-1">
                <Label>Rent Paid (₹ / month)</Label>
                <Input
                  type="number"
                  value={hraParams.rentPaid}
                  onChange={(e) => setHraParams((p) => ({ ...p, rentPaid: e.target.value }))}
                  placeholder="e.g., 25000"
                />
              </div>
              <div className="space-y-1">
                <Label>City</Label>
                <select
                  value={hraParams.city}
                  onChange={(e) => setHraParams((p) => ({ ...p, city: e.target.value }))}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="METRO">Metro (Mumbai/Delhi/Kolkata/Chennai)</option>
                  <option value="NON_METRO">Non-Metro</option>
                </select>
              </div>
            </div>
            <Button onClick={calcHRA}>Calculate HRA Exemption</Button>

            {hraError && (
              <div className="rounded-lg bg-destructive/10 text-destructive p-3 text-sm">{hraError}</div>
            )}

            {hraResult && !hraError && (
              <div className="rounded-lg bg-green-50 dark:bg-green-950 p-4 space-y-2">
                <div className="flex justify-between font-semibold">
                  <span>HRA Exempt (tax-free)</span>
                  <INRDisplay amount={hraResult.exempt} className="text-green-600 text-xl" />
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Taxable HRA</span>
                  <INRDisplay amount={hraResult.taxable} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
