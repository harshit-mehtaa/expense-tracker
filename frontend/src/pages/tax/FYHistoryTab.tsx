import { useQueries } from '@tanstack/react-query';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { taxApi } from '@/api/tax';
import { cn } from '@/lib/utils';

interface FYHistoryTabProps {
  fyOptions: string[];
  viewUserId?: string;
}

export default function FYHistoryTab({ fyOptions, viewUserId }: FYHistoryTabProps) {
  const results = useQueries({
    queries: fyOptions.map((fy) => ({
      queryKey: ['tax-summary', fy, viewUserId] as const,
      queryFn: () => taxApi.getSummary(fy, viewUserId),
      staleTime: 5 * 60 * 1000, // 5 min — avoid refetch on every tab switch
    })),
  });

  const rows = fyOptions.map((fy, i) => ({
    fy,
    result: results[i],
  }));

  const isAnyLoading = results.some((r) => r.isLoading);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Year-over-year comparison of your tax position across the last {fyOptions.length} financial years.
      </p>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-4 py-3 font-medium">FY</th>
              <th className="text-left px-4 py-3 font-medium">Regime</th>
              <th className="text-right px-4 py-3 font-medium">Gross Salary</th>
              <th className="text-right px-4 py-3 font-medium">Taxable Income</th>
              <th className="text-right px-4 py-3 font-medium">Tax</th>
              <th className="text-right px-4 py-3 font-medium">Eff. Rate</th>
              <th className="text-right px-4 py-3 font-medium">Refund / Due</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ fy, result }, idx) => {
              if (result.isLoading || (isAnyLoading && !result.data)) {
                return (
                  <tr key={fy} className="animate-pulse">
                    <td className="px-4 py-3 font-medium">{fy}</td>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <td key={i} className="px-4 py-3">
                        <div className="h-4 bg-muted rounded w-20 ml-auto" />
                      </td>
                    ))}
                  </tr>
                );
              }

              if (result.isError) {
                return (
                  <tr key={fy}>
                    <td className="px-4 py-3 font-medium">{fy}</td>
                    <td colSpan={6} className="px-4 py-3 text-destructive text-xs">Failed to load</td>
                  </tr>
                );
              }

              const data = result.data;

              // Backend returns zero-filled summary when no profile exists
              if (!data || data.grossSalary === 0) {
                return (
                  <tr key={fy} className="text-muted-foreground">
                    <td className="px-4 py-3 font-medium text-foreground">{fy}</td>
                    <td colSpan={6} className="px-4 py-3 text-xs italic">No profile saved for this year</td>
                  </tr>
                );
              }

              const electedData = data.electedRegime === 'NEW' ? data.newRegime : data.oldRegime;
              const effectiveRate = data.grossSalary > 0
                ? ((electedData.tax / data.grossSalary) * 100).toFixed(1)
                : '—';

              // YoY delta: compare against next row (idx+1 = one year earlier)
              let taxDelta: number | null = null;
              if (idx + 1 < rows.length) {
                const prevResult = rows[idx + 1].result;
                if (prevResult.data && prevResult.data.grossSalary > 0) {
                  const prevData = prevResult.data;
                  const prevElected = prevData.electedRegime === 'NEW' ? prevData.newRegime : prevData.oldRegime;
                  taxDelta = electedData.tax - prevElected.tax;
                }
              }

              return (
                <tr key={fy} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{fy}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                      data.electedRegime === 'OLD'
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                        : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
                    )}>
                      {data.electedRegime === 'OLD' ? 'Old' : 'New'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <INRDisplay amount={data.grossSalary} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <INRDisplay amount={electedData.taxableIncome} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <INRDisplay amount={electedData.tax} className="font-medium" />
                      {taxDelta !== null && taxDelta !== 0 && (
                        <span className={cn(
                          'flex items-center gap-0.5 text-xs',
                          taxDelta > 0 ? 'text-red-500' : 'text-green-600',
                        )}>
                          {taxDelta > 0
                            ? <TrendingUp className="h-3 w-3" />
                            : <TrendingDown className="h-3 w-3" />
                          }
                          ₹{Math.abs(taxDelta).toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{effectiveRate}%</td>
                  <td className="px-4 py-3 text-right">
                    {electedData.refund > 0 ? (
                      <INRDisplay amount={electedData.refund} className="text-green-600 font-medium" />
                    ) : (
                      <INRDisplay amount={electedData.taxAfterPaid} className="text-orange-600 font-medium" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Tax delta (▲/▼) shows change vs the previous year. Green = tax decreased, Red = tax increased.
        All figures based on your saved tax profile for each year.
      </p>
    </div>
  );
}
