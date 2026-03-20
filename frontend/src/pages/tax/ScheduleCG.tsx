import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { taxApi } from '@/api/tax';
import type { CapitalGainAssetType } from '@/types/tax';
import { formatINR } from '@/lib/indianFormat';

const formatCurrency = formatINR;

const ASSET_TYPE_LABELS: Record<CapitalGainAssetType, string> = {
  EQUITY_LISTED: 'Listed Equity',
  EQUITY_MUTUAL_FUND: 'Equity Mutual Fund',
  DEBT_MUTUAL_FUND: 'Debt Mutual Fund',
  PROPERTY: 'Property',
  BONDS: 'Bonds',
  GOLD: 'Gold',
  OTHER: 'Other',
};

const entrySchema = z.object({
  fyYear: z.string(),
  assetName: z.string().min(1, 'Required'),
  assetType: z.enum(['EQUITY_LISTED', 'EQUITY_MUTUAL_FUND', 'DEBT_MUTUAL_FUND', 'PROPERTY', 'BONDS', 'GOLD', 'OTHER']),
  purchaseDate: z.string().min(1, 'Required'),
  saleDate: z.string().min(1, 'Required'),
  purchasePrice: z.coerce.number().positive('Must be positive'),
  salePrice: z.coerce.number().positive('Must be positive'),
  indexedCost: z.coerce.number().positive().optional().or(z.literal('')),
  isSection112AEligible: z.boolean().optional(),
  isPreApril2023Purchase: z.boolean().optional(),
  notes: z.string().optional(),
});

type EntryForm = z.infer<typeof entrySchema>;

interface Props {
  fy: string;
}

export default function ScheduleCG({ fy }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: entries = [] } = useQuery({
    queryKey: ['cg-entries', fy],
    queryFn: () => taxApi.listCapitalGains(fy),
  });

  const { data: summary } = useQuery({
    queryKey: ['cg-summary', fy],
    queryFn: () => taxApi.getCapitalGainsSummary(fy),
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<EntryForm>({
    resolver: zodResolver(entrySchema),
    defaultValues: { fyYear: fy },
  });

  const assetType = watch('assetType');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cg-entries', fy] });
    qc.invalidateQueries({ queryKey: ['cg-summary', fy] });
    qc.invalidateQueries({ queryKey: ['itr2-summary', fy] });
  };

  const createMutation = useMutation({
    mutationFn: (data: object) => taxApi.createCapitalGain(data),
    onSuccess: () => { invalidate(); setShowForm(false); reset(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => taxApi.updateCapitalGain(id, data),
    onSuccess: () => { invalidate(); setEditId(null); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => taxApi.deleteCapitalGain(id),
    onSuccess: invalidate,
  });

  const onSubmit = (data: EntryForm) => {
    const payload = {
      ...data,
      purchaseDate: new Date(data.purchaseDate).toISOString(),
      saleDate: new Date(data.saleDate).toISOString(),
      indexedCost: data.indexedCost === '' ? undefined : data.indexedCost,
    };
    if (editId) {
      updateMutation.mutate({ id: editId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const startEdit = (entry: any) => {
    setEditId(entry.id);
    setShowForm(true);
    reset({
      fyYear: entry.fyYear,
      assetName: entry.assetName,
      assetType: entry.assetType,
      purchaseDate: entry.purchaseDate?.slice(0, 10),
      saleDate: entry.saleDate?.slice(0, 10),
      purchasePrice: entry.purchasePrice,
      salePrice: entry.salePrice,
      indexedCost: entry.indexedCost ?? '',
      isSection112AEligible: entry.isSection112AEligible,
      isPreApril2023Purchase: entry.isPreApril2023Purchase,
      notes: entry.notes ?? '',
    });
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="STCG (15% – Equity)" value={summary.stcg.equity15Pct} />
          <SummaryCard label="STCG (Slab – Other)" value={summary.stcg.other} />
          <SummaryCard label="LTCG (10% – Equity)" value={summary.ltcg.equity10Pct} note="After ₹1L exemption" />
          <SummaryCard label="LTCG (20% – Indexation)" value={summary.ltcg.withIndexation} />
          {summary.ltcg.debtMFSlab > 0 && (
            <SummaryCard label="Debt MF (Slab)" value={summary.ltcg.debtMFSlab} />
          )}
          <SummaryCard label="Total Taxable Gain" value={summary.totalTaxableGain} highlight />
        </div>
      )}

      {/* Add button */}
      <div className="flex justify-between items-center">
        <h3 className="font-medium text-gray-700">Capital Gain Entries</h3>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); reset({ fyYear: fy }); }}
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
        >
          + Add Entry
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-gray-50 border rounded-lg p-4 space-y-4">
          <input type="hidden" {...register('fyYear')} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Asset Name</label>
              <input {...register('assetName')} className="input" placeholder="e.g. Reliance Industries" />
              {errors.assetName && <p className="text-red-500 text-xs mt-1">{errors.assetName.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Asset Type</label>
              <select {...register('assetType')} className="input">
                <option value="">Select type</option>
                {Object.entries(ASSET_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              {errors.assetType && <p className="text-red-500 text-xs mt-1">{errors.assetType.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Purchase Date</label>
              <input type="date" {...register('purchaseDate')} className="input" />
              {errors.purchaseDate && <p className="text-red-500 text-xs mt-1">{errors.purchaseDate.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Sale Date</label>
              <input type="date" {...register('saleDate')} className="input" />
              {errors.saleDate && <p className="text-red-500 text-xs mt-1">{errors.saleDate.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Purchase Price (₹)</label>
              <input type="number" step="0.01" {...register('purchasePrice')} className="input" />
              {errors.purchasePrice && <p className="text-red-500 text-xs mt-1">{errors.purchasePrice.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Sale Price (₹)</label>
              <input type="number" step="0.01" {...register('salePrice')} className="input" />
              {errors.salePrice && <p className="text-red-500 text-xs mt-1">{errors.salePrice.message}</p>}
            </div>
            {(assetType === 'PROPERTY' || assetType === 'GOLD' || assetType === 'BONDS') && (
              <div>
                <label className="block text-sm font-medium mb-1">Indexed Cost (₹) — optional</label>
                <input type="number" step="0.01" {...register('indexedCost')} className="input" placeholder="Leave blank to use purchase price" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4">
            {(assetType === 'EQUITY_LISTED' || assetType === 'EQUITY_MUTUAL_FUND') && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isSection112AEligible')} />
                Eligible for Sec 112A (listed equity/equity MF LTCG)
              </label>
            )}
            {assetType === 'DEBT_MUTUAL_FUND' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isPreApril2023Purchase')} />
                Purchased before April 2023 (old LTCG rules apply)
              </label>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <input {...register('notes')} className="input" placeholder="Optional" />
          </div>

          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm">
              {editId ? 'Update' : 'Add Entry'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); reset(); }} className="text-sm text-gray-600 hover:underline px-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Entries table */}
      {entries.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No capital gain entries for {fy}. Add your first entry above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 pr-3">Asset</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3">Sale Date</th>
                <th className="pb-2 pr-3 text-right">Gain</th>
                <th className="pb-2 pr-3">Tax</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {summary?.entries.map((e) => {
                const raw = entries.find((r) => r.id === e.id);
                const gain = e.gain;
                return (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-3 font-medium">{e.assetName}</td>
                    <td className="py-2 pr-3 text-gray-600">{ASSET_TYPE_LABELS[e.assetType]}</td>
                    <td className="py-2 pr-3 text-gray-600">{raw?.saleDate?.slice(0, 10)}</td>
                    <td className={`py-2 pr-3 text-right font-medium ${gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(Math.abs(gain))} {gain < 0 ? '(loss)' : ''}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{e.taxRate}</td>
                    <td className="py-2 flex gap-2">
                      {raw && (
                        <>
                          <button onClick={() => startEdit(raw)} className="text-blue-600 hover:underline text-xs">Edit</button>
                          <button onClick={() => deleteMutation.mutate(e.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, note, highlight }: { label: string; value: number; note?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-4 border ${highlight ? 'bg-blue-50 border-blue-200' : 'bg-white'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      {note && <p className="text-xs text-gray-400">{note}</p>}
      <p className={`text-lg font-semibold mt-1 ${value < 0 ? 'text-red-600' : highlight ? 'text-blue-700' : 'text-gray-900'}`}>
        {formatCurrency(Math.abs(value))}
        {value < 0 ? ' (loss)' : ''}
      </p>
    </div>
  );
}
