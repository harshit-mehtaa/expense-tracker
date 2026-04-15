import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { insuranceApi } from '@/api/insurance';
import { cn } from '@/lib/utils';

function ProgressBar({ value, max, color = 'bg-green-500' }: { value: number; max: number; color?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-3 bg-muted rounded-full overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

interface Tracker80DTabProps {
  viewUserId?: string;
  selectedRegime: string;
}

export default function Tracker80DTab({ viewUserId, selectedRegime }: Tracker80DTabProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['insurance', '80d', viewUserId],
    queryFn: () => insuranceApi.get80D(viewUserId ? { targetUserId: viewUserId } : undefined),
    staleTime: 5 * 60 * 1000,
  });

  if (selectedRegime === 'NEW') {
    return (
      <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 p-4 text-sm text-amber-800 dark:text-amber-200">
        <strong>Not applicable in New Regime.</strong> Section 80D deductions are not available under the New Tax Regime.
        Switch to Old Regime in your tax profile to benefit from health insurance deductions.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 bg-muted rounded-lg" />
        <div className="grid md:grid-cols-2 gap-4">
          <div className="h-28 bg-muted rounded-lg" />
          <div className="h-28 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return <p className="text-sm text-destructive py-4">Failed to load 80D insurance data.</p>;
  }

  const selfFamilyPct = data.selfFamily.limit > 0 ? Math.min((data.selfFamily.paid / data.selfFamily.limit) * 100, 100) : 0;
  const parentsPct = data.parents.limit > 0 ? Math.min((data.parents.paid / data.parents.limit) * 100, 100) : 0;
  const combinedLimit = data.selfFamily.limit + data.parents.limit;
  const totalPct = combinedLimit > 0 ? Math.min((data.total / combinedLimit) * 100, 100) : 0;

  return (
    <div className="space-y-6">
      {/* Combined total summary */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">80D Health Insurance Tracker</h2>
          <div className="text-right">
            <INRDisplay amount={data.total} className="text-2xl font-bold" />
            <p className="text-xs text-muted-foreground">of <INRDisplay amount={combinedLimit} className="text-xs" /> combined limit</p>
          </div>
        </div>
        <ProgressBar
          value={data.total}
          max={combinedLimit}
          color={totalPct >= 100 ? 'bg-green-500' : totalPct >= 75 ? 'bg-yellow-500' : 'bg-red-500'}
        />
        <p className="text-sm text-muted-foreground mt-2">
          {data.total < combinedLimit ? (
            <>
              <INRDisplay amount={combinedLimit - data.total} className="text-orange-600 font-medium" />
              {' '}still available — pay premiums to save more tax!
            </>
          ) : (
            <span className="text-green-600 font-medium">80D limit fully utilized ✓</span>
          )}
        </p>
      </div>

      {/* Self & Family + Parents breakdown */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium text-sm">Self &amp; Family</p>
              <p className="text-xs text-muted-foreground">Self, spouse &amp; children</p>
            </div>
            <div className="text-right">
              <INRDisplay amount={data.selfFamily.paid} className="font-semibold" />
              <p className="text-xs text-muted-foreground">of <INRDisplay amount={data.selfFamily.limit} className="text-xs" /></p>
            </div>
          </div>
          <ProgressBar
            value={data.selfFamily.paid}
            max={data.selfFamily.limit}
            color={selfFamilyPct >= 100 ? 'bg-green-500' : selfFamilyPct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}
          />
          <p className="text-xs text-muted-foreground">
            Deductible: <INRDisplay amount={data.selfFamily.deductible} className="font-medium text-foreground text-xs" />
          </p>
        </div>

        <div className="rounded-lg border bg-card p-5 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium text-sm">Parents</p>
              <p className="text-xs text-muted-foreground">₹50K limit for senior citizen parents (60+)</p>
            </div>
            <div className="text-right">
              <INRDisplay amount={data.parents.paid} className="font-semibold" />
              <p className="text-xs text-muted-foreground">of <INRDisplay amount={data.parents.limit} className="text-xs" /></p>
            </div>
          </div>
          <ProgressBar
            value={data.parents.paid}
            max={data.parents.limit}
            color={parentsPct >= 100 ? 'bg-green-500' : parentsPct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}
          />
          <p className="text-xs text-muted-foreground">
            Deductible: <INRDisplay amount={data.parents.deductible} className="font-medium text-foreground text-xs" />
          </p>
        </div>
      </div>

      {/* Policy list */}
      {data.policies && data.policies.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <div className="px-4 py-3 border-b">
            <h3 className="font-medium text-sm">Eligible Policies</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium">Provider</th>
                  <th className="text-left px-4 py-2.5 font-medium">Policy</th>
                  <th className="text-right px-4 py-2.5 font-medium">Annual Premium</th>
                  <th className="text-center px-4 py-2.5 font-medium">Bucket</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.policies.map((policy: any) => (
                  <tr key={policy.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">{policy.providerName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{policy.policyName}</td>
                    <td className="px-4 py-3 text-right">
                      {/* Number() coercion: Prisma Decimal serializes as string in JSON */}
                      <INRDisplay amount={Number(policy.premiumAmount)} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                        policy.isForParents
                          ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                          : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
                      )}>
                        {policy.isForParents ? 'Parents' : 'Self/Family'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-lg border p-4">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            No 80D-eligible health insurance policies found. Add policies in the{' '}
            <strong>Insurance</strong> section and mark them as 80D-eligible.
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        * Limits shown are ₹25,000 per bucket as per the current calculation. For senior citizen parents (age 60+),
        the actual deduction limit is ₹50,000 — this higher limit applies at ITR filing when parent ages are declared.
        Premiums paid in cash are not eligible for 80D deduction.
      </p>
    </div>
  );
}
