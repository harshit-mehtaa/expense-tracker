import { useQuery } from '@tanstack/react-query';
import { taxApi } from '@/api/tax';
import { formatINR } from '@/lib/indianFormat';

const formatCurrency = formatINR;

interface Props {
  fy: string;
}

export default function ITR2Summary({ fy }: Props) {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['itr2-summary', fy],
    queryFn: () => taxApi.getITR2Summary(fy),
  });

  if (isLoading) return <div className="text-center py-8 text-gray-400">Loading ITR-2 summary...</div>;
  if (!summary) return null;

  const rows = [
    {
      schedule: 'Schedule CG',
      label: 'Capital Gains',
      stcg: summary.scheduleCG.stcg.total,
      ltcg: summary.scheduleCG.ltcg.total,
      taxable: summary.scheduleCG.totalTaxableGain,
      notes: `${summary.scheduleCG.entryCount} entries`,
    },
    {
      schedule: 'Schedule OS',
      label: 'Other Sources',
      stcg: null,
      ltcg: null,
      taxable: summary.scheduleOS.taxableTotal,
      notes: summary.scheduleOS.deduction80TTA > 0
        ? `80TTA: −${formatCurrency(summary.scheduleOS.deduction80TTA)}`
        : '',
    },
    {
      schedule: 'Schedule HP',
      label: 'House Property',
      stcg: null,
      ltcg: null,
      taxable: summary.scheduleHP.taxableHPIncome,
      notes: summary.scheduleHP.hpLossSetOff > 0
        ? `Loss set-off: −${formatCurrency(summary.scheduleHP.hpLossSetOff)}`
        : summary.scheduleHP.totalHPIncome < 0 ? 'Carried forward loss' : '',
    },
  ];

  const totalTaxable = rows.reduce((s, r) => s + (r.taxable ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-700">ITR-2 Schedule Overview</h3>
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${summary.regime === 'NEW' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
          {summary.regime} Regime
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b bg-gray-50">
              <th className="px-3 py-2">Schedule</th>
              <th className="px-3 py-2">Income Head</th>
              <th className="px-3 py-2 text-right">STCG</th>
              <th className="px-3 py-2 text-right">LTCG</th>
              <th className="px-3 py-2 text-right">Taxable Amount</th>
              <th className="px-3 py-2 text-right text-gray-400">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.schedule} className="border-b hover:bg-gray-50">
                <td className="px-3 py-3 font-medium text-gray-800">{r.schedule}</td>
                <td className="px-3 py-3 text-gray-600">{r.label}</td>
                <td className="px-3 py-3 text-right">
                  {r.stcg !== null ? formatCurrency(r.stcg) : '—'}
                </td>
                <td className="px-3 py-3 text-right">
                  {r.ltcg !== null ? formatCurrency(r.ltcg) : '—'}
                </td>
                <td className={`px-3 py-3 text-right font-medium ${(r.taxable ?? 0) < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatCurrency(Math.abs(r.taxable ?? 0))}
                  {(r.taxable ?? 0) < 0 ? ' (loss)' : ''}
                </td>
                <td className="px-3 py-3 text-right text-xs text-gray-400">{r.notes}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-semibold">
              <td className="px-3 py-3 text-blue-800" colSpan={4}>
                Total Additional Taxable Income
                {totalTaxable < 0 && (
                  <span className="ml-2 text-xs font-normal text-amber-700">(CG/HP losses cannot offset salary — add to salary separately)</span>
                )}
              </td>
              <td className="px-3 py-3 text-right text-blue-800">{formatCurrency(Math.max(totalTaxable, 0))}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* CG breakdown detail */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Capital Gains Breakdown</p>
          <div className="space-y-2 text-sm">
            <BreakdownRow label="STCG on Equity (15%)" value={summary.scheduleCG.stcg.equity15Pct} />
            <BreakdownRow label="STCG Other (Slab)" value={summary.scheduleCG.stcg.other} />
            <BreakdownRow label="LTCG Equity Sec 112A (10%)" value={summary.scheduleCG.ltcg.equity10Pct} note="After ₹1L exemption" />
            <BreakdownRow label="LTCG with Indexation (20%)" value={summary.scheduleCG.ltcg.withIndexation} />
            {summary.scheduleCG.ltcg.debtMFSlab > 0 && (
              <BreakdownRow label="Debt MF (Slab rate)" value={summary.scheduleCG.ltcg.debtMFSlab} />
            )}
            {summary.scheduleCG.ltcg.foreign20Pct > 0 && (
              <BreakdownRow label="Foreign Equity LTCG (20%)" value={summary.scheduleCG.ltcg.foreign20Pct} note="No indexation" />
            )}
          </div>
        </div>

        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Other Sources Breakdown</p>
          <div className="space-y-2 text-sm">
            <BreakdownRow label="FD Interest" value={summary.scheduleOS.breakdown.fdInterest} />
            <BreakdownRow label="RD Interest" value={summary.scheduleOS.breakdown.rdInterest} />
            <BreakdownRow label="Savings Interest" value={summary.scheduleOS.breakdown.savingsInterest} />
            <BreakdownRow label="Dividend" value={summary.scheduleOS.breakdown.dividend} />
            <BreakdownRow label="Gift" value={summary.scheduleOS.breakdown.gift} />
            <BreakdownRow label="Other" value={summary.scheduleOS.breakdown.other} />
            {summary.scheduleOS.foreignDividend > 0 && (
              <BreakdownRow label="Foreign Dividend" value={summary.scheduleOS.foreignDividend} />
            )}
            {summary.scheduleOS.deduction80TTA > 0 && (
              <BreakdownRow label="Less: 80TTA Deduction" value={-summary.scheduleOS.deduction80TTA} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, note }: { label: string; value: number; note?: string }) {
  if (value === 0) return null;
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-600">
        {label}
        {note && <span className="text-xs text-gray-400 ml-1">({note})</span>}
      </span>
      <span className={`font-medium ${value < 0 ? 'text-green-600' : 'text-gray-900'}`}>
        {value < 0 ? '−' : ''}{formatCurrency(Math.abs(value))}
      </span>
    </div>
  );
}
