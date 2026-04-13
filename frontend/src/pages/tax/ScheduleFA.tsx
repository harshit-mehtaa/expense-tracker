import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { taxApi } from '@/api/tax';
import type { ForeignAssetCategory, ForeignAssetDisclosure } from '@/types/tax';
import { formatINR } from '@/lib/indianFormat';

const formatCurrency = formatINR;

const CATEGORY_LABELS: Record<ForeignAssetCategory, string> = {
  BANK_ACCOUNT: 'Bank Account',
  EQUITY_AND_MF: 'Equity & Mutual Funds',
  DEBT: 'Debt Instruments',
  IMMOVABLE_PROPERTY: 'Immovable Property',
  OTHER: 'Other',
};

const entrySchema = z.object({
  fyYear: z.string(),
  category: z.enum(['BANK_ACCOUNT', 'EQUITY_AND_MF', 'DEBT', 'IMMOVABLE_PROPERTY', 'OTHER']),
  country: z.string().min(1, 'Required'),
  assetDescription: z.string().min(1, 'Required'),
  acquisitionCostINR: z.coerce.number().min(0, 'Must be ≥ 0'),
  peakValueINR: z.coerce.number().min(0, 'Must be ≥ 0'),
  closingValueINR: z.coerce.number().min(0, 'Must be ≥ 0'),
  incomeAccruedINR: z.coerce.number().min(0).optional().or(z.literal('')),
  notes: z.string().optional(),
});

type EntryForm = z.infer<typeof entrySchema>;

interface Props {
  fy: string;
  viewUserId?: string;
}

export default function ScheduleFA({ fy, viewUserId }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: entries = [] } = useQuery({
    queryKey: ['fa-entries', fy, viewUserId],
    queryFn: () => taxApi.listForeignAssets(fy, viewUserId),
  });

  const { data: summary } = useQuery({
    queryKey: ['fa-summary', fy, viewUserId],
    queryFn: () => taxApi.getForeignAssetSummary(fy, viewUserId),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<EntryForm>({
    resolver: zodResolver(entrySchema),
    defaultValues: { fyYear: fy },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fa-entries', fy, viewUserId] });
    qc.invalidateQueries({ queryKey: ['fa-summary', fy, viewUserId] });
    // Note: 'itr2-summary' is intentionally NOT invalidated here.
    // Schedule FA is disclosure-only and has no effect on ITR-2 computed tax totals.
  };

  const createMutation = useMutation({
    mutationFn: (data: object) => taxApi.createForeignAsset(data),
    onSuccess: () => { invalidate(); setShowForm(false); reset(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => taxApi.updateForeignAsset(id, data),
    onSuccess: () => { invalidate(); setEditId(null); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => taxApi.deleteForeignAsset(id),
    onSuccess: invalidate,
  });

  const onSubmit = (data: EntryForm) => {
    const payload = {
      ...data,
      incomeAccruedINR: data.incomeAccruedINR === '' ? undefined : data.incomeAccruedINR,
    };
    if (editId) {
      updateMutation.mutate({ id: editId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const startEdit = (entry: ForeignAssetDisclosure) => {
    setEditId(entry.id);
    setShowForm(true);
    reset({
      fyYear: entry.fyYear,
      category: entry.category,
      country: entry.country,
      assetDescription: entry.assetDescription,
      acquisitionCostINR: entry.acquisitionCostINR,
      peakValueINR: entry.peakValueINR,
      closingValueINR: entry.closingValueINR,
      incomeAccruedINR: entry.incomeAccruedINR ?? '',
      notes: entry.notes ?? '',
    });
  };

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <p className="font-medium">Schedule FA — Foreign Asset Disclosure</p>
        <p className="mt-1">
          Residents must disclose foreign assets held at any time during the FY in Schedule FA of ITR-2.
          This is a disclosure-only schedule — it does not affect your tax computation.
          Income from foreign assets (dividends, interest) should also be reported in Schedule OS or Schedule CG.
        </p>
      </div>

      {/* Summary */}
      {summary && summary.count > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-white border rounded-lg p-4">
            <p className="text-xs text-gray-500">Total Assets</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{summary.count}</p>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <p className="text-xs text-gray-500">Total Closing Value</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{formatCurrency(summary.totalClosingValueINR)}</p>
          </div>
          {summary.totalIncomeAccruedINR > 0 && (
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-gray-500">Total Income Accrued</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{formatCurrency(summary.totalIncomeAccruedINR)}</p>
            </div>
          )}
        </div>
      )}

      {/* Add button — hidden when viewing another member's data */}
      <div className="flex justify-between items-center">
        <h3 className="font-medium text-gray-700">Foreign Asset Disclosures</h3>
        {!viewUserId && (
          <button
            onClick={() => { setShowForm(!showForm); setEditId(null); reset({ fyYear: fy }); }}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
          >
            + Add Asset
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-gray-50 border rounded-lg p-4 space-y-4">
          <input type="hidden" {...register('fyYear')} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select {...register('category')} className="input">
                <option value="">Select category</option>
                {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Country</label>
              <input {...register('country')} className="input" placeholder="e.g. United States" />
              {errors.country && <p className="text-red-500 text-xs mt-1">{errors.country.message}</p>}
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Asset Description</label>
              <input {...register('assetDescription')} className="input" placeholder="e.g. Apple Inc. shares held in Schwab" />
              {errors.assetDescription && <p className="text-red-500 text-xs mt-1">{errors.assetDescription.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Acquisition Cost (₹)</label>
              <input type="number" step="0.01" {...register('acquisitionCostINR')} className="input" />
              {errors.acquisitionCostINR && <p className="text-red-500 text-xs mt-1">{errors.acquisitionCostINR.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Peak Value during FY (₹)</label>
              <input type="number" step="0.01" {...register('peakValueINR')} className="input" />
              {errors.peakValueINR && <p className="text-red-500 text-xs mt-1">{errors.peakValueINR.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Closing Value at 31 Mar (₹)</label>
              <input type="number" step="0.01" {...register('closingValueINR')} className="input" />
              {errors.closingValueINR && <p className="text-red-500 text-xs mt-1">{errors.closingValueINR.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Income Accrued (₹) — optional</label>
              <input type="number" step="0.01" {...register('incomeAccruedINR')} className="input" placeholder="Dividends, interest, etc." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <input {...register('notes')} className="input" placeholder="Optional" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm">
              {editId ? 'Update' : 'Add Asset'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); reset(); }} className="text-sm text-gray-600 hover:underline px-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Entries table */}
      {entries.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No foreign assets disclosed for {fy}. Add your first asset above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 pr-3">Asset</th>
                <th className="pb-2 pr-3">Category</th>
                <th className="pb-2 pr-3">Country</th>
                <th className="pb-2 pr-3 text-right">Closing Value</th>
                <th className="pb-2 pr-3 text-right">Income</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-3 font-medium">{e.assetDescription}</td>
                  <td className="py-2 pr-3 text-gray-600">{CATEGORY_LABELS[e.category]}</td>
                  <td className="py-2 pr-3 text-gray-600">{e.country}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(Number(e.closingValueINR))}</td>
                  <td className="py-2 pr-3 text-right text-gray-500">
                    {e.incomeAccruedINR ? formatCurrency(Number(e.incomeAccruedINR)) : '—'}
                  </td>
                  <td className="py-2 flex gap-2">
                    {!viewUserId && (
                      <>
                        <button onClick={() => startEdit(e)} className="text-blue-600 hover:underline text-xs">Edit</button>
                        <button onClick={() => deleteMutation.mutate(e.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
