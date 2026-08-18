import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import { useToast } from '@/contexts/ToastContext';
import { toDateInputValue, formatDate } from '@/lib/dateFormat';
import { assetsApi, ASSET_TYPES, type Asset } from '@/api/assets';

/**
 * Vehicles and other unsecured items — the one asset kind with no dedicated page before
 * this. `assetsApi` already had full CRUD (it backs the Loans page's collateral picker);
 * this page is the first place to reach it standalone, for something you own outright
 * with no loan attached.
 *
 * Deliberately excludes assets that represent a RealEstate or GoldHolding row — those
 * already have their own page (with the fuller purchase-price/date detail this generic
 * form doesn't collect), and showing the same property twice with two different edit
 * forms would invite the two records to disagree. Same filter net worth's own asset
 * query already applies, for the same reason.
 */

const assetSchema = z.object({
  assetType: z.string(),
  name: z.string().min(1, 'Required'),
  value: z.coerce.number().nonnegative(),
  notes: z.string().optional(),
});

type AssetForm = z.infer<typeof assetSchema>;

export default function AssetsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [sellingAsset, setSellingAsset] = useState<Asset | null>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [sellDate, setSellDate] = useState(toDateInputValue(new Date()));

  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingFamilyWide = isAdmin && !viewUserId;

  const { data: allAssets = [] } = useQuery({
    queryKey: ['assets', viewUserId],
    queryFn: () => assetsApi.getAll(viewUserId),
  });
  const assets = allAssets.filter((a) => !a.realEstateId && !a.goldHoldingId);

  const form = useForm<AssetForm>({ resolver: zodResolver(assetSchema), defaultValues: { assetType: 'VEHICLE', value: 0 } });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['report-networth'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['net-worth-history'] });
  };

  const closeForm = () => { setShowForm(false); setEditingAsset(null); form.reset({ assetType: 'VEHICLE', value: 0, name: '', notes: '' }); };

  const createMutation = useMutation({
    mutationFn: (data: AssetForm) => assetsApi.create(data, viewUserId ? { targetUserId: viewUserId } : undefined),
    onSuccess: () => { invalidate(); closeForm(); },
    onError: (err: any) => toast({ title: err?.response?.data?.message ?? 'Failed to add asset', variant: 'error' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: AssetForm }) => assetsApi.update(id, data),
    onSuccess: () => { invalidate(); closeForm(); },
    onError: (err: any) => toast({ title: err?.response?.data?.message ?? 'Failed to update asset', variant: 'error' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => assetsApi.delete(id),
    onSuccess: () => invalidate(),
    // The 409 from securing an active loan is the useful case to surface — without
    // this a blocked delete just silently does nothing.
    onError: (err: any) => toast({ title: err?.response?.data?.message ?? 'Failed to delete asset', variant: 'error' }),
  });

  const sellMutation = useMutation({
    mutationFn: ({ id, salePrice, date }: { id: string; salePrice: number; date: string }) =>
      assetsApi.sell(id, { salePrice, date }),
    onSuccess: () => {
      invalidate();
      setSellingAsset(null);
      setSellPrice('');
      toast({ title: 'Sale recorded', variant: 'success' });
    },
    onError: (err: any) => toast({ title: err?.response?.data?.message ?? 'Failed to record sale', variant: 'error' }),
  });

  const openEdit = (a: Asset) => {
    setEditingAsset(a);
    form.reset({ assetType: a.assetType, name: a.name, value: a.value, notes: a.notes ?? '' });
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Assets</h1>
          <p className="text-muted-foreground text-sm mt-1">Vehicles and other items you own outright.</p>
          {isAdmin && !isMembersLoading && (
            <div className="flex items-center gap-2 mt-2">
              <label htmlFor="assets-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
              {isMembersError ? (
                <span className="text-xs text-destructive">Could not load members</span>
              ) : (
                <select
                  id="assets-member-select"
                  value={viewUserId ?? ''}
                  onChange={(e) => setViewUserId(e.target.value || undefined)}
                  className="rounded-md border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="">All Family</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
        {!isViewingFamilyWide && (
          <Button size="sm" onClick={() => { setEditingAsset(null); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Asset
          </Button>
        )}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {assets.map((a) => (
          <div key={a.id} className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-full">
                    {ASSET_TYPES[a.assetType] ?? a.assetType}
                  </span>
                  {a.soldAt && (
                    <span className="text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full">
                      Sold {formatDate(a.soldAt)}
                    </span>
                  )}
                </div>
                <h3 className="font-semibold mt-1">{a.name}</h3>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(a)} title="Edit asset">
                  <Pencil className="h-4 w-4" />
                </Button>
                {!a.soldAt && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => { setSellingAsset(a); setSellPrice(String(a.value)); setSellDate(toDateInputValue(new Date())); }}
                    title="Record sale"
                  >
                    <span className="text-xs font-medium">Sell</span>
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(a.id)} title="Delete">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
            <div className="text-sm">
              {a.soldAt ? (
                <div><p className="text-muted-foreground">Sale Price</p><INRDisplay amount={a.salePrice ?? 0} className="font-semibold" /></div>
              ) : (
                <div><p className="text-muted-foreground">Value</p><INRDisplay amount={a.value} className="font-semibold" /></div>
              )}
            </div>
            {a.loans && a.loans.length > 0 && (
              <p className="text-xs text-muted-foreground border-t pt-2">
                Secures: {a.loans.map((l) => l.lenderName).join(', ')}
              </p>
            )}
            {a.notes && <p className="text-xs text-muted-foreground">{a.notes}</p>}
          </div>
        ))}
        {assets.length === 0 && (
          <div className="col-span-full text-center py-8 border rounded-lg text-muted-foreground">
            No assets added yet
          </div>
        )}
      </div>

      {sellingAsset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">Record sale — {sellingAsset.name}</h2>
            <p className="text-xs text-muted-foreground">
              This stays on the record, not erased. The item stops counting toward net
              worth going forward.
            </p>
            <div className="space-y-1">
              <Label htmlFor="asset-sell-price">Sale price (₹)</Label>
              <Input id="asset-sell-price" type="number" step="1000" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1">
              <Label htmlFor="asset-sell-date">Sale date</Label>
              <Input id="asset-sell-date" type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSellingAsset(null)}>Cancel</Button>
              <Button
                onClick={() => sellMutation.mutate({ id: sellingAsset.id, salePrice: Number(sellPrice), date: sellDate })}
                disabled={!sellPrice || Number(sellPrice) <= 0 || sellMutation.isPending}
              >
                {sellMutation.isPending ? 'Recording…' : 'Confirm sale'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-4">{editingAsset ? 'Edit Asset' : 'Add Asset'}</h2>
            <form
              onSubmit={form.handleSubmit((data) =>
                editingAsset ? updateMutation.mutate({ id: editingAsset.id, data }) : createMutation.mutate(data))}
              className="space-y-4"
            >
              <div className="space-y-1">
                <Label htmlFor="asset-type" required>Type</Label>
                <select id="asset-type" {...form.register('assetType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  {Object.entries(ASSET_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="asset-name" required>Name</Label>
                <Input id="asset-name" {...form.register('name')} placeholder="e.g. Honda City" />
                {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="asset-value" required>Current Value (₹)</Label>
                <Input id="asset-value" {...form.register('value')} type="number" step="1000" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="asset-notes">Notes (optional)</Label>
                <Input id="asset-notes" {...form.register('notes')} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingAsset ? 'Save' : 'Add'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
