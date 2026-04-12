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
import { investmentsApi } from '@/api/investments';

const GOLD_TYPES: Record<string, string> = {
  PHYSICAL: 'Physical Gold', SGB: 'Sovereign Gold Bond', GOLD_ETF: 'Gold ETF', DIGITAL: 'Digital Gold',
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

type GoldForm = z.infer<typeof goldSchema>;

export default function GoldPage() {
  const qc = useQueryClient();
  const [showGoldForm, setShowGoldForm] = useState(false);
  const [editingGoldId, setEditingGoldId] = useState<string | null>(null);
  const [editGoldValue, setEditGoldValue] = useState('');

  const { data: goldData } = useQuery({ queryKey: ['gold'], queryFn: investmentsApi.getGold });

  const goldForm = useForm<GoldForm>({ resolver: zodResolver(goldSchema), defaultValues: { type: 'PHYSICAL' } });

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

  const gold = goldData?.holdings ?? [];
  const goldSummary = goldData?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Gold Holdings</h1>
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
    </div>
  );
}
