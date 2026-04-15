import { CheckCircle, AlertCircle, TrendingDown, TrendingUp } from 'lucide-react';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { cn } from '@/lib/utils';

interface InsightsTabProps {
  summary: any;
  tracker80C: any;
  profile: any;
}

/**
 * Old Regime marginal tax rate based on taxable income slabs (FY25-26):
 *   > ₹10L  → 30%
 *   5L–10L  → 20%
 *   2.5L–5L → 5%
 *   ≤ 2.5L  → 0%
 * Returns rate as a percentage integer (e.g., 30).
 */
function getOldRegimeMarginalRate(taxableIncome: number): number {
  if (taxableIncome > 1_000_000) return 30;
  if (taxableIncome > 500_000) return 20;
  if (taxableIncome > 250_000) return 5;
  return 0;
}

/** Tax saved = headroom × marginalRate/100 × 1.04 (4% cess), rounded to nearest rupee. */
function taxSaved(headroom: number, marginalRate: number): number {
  return Math.round(headroom * (marginalRate / 100) * 1.04);
}

export default function InsightsTab({ summary, tracker80C, profile }: InsightsTabProps) {
  if (!summary || !tracker80C || !profile) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading insights…</p>;
  }

  const isOldRegime = summary.electedRegime === 'OLD';
  const isOptimal = summary.electedRegime === summary.recommendedRegime;
  const regimeSavings = Math.abs(summary.oldRegime.tax - summary.newRegime.tax);
  const betterRegime = summary.recommendedRegime === 'OLD' ? 'Old' : 'New';
  const marginalRate = getOldRegimeMarginalRate(summary.oldRegime.taxableIncome);

  // --- Deduction headroom rows (Old Regime only) ---
  const rebateApplied = summary.oldRegime.tax === 0 && summary.grossSalary > 0;
  const s80CRemaining = tracker80C.remaining;
  // Use the backend-computed 80D value (from insurance records) rather than the manual profile field
  const s80DUsed = Number(summary.deductions?.s80D ?? 0);
  const s80DLimit = 50_000; // ₹25K self + ₹25K parents (backend enforced cap)
  const s80DRemaining = Math.max(s80DLimit - s80DUsed, 0);
  const npsUsed = Number(profile.nps80Ccd1B ?? 0);
  const npsLimit = 50_000;
  const npsRemaining = Math.max(npsLimit - npsUsed, 0);

  type DeductionRow = {
    label: string;
    used: number;
    limit: number;
    remaining: number;
    savings: number;
    note?: string;
    action: string;
  };

  const deductionRows: DeductionRow[] = [
    {
      label: '80C — Investments & Insurance',
      used: tracker80C.utilized,
      limit: tracker80C.limit,
      remaining: s80CRemaining,
      savings: taxSaved(s80CRemaining, marginalRate),
      action: `Invest ₹${s80CRemaining.toLocaleString('en-IN')} more in ELSS/PPF/NPS before 31 March`,
    },
    {
      label: '80D — Health Insurance',
      used: s80DUsed,
      limit: s80DLimit,
      remaining: s80DRemaining,
      savings: taxSaved(s80DRemaining, marginalRate),
      note: '₹25K self + ₹25K parents (higher limits for senior parents apply at ITR filing)',
      action: `Pay health insurance premium of ₹${s80DRemaining.toLocaleString('en-IN')} to fill 80D headroom`,
    },
    {
      label: '80CCD(1B) — NPS Extra',
      used: npsUsed,
      limit: npsLimit,
      remaining: npsRemaining,
      savings: taxSaved(npsRemaining, marginalRate),
      note: 'Additional deduction over and above 80C limit',
      action: `Top-up NPS Tier-I with ₹${npsRemaining.toLocaleString('en-IN')} under 80CCD(1B)`,
    },
  ].filter((r) => r.remaining > 0);

  const totalPotentialSavings = deductionRows.reduce((s, r) => s + r.savings, 0);

  return (
    <div className="space-y-6">

      {/* Section A: Regime Optimizer */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold text-lg">Regime Optimizer</h2>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div className={cn(
            'rounded-lg border p-4 space-y-1',
            summary.electedRegime === 'OLD' ? 'border-primary bg-primary/5' : 'bg-muted/30',
          )}>
            <p className="font-medium">Old Regime</p>
            <p className="text-muted-foreground">Tax + Cess</p>
            <INRDisplay amount={summary.oldRegime.tax} className="text-xl font-bold" />
            {summary.oldRegime.refund > 0
              ? <p className="text-green-600 text-xs">Refund: ₹{summary.oldRegime.refund.toLocaleString('en-IN')}</p>
              : <p className="text-orange-600 text-xs">Due: ₹{summary.oldRegime.taxAfterPaid.toLocaleString('en-IN')}</p>
            }
            {summary.electedRegime === 'OLD' && <p className="text-xs text-primary font-medium">✓ Currently elected</p>}
          </div>
          <div className={cn(
            'rounded-lg border p-4 space-y-1',
            summary.electedRegime === 'NEW' ? 'border-primary bg-primary/5' : 'bg-muted/30',
          )}>
            <p className="font-medium">New Regime</p>
            <p className="text-muted-foreground">Tax + Cess</p>
            <INRDisplay amount={summary.newRegime.tax} className="text-xl font-bold" />
            {summary.newRegime.refund > 0
              ? <p className="text-green-600 text-xs">Refund: ₹{summary.newRegime.refund.toLocaleString('en-IN')}</p>
              : <p className="text-orange-600 text-xs">Due: ₹{summary.newRegime.taxAfterPaid.toLocaleString('en-IN')}</p>
            }
            {summary.electedRegime === 'NEW' && <p className="text-xs text-primary font-medium">✓ Currently elected</p>}
          </div>
        </div>

        {isOptimal ? (
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
            <CheckCircle className="h-4 w-4" />
            <span>You are on the optimal regime. No action needed.</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-800 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Switching to the <strong>{betterRegime} Regime</strong> would save{' '}
              <strong>₹{regimeSavings.toLocaleString('en-IN')}</strong> this FY.
              Update your Tax Regime in the Tax Summary → Income &amp; Tax Profile form.
            </span>
          </div>
        )}
      </div>

      {/* Section B + C: Deduction Headroom (Old Regime only) */}
      {isOldRegime ? (
        <div className="rounded-lg border bg-card p-6 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-lg">Deduction Headroom</h2>
            {totalPotentialSavings > 0 && (
              <div className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400 font-medium">
                <TrendingDown className="h-4 w-4" />
                Max additional savings: ₹{totalPotentialSavings.toLocaleString('en-IN')}
                <span className="text-xs font-normal text-muted-foreground ml-1">(approx.)</span>
              </div>
            )}
          </div>

          {rebateApplied ? (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              <span>
                Your Old Regime tax is <strong>₹0</strong> — the Sec 87A rebate already applies. No further
                deduction investments are needed to reduce your tax liability.
              </span>
            </div>
          ) : deductionRows.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              <span>All major deduction limits are fully utilised. Great work!</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Headroom table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-4 font-medium">Deduction</th>
                      <th className="text-right py-2 pr-4 font-medium">Used</th>
                      <th className="text-right py-2 pr-4 font-medium">Limit</th>
                      <th className="text-right py-2 pr-4 font-medium">Remaining</th>
                      <th className="text-right py-2 font-medium">Tax Saved if Maxed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {deductionRows.map((row) => (
                      <tr key={row.label}>
                        <td className="py-3 pr-4">
                          <p>{row.label}</p>
                          {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
                        </td>
                        <td className="text-right py-3 pr-4">
                          <INRDisplay amount={row.used} />
                        </td>
                        <td className="text-right py-3 pr-4 text-muted-foreground">
                          <INRDisplay amount={row.limit} />
                        </td>
                        <td className="text-right py-3 pr-4 text-orange-600 font-medium">
                          <INRDisplay amount={row.remaining} />
                        </td>
                        <td className="text-right py-3">
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 text-xs font-semibold">
                            <TrendingDown className="h-3 w-3" />
                            ₹{row.savings.toLocaleString('en-IN')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Section C: Action bullets */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Recommended Actions</p>
                <ul className="space-y-2">
                  {deductionRows.map((row) => (
                    <li key={row.label} className="flex items-start gap-2 text-sm">
                      <TrendingUp className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>
                        {row.action} — saves approximately{' '}
                        <span className="text-green-600 font-medium">₹{row.savings.toLocaleString('en-IN')}</span> in tax
                        at ~{marginalRate}% marginal rate.
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground pt-1">
                  * Savings are approximate. Actual tax saved depends on your final taxable income.
                  Marginal rate estimated at {marginalRate}% based on current taxable income of{' '}
                  ₹{(summary.oldRegime.taxableIncome / 100000).toFixed(1)}L.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-6 space-y-2">
          <h2 className="font-semibold text-lg">Deduction Headroom</h2>
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
            <span>
              You are on the <strong>New Regime</strong>. Deductions under 80C, 80D, and NPS are{' '}
              <strong>not available</strong> in this regime. Only the ₹75,000 standard deduction applies.
              {!isOptimal && ' Consider switching to the Old Regime (shown above) to unlock deduction benefits.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
