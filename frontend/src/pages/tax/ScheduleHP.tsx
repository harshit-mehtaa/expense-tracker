import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { taxApi } from '@/api/tax';
import type { HousePropertyUsage } from '@/types/tax';
import { formatINR } from '@/lib/indianFormat';

const formatCurrency = formatINR;

const USAGE_LABELS: Record<HousePropertyUsage, string> = {
  SELF_OCCUPIED: 'Self-Occupied',
  LET_OUT: 'Let-Out',
  DEEMED_LET_OUT: 'Deemed Let-Out',
};

const entrySchema = z.object({
  fyYear: z.string(),
  propertyName: z.string().min(1, 'Required'),
  usage: z.enum(['SELF_OCCUPIED', 'LET_OUT', 'DEEMED_LET_OUT']),
  grossAnnualRent: z.coerce.number().min(0).optional().or(z.literal('')),
  municipalTaxesPaid: z.coerce.number().min(0).optional().or(z.literal('')),
  homeLoanInterest: z.coerce.number().min(0).optional().or(z.literal('')),
  isPreConstruction: z.boolean().optional(),
  notes: z.string().optional(),
});

type EntryForm = z.infer<typeof entrySchema>;

interface Props {
  fy: string;
  viewUserId?: string;
}

export default function ScheduleHP({ fy, viewUserId }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: entries = [] } = useQuery({
    queryKey: ['hp-entries', fy, viewUserId],
    queryFn: () => taxApi.listHouseProperty(fy, viewUserId),
  });

  const { data: summary } = useQuery({
    queryKey: ['hp-summary', fy, viewUserId],
    queryFn: () => taxApi.getHousePropertySummary(fy, viewUserId),
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<EntryForm>({
    resolver: zodResolver(entrySchema),
    defaultValues: { fyYear: fy },
  });

  const usage = watch('usage');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['hp-entries', fy, viewUserId] });
    qc.invalidateQueries({ queryKey: ['hp-summary', fy, viewUserId] });
    qc.invalidateQueries({ queryKey: ['itr2-summary', fy, viewUserId] });
  };

  const createMutation = useMutation({
    mutationFn: (data: object) => taxApi.createHouseProperty(data),
    onSuccess: () => { invalidate(); setShowForm(false); reset(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => taxApi.updateHouseProperty(id, data),
    onSuccess: () => { invalidate(); setEditId(null); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => taxApi.deleteHouseProperty(id),
    onSuccess: invalidate,
  });

  const onSubmit = (data: EntryForm) => {
    const toNum = (v: any) => (v === '' || v == null) ? undefined : v;
    const payload = {
      ...data,
      grossAnnualRent: toNum(data.grossAnnualRent),
      municipalTaxesPaid: toNum(data.municipalTaxesPaid),
      homeLoanInterest: toNum(data.homeLoanInterest),
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
      propertyName: entry.propertyName,
      usage: entry.usage,
      grossAnnualRent: entry.grossAnnualRent ?? '',
      municipalTaxesPaid: entry.municipalTaxesPaid ?? '',
      homeLoanInterest: entry.homeLoanInterest ?? '',
      isPreConstruction: entry.isPreConstruction,
      notes: entry.notes ?? '',
    });
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      {summary && summary.properties.length > 0 && (
        <div className="space-y-4">
          {summary.properties.map((p) => {
            const raw = entries.find((e) => e.id === p.id);
            return (
            <div key={p.id} className="bg-white border rounded-lg p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-gray-900">{p.propertyName}</p>
                  <p className="text-xs text-gray-500">{USAGE_LABELS[p.usage as HousePropertyUsage]}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className={`text-lg font-semibold ${p.incomeFromHP < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {p.incomeFromHP < 0 ? '−' : ''}{formatCurrency(Math.abs(p.incomeFromHP))}
                    <span className="text-xs font-normal text-gray-400 ml-1">{p.incomeFromHP < 0 ? 'loss' : 'income'}</span>
                  </p>
                  {raw && !viewUserId && (
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => startEdit(raw)} className="text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => deleteMutation.mutate(p.id)} className="text-red-500 hover:underline">Delete</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-gray-600">
                <div><span className="text-xs text-gray-400 block">Gross Annual Value</span>{formatCurrency(p.grossAnnualValue)}</div>
                <div><span className="text-xs text-gray-400 block">Municipal Taxes</span>{formatCurrency(p.municipalTaxes)}</div>
                <div><span className="text-xs text-gray-400 block">30% Std Deduction</span>{formatCurrency(p.standardDeduction30Pct)}</div>
                <div><span className="text-xs text-gray-400 block">Loan Interest</span>{formatCurrency(p.interestOnLoan)}</div>
              </div>
            </div>
          );})}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`rounded-lg p-4 border ${summary.totalHPIncome < 0 ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
              <p className="text-xs text-gray-500">Total HP Income</p>
              <p className={`text-lg font-semibold mt-1 ${summary.totalHPIncome < 0 ? 'text-red-700' : 'text-blue-700'}`}>
                {summary.totalHPIncome < 0 ? '−' : ''}{formatCurrency(Math.abs(summary.totalHPIncome))}
              </p>
            </div>
            {summary.hpLossSetOff > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-xs text-gray-500">Loss Set-Off (Sec 71)</p>
                <p className="text-xs text-gray-400">Capped at ₹2L against salary</p>
                <p className="text-lg font-semibold text-green-700 mt-1">−{formatCurrency(summary.hpLossSetOff)}</p>
              </div>
            )}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-xs text-gray-500">Taxable HP Income</p>
              <p className="text-lg font-semibold text-blue-700 mt-1">{formatCurrency(summary.taxableHPIncome)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Add button — hidden when viewing another member's data */}
      <div className="flex justify-between items-center">
        <h3 className="font-medium text-gray-700">House Properties</h3>
        {!viewUserId && (
          <button
            onClick={() => { setShowForm(!showForm); setEditId(null); reset({ fyYear: fy }); }}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
          >
            + Add Property
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-gray-50 border rounded-lg p-4 space-y-4">
          <input type="hidden" {...register('fyYear')} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Property Name</label>
              <input {...register('propertyName')} className="input" placeholder="e.g. Flat in Mumbai" />
              {errors.propertyName && <p className="text-red-500 text-xs mt-1">{errors.propertyName.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Usage</label>
              <select {...register('usage')} className="input">
                <option value="">Select usage</option>
                {Object.entries(USAGE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              {errors.usage && <p className="text-red-500 text-xs mt-1">{errors.usage.message}</p>}
            </div>

            {usage !== 'SELF_OCCUPIED' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Gross Annual Rent (₹)</label>
                  <input type="number" step="0.01" {...register('grossAnnualRent')} className="input" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Municipal Taxes Paid (₹)</label>
                  <input type="number" step="0.01" {...register('municipalTaxesPaid')} className="input" />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Home Loan Interest (₹) — Sec 24(b)</label>
              <input type="number" step="0.01" {...register('homeLoanInterest')} className="input" />
              {usage === 'SELF_OCCUPIED' && (
                <p className="text-xs text-gray-400 mt-1">Capped at ₹2L for self-occupied (old regime only)</p>
              )}
            </div>

            <div className="flex items-center">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isPreConstruction')} />
                Pre-construction property (interest spread over 5 years)
              </label>
              {watch('isPreConstruction') && (
                <p className="text-xs text-amber-600 mt-1">
                  Pre-construction interest is deductible at 1/5th per year for 5 years after construction. Enter only the current-year portion in the Home Loan Interest field above.
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <input {...register('notes')} className="input" placeholder="Optional" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm">
              {editId ? 'Update' : 'Add Property'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); reset(); }} className="text-sm text-gray-600 hover:underline px-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      {entries.length === 0 && !showForm && (
        <p className="text-gray-500 text-sm text-center py-8">No house property entries for {fy}. Add your first property above.</p>
      )}
    </div>
  );
}
