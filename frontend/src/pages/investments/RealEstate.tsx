import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { investmentsApi } from '@/api/investments';

const PROPERTY_TYPES: Record<string, string> = {
  RESIDENTIAL: 'Residential', COMMERCIAL: 'Commercial', LAND: 'Land', PLOT: 'Plot',
};

const propertySchema = z.object({
  propertyType: z.string(),
  propertyName: z.string().min(1, 'Required'),
  location: z.string().min(1, 'Required'),
  purchasePrice: z.coerce.number().positive(),
  currentValue: z.coerce.number().positive(),
  purchaseDate: z.string(),
  rentalIncomeMonthly: z.coerce.number().optional(),
  notes: z.string().optional(),
});

type PropertyForm = z.infer<typeof propertySchema>;

export default function RealEstatePage() {
  const qc = useQueryClient();
  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [editingREId, setEditingREId] = useState<string | null>(null);
  const [editREValue, setEditREValue] = useState('');

  const { data: reData } = useQuery({ queryKey: ['realestate'], queryFn: investmentsApi.getRealEstate });

  const propertyForm = useForm<PropertyForm>({ resolver: zodResolver(propertySchema), defaultValues: { propertyType: 'RESIDENTIAL' } });

  const updateREValueMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) =>
      investmentsApi.updateRealEstate(id, { currentValue: value }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['realestate'] }); setEditingREId(null); },
  });

  const createPropertyMutation = useMutation({
    mutationFn: (data: PropertyForm) => investmentsApi.createRealEstate(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['realestate'] }); setShowPropertyForm(false); propertyForm.reset(); },
  });

  const properties = reData?.properties ?? [];
  const reSummary = reData?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Real Estate</h1>
        <Button size="sm" onClick={() => setShowPropertyForm(true)}><Plus className="h-4 w-4 mr-1" /> Add Property</Button>
      </div>

      {reSummary && properties.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Current Value</p>
            <INRDisplay amount={reSummary.totalCurrent} short className="text-2xl font-bold" />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Unrealised Gain</p>
            <INRDisplay amount={reSummary.unrealisedGain} colorCode short className="text-2xl font-bold" />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Monthly Rental</p>
            <INRDisplay amount={reSummary.totalMonthlyRental} className="text-2xl font-bold text-green-600" />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Properties</p>
            <p className="text-2xl font-bold">{properties.length}</p>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {properties.map((p: any) => (
          <div key={p.id} className="rounded-lg border bg-card p-5 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-medium bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                  {PROPERTY_TYPES[p.propertyType] ?? p.propertyType}
                </span>
                <h3 className="font-semibold mt-1">{p.propertyName}</h3>
                <p className="text-sm text-muted-foreground">{p.location}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><p className="text-muted-foreground">Purchase Price</p><INRDisplay amount={p.purchasePrice} /></div>
              <div>
                <p className="text-muted-foreground">Current Value</p>
                {editingREId === p.id ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Input
                      type="number"
                      step="1000"
                      value={editREValue}
                      onChange={(e) => setEditREValue(e.target.value)}
                      className="h-7 w-28 text-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { const v = Number(editREValue); if (v > 0) updateREValueMutation.mutate({ id: p.id, value: v }); }
                        if (e.key === 'Escape') setEditingREId(null);
                      }}
                    />
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { const v = Number(editREValue); if (v > 0) updateREValueMutation.mutate({ id: p.id, value: v }); }}>
                      <Check className="h-3 w-3 text-green-600" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingREId(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 group">
                    <INRDisplay amount={p.currentValue} className="text-green-600 font-semibold" />
                    <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => { setEditingREId(p.id); setEditREValue(String(p.currentValue)); }} title="Update value">
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
              <div><p className="text-muted-foreground">Unrealised Gain</p><INRDisplay amount={p.currentValue - p.purchasePrice} colorCode /></div>
              {p.rentalIncomeMonthly && <div><p className="text-muted-foreground">Monthly Rental</p><INRDisplay amount={p.rentalIncomeMonthly} /></div>}
            </div>
            {p.loan && (
              <p className="text-xs text-muted-foreground">Linked Loan: {p.loan.lenderName} · <INRDisplay amount={p.loan.outstandingBalance} className="text-xs" /> outstanding</p>
            )}
          </div>
        ))}
        {properties.length === 0 && (
          <div className="col-span-full text-center py-8 border rounded-lg text-muted-foreground">
            No properties added yet
          </div>
        )}
      </div>

      {showPropertyForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Add Property</h2>
            <form onSubmit={propertyForm.handleSubmit((data) => createPropertyMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Type</Label>
                  <select {...propertyForm.register('propertyType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(PROPERTY_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1"><Label>Property Name</Label><Input {...propertyForm.register('propertyName')} placeholder="e.g. Flat 4B, Andheri West" /></div>
                <div className="space-y-1 col-span-2"><Label>Location</Label><Input {...propertyForm.register('location')} placeholder="City, State" /></div>
                <div className="space-y-1"><Label>Purchase Price (₹)</Label><Input {...propertyForm.register('purchasePrice')} type="number" /></div>
                <div className="space-y-1"><Label>Current Value (₹)</Label><Input {...propertyForm.register('currentValue')} type="number" /></div>
                <div className="space-y-1"><Label>Purchase Date</Label><Input {...propertyForm.register('purchaseDate')} type="date" /></div>
                <div className="space-y-1"><Label>Monthly Rental (₹)</Label><Input {...propertyForm.register('rentalIncomeMonthly')} type="number" placeholder="0 if not rented" /></div>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => { setShowPropertyForm(false); propertyForm.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createPropertyMutation.isPending}>Add Property</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
