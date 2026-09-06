import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Car, Gem } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { cn } from '@/lib/utils';
import { toDateInputValue, formatDate } from '@/lib/dateFormat';
import { assetsApi, ASSET_TYPES, VEHICLE_TYPES, FUEL_TYPES, type Asset } from '@/api/assets';
import { insuranceApi } from '@/api/insurance';
import GoldPage from '@/pages/investments/Gold';

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
 *
 * Gold lives here as a second, URL-backed tab (`?tab=gold`) rendering the untouched
 * `GoldPage` component — same pattern as Transactions.tsx's `?tab=recurring`. GoldPage
 * is not merged into this file: it keeps its own coverage measurement and its own
 * member-selector/heading, matching the Transactions/RecurringRules precedent, which
 * accepts two independent member selectors and two <h1>s across the pair of tabs
 * (see Transactions.test.tsx) rather than forcing one page's identity onto the other.
 */

const assetSchema = z.object({
  assetType: z.string(),
  name: z.string().min(1, 'Required'),
  value: z.coerce.number().nonnegative(),
  notes: z.string().optional(),
  purchaseDate: z.string().optional(),
  vehicleType: z.string().optional(),
  registrationNumber: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  // Not required, unlike vehicleType — no pre-existing vehicle has a fuelType to
  // backfill from, so requiring it would break editing every vehicle added before it.
  fuelType: z.string().optional(),
  insurancePolicyId: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.assetType === 'VEHICLE' && !val.vehicleType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicleType'], message: 'Required for a vehicle' });
  }
});

type AssetForm = z.infer<typeof assetSchema>;

const EMPTY_ASSET_FORM = { assetType: 'VEHICLE', value: 0, name: '', notes: '' } as const;

export default function AssetsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [sellingAsset, setSellingAsset] = useState<Asset | null>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [sellDate, setSellDate] = useState(toDateInputValue(new Date()));

  const { user } = useAuth();
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingFamilyWide = isAdmin && !viewUserId;

  // Explicit equality, not `?? 'assets'`: any value other than the literal 'gold'
  // (including a bogus/stale query param) must fall back to the assets tab, never
  // render neither.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'gold' ? 'gold' : 'assets';
  function setActiveTab(tab: 'assets' | 'gold') {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'assets') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  }

  const { data: allAssets = [] } = useQuery({
    queryKey: ['assets', viewUserId],
    queryFn: () => assetsApi.getAll(viewUserId),
    enabled: activeTab === 'assets',
  });
  const assets = allAssets.filter((a) => !a.realEstateId && !a.goldHoldingId);

  const form = useForm<AssetForm>({ resolver: zodResolver(assetSchema), defaultValues: EMPTY_ASSET_FORM });
  const watchedAssetType = form.watch('assetType');

  // Defense-in-depth, not a currently-reachable path: tab switches go through
  // setActiveTab ({replace:true}), so browser Back can't return here mid-modal, and
  // the full-screen modal overlays currently obscure the tab bar anyway. Kept so a
  // future navigation path (or a modal that stops being full-screen) can't leave a
  // stale/possibly-deleted asset id sitting in state, silently resubmitted later.
  useEffect(() => {
    if (activeTab !== 'assets') {
      setShowForm(false);
      setEditingAsset(null);
      setSellingAsset(null);
      form.reset(EMPTY_ASSET_FORM);
    }
  }, [activeTab, form]);

  // Who the linked policy must belong to — the asset's actual owner when editing (not
  // necessarily the requester, e.g. an ADMIN editing a member's asset), else whoever the
  // member selector is currently scoped to, else the current user. Fetched server-side
  // scoped via targetUserId (mirroring the gold-holding picker in Loans.tsx) rather than
  // an unscoped family-wide fetch filtered client-side — the latter would ship every
  // other member's sumAssured/policyNumber/nomineeName into the browser just to filter
  // it away, and an admin editing one member's vehicle in family-wide view would see a
  // DIFFERENT member's policies in the picker.
  const policyOwnerId = editingAsset?.userId ?? viewUserId ?? user?.id;
  // Cached under the SAME key Insurance.tsx uses for the full list ['insurance', X] —
  // deliberately fetching and caching the unfiltered list here too (VEHICLE-filtering
  // happens below, after the query, not inside queryFn) so this entry stays consistent
  // with what Insurance.tsx itself caches, rather than poisoning a shared key with a
  // narrowed list (see Loans.tsx's identical insurance query for the bug this avoids).
  const { data: allPolicies = [], isError: isPoliciesError } = useQuery({
    queryKey: ['insurance', policyOwnerId],
    queryFn: () => insuranceApi.getAll(policyOwnerId ? { targetUserId: policyOwnerId } : undefined),
    enabled: showForm && watchedAssetType === 'VEHICLE',
  });
  const vehiclePolicies = allPolicies.filter((p) => p.policyType === 'VEHICLE');
  const watchedInsurancePolicyId = form.watch('insurancePolicyId');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['report-networth'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['net-worth-history'] });
    // A create/update/delete/sell here can change what a linked policy's
    // "Covers:" list shows on the Insurance page.
    qc.invalidateQueries({ queryKey: ['insurance'] });
  };

  const closeForm = () => { setShowForm(false); setEditingAsset(null); form.reset(EMPTY_ASSET_FORM); };

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
    form.reset({
      assetType: a.assetType,
      name: a.name,
      value: a.value,
      notes: a.notes ?? '',
      purchaseDate: a.purchaseDate ? toDateInputValue(new Date(a.purchaseDate)) : '',
      vehicleType: a.vehicleType ?? '',
      registrationNumber: a.registrationNumber ?? '',
      make: a.make ?? '',
      model: a.model ?? '',
      fuelType: a.fuelType ?? '',
      insurancePolicyId: a.insurancePolicyId ?? '',
    });
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Assets</h1>
          {activeTab === 'assets' && (
            <>
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
            </>
          )}
        </div>
        {activeTab === 'assets' && !isViewingFamilyWide && (
          <Button size="sm" onClick={() => { setEditingAsset(null); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Asset
          </Button>
        )}
      </div>

      {/* Tab switcher — Gold lives here as a second tab instead of its own nav item;
          GoldPage is untouched, rendered as-is below. */}
      <div className="flex border-b border-border">
        {(['assets', 'gold'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
            )}
          >
            {tab === 'assets' ? <Car className="h-4 w-4" /> : <Gem className="h-4 w-4" />}
            {tab === 'assets' ? 'Assets' : 'Gold'}
          </button>
        ))}
      </div>

      {activeTab === 'gold' && <GoldPage />}

      {activeTab === 'assets' && (
      <>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {assets.map((a) => (
          <div key={a.id} className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-full">
                    {ASSET_TYPES[a.assetType] ?? a.assetType}
                  </span>
                  {a.assetType === 'VEHICLE' && a.vehicleType && (
                    <span className="text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-full">
                      {VEHICLE_TYPES[a.vehicleType]}
                    </span>
                  )}
                  {a.assetType === 'VEHICLE' && a.fuelType && (
                    <span className="text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-full">
                      {FUEL_TYPES[a.fuelType]}
                    </span>
                  )}
                  {a.soldAt && (
                    <span className="text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full">
                      Sold {formatDate(a.soldAt)}
                    </span>
                  )}
                </div>
                <h3 className="font-semibold mt-1">{a.name}</h3>
                {(a.make || a.model) && (
                  <p className="text-xs text-muted-foreground">{[a.make, a.model].filter(Boolean).join(' ')}</p>
                )}
                {a.registrationNumber && (
                  <p className="text-xs text-muted-foreground">{a.registrationNumber}</p>
                )}
                {a.purchaseDate && (
                  <p className="text-xs text-muted-foreground">Bought {formatDate(a.purchaseDate)}</p>
                )}
                {a.insurancePolicy && (
                  <p className="text-xs text-muted-foreground">
                    {a.insurancePolicy.providerName} · {a.insurancePolicy.policyName}
                    {a.insurancePolicy.endDate && ` (till ${formatDate(a.insurancePolicy.endDate)})`}
                  </p>
                )}
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
                {/* GOLD is excluded here — a real gold holding belongs on the Gold tab
                    (grams/price-per-gram/P&L), and letting this generic form create a
                    bare GOLD asset would be a strictly worse duplicate record. Kept
                    selectable only when editing an asset that is ALREADY GOLD (created
                    via the Loans collateral picker, which still offers the full
                    ASSET_TYPES map — that flow is unaffected by this exclusion), so an
                    uncontrolled <select> can't silently fall back to its first option
                    and rewrite the asset's type on save. */}
                <select id="asset-type" {...form.register('assetType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  {Object.entries(ASSET_TYPES)
                    .filter(([v]) => v !== 'GOLD' || editingAsset?.assetType === 'GOLD')
                    .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
              {watchedAssetType === 'VEHICLE' && (
                <div className="space-y-1">
                  <Label htmlFor="asset-vehicle-type" required>Vehicle Type</Label>
                  <select id="asset-vehicle-type" {...form.register('vehicleType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="">Select…</option>
                    {Object.entries(VEHICLE_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {form.formState.errors.vehicleType && <p className="text-xs text-destructive">{form.formState.errors.vehicleType.message}</p>}
                </div>
              )}
              {watchedAssetType === 'VEHICLE' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="asset-make">Make (optional)</Label>
                      <Input id="asset-make" {...form.register('make')} placeholder="Honda" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="asset-model">Model (optional)</Label>
                      <Input id="asset-model" {...form.register('model')} placeholder="City" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asset-registration">Registration Number (optional)</Label>
                    <Input id="asset-registration" {...form.register('registrationNumber')} placeholder="KA01AB1234" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asset-fuel-type">Fuel Type (optional)</Label>
                    <select id="asset-fuel-type" {...form.register('fuelType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                      <option value="">Select…</option>
                      {Object.entries(FUEL_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asset-insurance">Insurance Policy (optional)</Label>
                    {/* Controlled, unlike vehicleType/fuelType above: those two select
                        from static maps that render synchronously on mount, so RHF's
                        register-driven uncontrolled value applies cleanly. This one's
                        options arrive from an async query gated on the form being open,
                        so an uncontrolled select would apply openEdit's reset value
                        before the matching <option> exists and silently fail to select
                        it once the options do arrive. */}
                    <select
                      id="asset-insurance"
                      {...form.register('insurancePolicyId')}
                      value={watchedInsurancePolicyId ?? ''}
                      onChange={(e) => form.setValue('insurancePolicyId', e.target.value)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Not linked</option>
                      {vehiclePolicies.map((p) => (
                        <option key={p.id} value={p.id}>{p.providerName} · {p.policyName}</option>
                      ))}
                    </select>
                    {isPoliciesError && (
                      <p className="text-xs text-destructive">
                        Couldn't load insurance policies — an existing link won't show here, but is unaffected.
                      </p>
                    )}
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label htmlFor="asset-purchase-date">Purchase Date (optional)</Label>
                <Input id="asset-purchase-date" {...form.register('purchaseDate')} type="date" />
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
      </>
      )}
    </div>
  );
}
