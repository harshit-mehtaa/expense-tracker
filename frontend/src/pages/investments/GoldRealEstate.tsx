import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { investmentsApi, type GoldHolding } from '@/api/investments';

const GOLD_TYPES: Record<string, string> = {
  PHYSICAL: 'Physical Gold', SGB: 'Sovereign Gold Bond', GOLD_ETF: 'Gold ETF', DIGITAL: 'Digital Gold',
};

const PROPERTY_TYPES: Record<string, string> = {
  RESIDENTIAL: 'Residential', COMMERCIAL: 'Commercial', LAND: 'Land', PLOT: 'Plot',
};

const goldSchema = z.object({
  type: z.string(),
  description: z.string().optional(),
  quantityGrams: z.coerce.number().positive(),
  purchasePricePerGram: z.coerce.number().positive(),
  currentPricePerGram: z.coerce.number().positive(),
  purchaseDate: z.string(),
  notes: z.string().optional(),
});

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

type GoldForm = z.infer<typeof goldSchema>;
type PropertyForm = z.infer<typeof propertySchema>;

export default function GoldRealEstatePage() {
  const qc = useQueryClient();
  const [showGoldForm, setShowGoldForm] = useState(false);
  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [editingGoldId, setEditingGoldId] = useState<string | null>(null);
  const [editGoldValue, setEditGoldValue] = useState('');
  const [editingREId, setEditingREId] = useState<string | null>(null);
  const [editREValue, setEditREValue] = useState('');

  const { data: goldData } = useQuery({ queryKey: ['gold'], queryFn: investmentsApi.getGold });
  const { data: reData } = useQuery({ queryKey: ['realestate'], queryFn: investmentsApi.getRealEstate });

  const goldForm = useForm<GoldForm>({ resolver: zodResolver(goldSchema), defaultValues: { type: 'PHYSICAL' } });
  const propertyForm = useForm<PropertyForm>({ resolver: zodResolver(propertySchema), defaultValues: { propertyType: 'RESIDENTIAL' } });

  const createGoldMutation = useMutation({
    mutationFn: (data: GoldForm) => investmentsApi.createGold(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gold'] }); setShowGoldForm(false); goldForm.reset(); },
  });

  const deleteGoldMutation = useMutation({
    mutationFn: investmentsApi.deleteGold,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gold'] }),
  });

  const updateGoldPriceMutation = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) =>
      investmentsApi.updateGold(id, { currentPricePerGram: price }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gold'] }); setEditingGoldId(null); },
  });

  const updateREValueMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) =>
      investmentsApi.updateRealEstate(id, { currentValue: value }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['realestate'] }); setEditingREId(null); },
  });

  const createPropertyMutation = useMutation({
    mutationFn: (data: PropertyForm) => investmentsApi.createRealEstate(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['realestate'] }); setShowPropertyForm(false); propertyForm.reset(); },
  });

  const gold = goldData?.holdings ?? [];
  const goldSummary = goldData?.summary;
  const properties = reData?.properties ?? [];
  const reSummary = reData?.summary;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Gold & Real Estate</h1>

      {/* Gold Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Gold Holdings</h2>
          <Button size="sm" onClick={() => setShowGoldForm(true)}><Plus className="h-4 w-4 mr-1" /> Add Gold</Button>
        </div>

        {goldSummary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">Total Grams</p>
              <p className="text-2xl font-bold">{goldSummary.totalGrams.toFixed(2)}g</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">Current Value</p>
              <INRDisplay amount={goldSummary.totalCurrentValue} short className="text-2xl font-bold" />
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">Invested</p>
              <INRDisplay amount={goldSummary.totalPurchaseValue} className="text-2xl font-bold" />
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">P&L</p>
              <INRDisplay amount={goldSummary.gain} colorCode className="text-2xl font-bold" />
              <p className="text-sm text-muted-foreground">{goldSummary.gainPct.toFixed(2)}%</p>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gold.map((h) => (
            <div key={h.id} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs font-medium bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">
                    {GOLD_TYPES[h.type] ?? h.type}
                  </span>
                  {h.description && <p className="text-sm mt-1">{h.description}</p>}
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteGoldMutation.mutate(h.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-muted-foreground">Quantity</p><p className="font-semibold">{h.quantityGrams}g</p></div>
                <div><p className="text-muted-foreground">Current Value</p><INRDisplay amount={h.quantityGrams * h.currentPricePerGram} className="font-semibold" /></div>
                <div><p className="text-muted-foreground">Buy Rate</p><p>₹{h.purchasePricePerGram.toLocaleString('en-IN')}/g</p></div>
                <div>
                  <p className="text-muted-foreground">Current Rate</p>
                  {editingGoldId === h.id ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Input
                        type="number"
                        value={editGoldValue}
                        onChange={(e) => setEditGoldValue(e.target.value)}
                        className="h-7 w-24 text-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { const p = Number(editGoldValue); if (p > 0) updateGoldPriceMutation.mutate({ id: h.id, price: p }); }
                          if (e.key === 'Escape') setEditingGoldId(null);
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { const p = Number(editGoldValue); if (p > 0) updateGoldPriceMutation.mutate({ id: h.id, price: p }); }}>
                        <Check className="h-3 w-3 text-green-600" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingGoldId(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 group">
                      <p>₹{h.currentPricePerGram.toLocaleString('en-IN')}/g</p>
                      <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => { setEditingGoldId(h.id); setEditGoldValue(String(h.currentPricePerGram)); }} title="Update price">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {gold.length === 0 && (
            <div className="col-span-full text-center py-8 border rounded-lg text-muted-foreground">
              No gold holdings added yet
            </div>
          )}
        </div>
      </section>

      {/* Real Estate Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Real Estate</h2>
          <Button size="sm" onClick={() => setShowPropertyForm(true)}><Plus className="h-4 w-4 mr-1" /> Add Property</Button>
        </div>

        {reSummary && properties.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">Total Current Value</p>
              <INRDisplay amount={reSummary.totalCurrent} short className="text-2xl font-bold" />
            </div>
            <div><p className="text-sm text-muted-foreground p-4">Unrealised Gain</p>
              <INRDisplay amount={reSummary.unrealisedGain} colorCode short className="text-2xl font-bold px-4 pb-4" /></div>
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
      </section>

      {/* Add Gold Form */}
      {showGoldForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-4">Add Gold Holding</h2>
            <form onSubmit={goldForm.handleSubmit((data) => createGoldMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1 col-span-2">
                  <Label>Type</Label>
                  <select {...goldForm.register('type')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(GOLD_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1"><Label>Quantity (grams)</Label><Input {...goldForm.register('quantityGrams')} type="number" step="0.001" /></div>
                <div className="space-y-1"><Label>Buy Price (₹/g)</Label><Input {...goldForm.register('purchasePricePerGram')} type="number" step="0.01" /></div>
                <div className="space-y-1"><Label>Current Price (₹/g)</Label><Input {...goldForm.register('currentPricePerGram')} type="number" step="0.01" /></div>
                <div className="space-y-1"><Label>Purchase Date</Label><Input {...goldForm.register('purchaseDate')} type="date" /></div>
                <div className="col-span-2 space-y-1"><Label>Description (optional)</Label><Input {...goldForm.register('description')} /></div>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => { setShowGoldForm(false); goldForm.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createGoldMutation.isPending}>Add Gold</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Property Form */}
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
