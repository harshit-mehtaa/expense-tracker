import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { taxApi } from '@/api/tax';
import type { OtherSourceType, OtherIncomeSummary } from '@/types/tax';
import { formatINR } from '@/lib/indianFormat';

const formatCurrency = formatINR;

const SOURCE_LABELS: Record<OtherSourceType, string> = {
  FD_INTEREST: 'FD Interest',
  RD_INTEREST: 'RD Interest',
  SAVINGS_INTEREST: 'Savings Account Interest',
  DIVIDEND: 'Dividend',
  GIFT: 'Gift',
  FOREIGN_DIVIDEND: 'Foreign Dividend',
  OTHER: 'Other',
};

const entrySchema = z.object({
  fyYear: z.string(),
  sourceType: z.enum(['FD_INTEREST', 'RD_INTEREST', 'SAVINGS_INTEREST', 'DIVIDEND', 'GIFT', 'FOREIGN_DIVIDEND', 'OTHER']),
  description: z.string().min(1, 'Required'),
  amount: z.coerce.number().positive('Must be positive'),
  tdsDeducted: z.coerce.number().min(0).optional().or(z.literal('')),
  notes: z.string().optional(),
});

type EntryForm = z.infer<typeof entrySchema>;

interface Props {
  fy: string;
  viewUserId?: string;
}

export default function ScheduleOS({ fy, viewUserId }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: entries = [] } = useQuery({
    queryKey: ['os-entries', fy, viewUserId],
    queryFn: () => taxApi.listOtherIncome(fy, viewUserId),
  });

  const { data: summary } = useQuery({
    queryKey: ['os-summary', fy, viewUserId],
    queryFn: () => taxApi.getOtherIncomeSummary(fy, viewUserId),
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<EntryForm>({
    resolver: zodResolver(entrySchema),
    defaultValues: { fyYear: fy },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['os-entries', fy, viewUserId] });
    qc.invalidateQueries({ queryKey: ['os-summary', fy, viewUserId] });
    qc.invalidateQueries({ queryKey: ['itr2-summary', fy, viewUserId] });
  };

  const createMutation = useMutation({
    mutationFn: (data: object) => taxApi.createOtherIncome(data),
    onSuccess: () => { invalidate(); setShowForm(false); reset(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => taxApi.updateOtherIncome(id, data),
    onSuccess: () => { invalidate(); setEditId(null); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => taxApi.deleteOtherIncome(id),
    onSuccess: invalidate,
  });

  const onSubmit = (data: EntryForm) => {
    const payload = {
      ...data,
      tdsDeducted: data.tdsDeducted === '' ? undefined : data.tdsDeducted,
    };
    if (editId) {
      updateMutation.mutate({ id: editId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const sourceType = watch('sourceType');

  const startEdit = (entry: any) => {
    setEditId(entry.id);
    setShowForm(true);
    reset({
      fyYear: entry.fyYear,
      sourceType: entry.sourceType,
      description: entry.description,
      amount: entry.amount,
      tdsDeducted: entry.tdsDeducted ?? '',
      notes: entry.notes ?? '',
    });
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      {summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {(Object.entries(summary.breakdown) as [keyof OtherIncomeSummary['breakdown'], number][]).map(([key, val]) => (
              val > 0 && (
                <div key={key} className="bg-white border rounded-lg p-4">
                  <p className="text-xs text-gray-500">{SOURCE_LABELS[key as OtherSourceType] ?? key}</p>
                  <p className="text-lg font-semibold text-gray-900 mt-1">{formatCurrency(val)}</p>
                </div>
              )
            ))}
            {summary.foreignDividend > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <p className="text-xs text-gray-500">Foreign Dividend</p>
                <p className="text-lg font-semibold text-gray-900 mt-1">{formatCurrency(summary.foreignDividend)}</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-gray-500">Gross Total</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{formatCurrency(summary.grossTotal)}</p>
            </div>
            {summary.deduction80TTA > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-xs text-gray-500">Deduction 80TTA</p>
                <p className="text-xs text-gray-400">Savings interest up to ₹10K</p>
                <p className="text-lg font-semibold text-green-700 mt-1">−{formatCurrency(summary.deduction80TTA)}</p>
              </div>
            )}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-xs text-gray-500">Taxable Total</p>
              <p className="text-lg font-semibold text-blue-700 mt-1">{formatCurrency(summary.taxableTotal)}</p>
            </div>
            {summary.totalTdsDeducted > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <p className="text-xs text-gray-500">TDS Deducted (Domestic)</p>
                <p className="text-lg font-semibold text-gray-700 mt-1">{formatCurrency(summary.totalTdsDeducted)}</p>
              </div>
            )}
          </div>
          {summary.totalForeignWithholdingTax > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
              <p className="font-medium text-amber-800">DTAA Credit Note</p>
              <p className="text-amber-700 mt-1">
                Foreign withholding tax paid: <strong>{formatCurrency(summary.totalForeignWithholdingTax)}</strong>.
                You may claim DTAA relief on foreign dividend income. Report this in Schedule FSI / Schedule TR in ITR-2 to avoid double taxation. This system does not compute the credit — consult a CA or your ITR filing software.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Add button — hidden when viewing another member's data */}
      <div className="flex justify-between items-center">
        <h3 className="font-medium text-gray-700">Income from Other Sources</h3>
        {!viewUserId && (
          <button
            onClick={() => { setShowForm(!showForm); setEditId(null); reset({ fyYear: fy }); }}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
          >
            + Add Entry
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-gray-50 border rounded-lg p-4 space-y-4">
          <input type="hidden" {...register('fyYear')} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Source Type</label>
              <select {...register('sourceType')} className="input">
                <option value="">Select type</option>
                {Object.entries(SOURCE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              {errors.sourceType && <p className="text-red-500 text-xs mt-1">{errors.sourceType.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <input {...register('description')} className="input" placeholder="e.g. SBI FD Interest" />
              {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount (₹)</label>
              <input type="number" step="0.01" {...register('amount')} className="input" />
              {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {sourceType === 'FOREIGN_DIVIDEND' ? 'Foreign Withholding Tax (₹ equivalent) — optional' : 'TDS Deducted (₹) — optional'}
              </label>
              <input type="number" step="0.01" {...register('tdsDeducted')} className="input" placeholder="0" />
              {sourceType === 'FOREIGN_DIVIDEND' && (
                <p className="text-xs text-amber-700 mt-1">Stored for DTAA credit reference. Taxed at slab rate.</p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <input {...register('notes')} className="input" placeholder="Optional" />
            </div>
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
        <p className="text-gray-500 text-sm text-center py-8">No other income entries for {fy}. Add your first entry above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 pr-3">Description</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3 text-right">Amount</th>
                <th className="pb-2 pr-3 text-right">TDS / WHT</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-3 font-medium">{e.description}</td>
                  <td className="py-2 pr-3 text-gray-600">{SOURCE_LABELS[e.sourceType]}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(Number(e.amount))}</td>
                  <td className="py-2 pr-3 text-right text-gray-500">{e.tdsDeducted ? formatCurrency(Number(e.tdsDeducted)) : '—'}</td>
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
