import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Check, X, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import { useAuth } from '@/contexts/AuthContext';
import { investmentsApi, type RealEstateProperty } from '@/api/investments';
import { useToast } from '@/contexts/ToastContext';
import { formatDate, toDateInputValue } from '@/lib/dateFormat';

const PROPERTY_TYPES: Record<string, string> = {
  RESIDENTIAL: 'Residential', COMMERCIAL: 'Commercial', LAND: 'Land', PLOT: 'Plot',
};

const ownerSchema = z.object({
  userId: z.string().min(1, 'Owner required'),
  sharePercent: z.coerce.number().positive('Share must be greater than 0').max(100, 'Share cannot exceed 100'),
});

const ownersSchema = z.array(ownerSchema).min(1, 'Add at least one owner').superRefine((owners, ctx) => {
  const seen = new Set<string>();
  owners.forEach((owner, index) => {
    if (seen.has(owner.userId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Owner already added', path: [index, 'userId'] });
    }
    seen.add(owner.userId);
  });

  const total = owners.reduce((sum, owner) => sum + Number(owner.sharePercent || 0), 0);
  if (Math.abs(total - 100) > 0.01) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Owner shares must add up to 100%' });
  }
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
  owners: ownersSchema,
});

const ownersEditorSchema = z.object({ owners: ownersSchema });

type PropertyForm = z.infer<typeof propertySchema>;
type OwnersForm = z.infer<typeof ownersEditorSchema>;

export default function RealEstatePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [editingProperty, setEditingProperty] = useState<RealEstateProperty | null>(null);
  const [editingREId, setEditingREId] = useState<string | null>(null);
  const [editREValue, setEditREValue] = useState('');
  const [editingOwnersProperty, setEditingOwnersProperty] = useState<RealEstateProperty | null>(null);
  const [sellingProperty, setSellingProperty] = useState<RealEstateProperty | null>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [sellDate, setSellDate] = useState(toDateInputValue(new Date()));
  const { toast } = useToast();

  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingFamilyWide = isAdmin && !viewUserId;
  const ownerOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    if (user) byId.set(user.id, { id: user.id, name: user.name });
    members.forEach((member) => byId.set(member.id, { id: member.id, name: member.name }));
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [members, user]);

  const getDefaultOwnerRows = () => [{ userId: viewUserId ?? user?.id ?? ownerOptions[0]?.id ?? '', sharePercent: 100 }];
  const getDefaultPropertyValues = () => ({
    propertyType: 'RESIDENTIAL',
    propertyName: '',
    location: '',
    purchasePrice: '',
    currentValue: '',
    purchaseDate: '',
    rentalIncomeMonthly: '',
    notes: '',
    owners: getDefaultOwnerRows(),
  }) as any;

  const { data: reData } = useQuery({
    queryKey: ['realestate', viewUserId],
    queryFn: () => investmentsApi.getRealEstate(viewUserId ? { targetUserId: viewUserId } : undefined),
  });

  const propertyForm = useForm<PropertyForm>({ resolver: zodResolver(propertySchema), defaultValues: getDefaultPropertyValues() });
  const propertyOwnerFields = useFieldArray({ control: propertyForm.control, name: 'owners' });
  const ownersForm = useForm<OwnersForm>({ resolver: zodResolver(ownersEditorSchema), defaultValues: { owners: getDefaultOwnerRows() } });
  const editOwnerFields = useFieldArray({ control: ownersForm.control, name: 'owners' });
  const propertyOwners = propertyForm.watch('owners') ?? [];
  const editOwners = ownersForm.watch('owners') ?? [];
  const propertyOwnerTotal = propertyOwners.reduce((sum, owner) => sum + Number(owner.sharePercent || 0), 0);
  const editOwnerTotal = editOwners.reduce((sum, owner) => sum + Number(owner.sharePercent || 0), 0);

  const invalidateRE = () => qc.invalidateQueries({ queryKey: ['realestate'] });

  const updateREValueMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) =>
      investmentsApi.updateRealEstate(id, { currentValue: value }),
    onSuccess: () => { invalidateRE(); setEditingREId(null); },
  });

  const sellMutation = useMutation({
    mutationFn: ({ id, salePrice, date }: { id: string; salePrice: number; date: string }) =>
      investmentsApi.sellRealEstate(id, { salePrice, date }),
    onSuccess: () => {
      // Net worth reads currentValue live, so the sold property must stop counting —
      // invalidating just ['realestate'] would leave a stale dashboard figure.
      invalidateRE();
      qc.invalidateQueries({ queryKey: ['report-networth'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['net-worth-history'] });
      setSellingProperty(null);
      setSellPrice('');
      toast({ title: 'Sale recorded', variant: 'success' });
    },
    onError: (err: any) => {
      // The loan-collateral guard surfaces here as a 409 with a specific reason —
      // without this the click would just silently do nothing.
      toast({ title: err?.response?.data?.message ?? 'Failed to record sale', variant: 'error' });
    },
  });

  const createPropertyMutation = useMutation({
    mutationFn: (data: PropertyForm) => investmentsApi.createRealEstate(data, viewUserId ? { targetUserId: viewUserId } : undefined),
    onSuccess: () => { invalidateRE(); setShowPropertyForm(false); setEditingProperty(null); propertyForm.reset(getDefaultPropertyValues()); },
  });

  const updatePropertyMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PropertyForm }) => investmentsApi.updateRealEstate(id, data),
    onSuccess: () => { invalidateRE(); setShowPropertyForm(false); setEditingProperty(null); propertyForm.reset(getDefaultPropertyValues()); },
  });

  const updateOwnersMutation = useMutation({
    mutationFn: ({ id, owners }: { id: string; owners: OwnersForm['owners'] }) =>
      investmentsApi.updateRealEstate(id, { owners }),
    onSuccess: () => { invalidateRE(); setEditingOwnersProperty(null); },
  });

  const properties = reData?.properties ?? [];
  const reSummary = reData?.summary;

  const getNextOwnerId = (owners: { userId: string }[]) =>
    ownerOptions.find((option) => !owners.some((owner) => owner.userId === option.id))?.id ?? '';

  const openAddPropertyForm = () => {
    setEditingProperty(null);
    propertyForm.reset(getDefaultPropertyValues());
    setShowPropertyForm(true);
  };

  const openEditPropertyForm = (property: RealEstateProperty) => {
    setEditingProperty(property);
    setEditingREId(null);
    propertyForm.reset({
      propertyType: property.propertyType,
      propertyName: property.propertyName,
      location: property.location,
      purchasePrice: property.purchasePrice,
      currentValue: property.currentValue,
      purchaseDate: property.purchaseDate?.slice(0, 10),
      rentalIncomeMonthly: property.rentalIncomeMonthly ?? '',
      notes: property.notes ?? '',
      owners: property.owners?.length
        ? property.owners.map((owner) => ({ userId: owner.userId, sharePercent: Number(owner.sharePercent) }))
        : [{ userId: property.userId || ownerOptions[0]?.id || user?.id || '', sharePercent: 100 }],
    } as any);
    setShowPropertyForm(true);
  };

  const closePropertyForm = () => {
    setShowPropertyForm(false);
    setEditingProperty(null);
    propertyForm.reset(getDefaultPropertyValues());
  };

  const openOwnersEditor = (property: RealEstateProperty) => {
    setEditingOwnersProperty(property);
    ownersForm.reset({
      owners: property.owners?.length
        ? property.owners.map((owner) => ({ userId: owner.userId, sharePercent: Number(owner.sharePercent) }))
        : [{ userId: property.userId || ownerOptions[0]?.id || user?.id || '', sharePercent: 100 }],
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Real Estate</h1>
          {isAdmin && !isMembersLoading && (
            <div className="flex items-center gap-2 mt-2">
              <label htmlFor="re-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
              {isMembersError ? (
                <span className="text-xs text-destructive">Could not load members</span>
              ) : (
                <select
                  id="re-member-select"
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
          <Button size="sm" onClick={openAddPropertyForm}><Plus className="h-4 w-4 mr-1" /> Add Property</Button>
        )}
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
        {properties.map((p: RealEstateProperty) => (
          <div key={p.id} className="rounded-lg border bg-card p-5 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                    {PROPERTY_TYPES[p.propertyType] ?? p.propertyType}
                  </span>
                  {/* There was no delete action on this page at all before this — this
                      badge, and the Sell button below, are the property's first and only
                      lifecycle action. */}
                  {p.soldAt && (
                    <span className="text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 rounded-full">
                      Sold {formatDate(p.soldAt)}
                    </span>
                  )}
                </div>
                <h3 className="font-semibold mt-1">{p.propertyName}</h3>
                <p className="text-sm text-muted-foreground">{p.location}</p>
                {isViewingFamilyWide && p.userName && (
                  <p className="text-xs text-muted-foreground mt-0.5">{p.userName}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => openEditPropertyForm(p)} title="Edit property">
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => openOwnersEditor(p)} title="Edit owners">
                  <Users className="h-4 w-4 mr-1" /> Owners
                </Button>
                {!p.soldAt && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setSellingProperty(p); setSellPrice(String(p.currentValue)); setSellDate(toDateInputValue(new Date())); }}
                    title="Record sale"
                  >
                    Sell
                  </Button>
                )}
              </div>
            </div>
            {p.owners?.length > 0 && (
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Owners</p>
                <div className="flex flex-wrap gap-1.5">
                  {p.owners.map((owner) => (
                    <span key={owner.userId} className="text-xs rounded-full border bg-background px-2 py-0.5">
                      {owner.name || owner.email || 'Owner'} {owner.sharePercent}%
                    </span>
                  ))}
                </div>
                {p.sharePercent != null && p.sharePercent < 100 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This view counts {p.sharePercent}% of this property:
                    {' '}
                    <INRDisplay amount={p.currentValueShare ?? 0} className="text-xs font-medium" />
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><p className="text-muted-foreground">Purchase Price</p><INRDisplay amount={p.purchasePrice} /></div>
              {p.soldAt ? (
                <>
                  <div><p className="text-muted-foreground">Sale Price</p><INRDisplay amount={p.salePrice ?? 0} className="font-semibold" /></div>
                  <div><p className="text-muted-foreground">Realised Gain</p><INRDisplay amount={(p.salePrice ?? 0) - p.purchasePrice} colorCode /></div>
                </>
              ) : (
                <>
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
                </>
              )}
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

      {sellingProperty && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">Record sale — {sellingProperty.propertyName}</h2>
            <p className="text-xs text-muted-foreground">
              This stays on the record — purchase price, date and location are kept, not
              erased. The property stops counting toward net worth going forward.
            </p>
            <div className="space-y-1">
              <Label htmlFor="sell-price">Sale price (₹)</Label>
              <Input
                id="sell-price"
                type="number"
                step="1000"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sell-date">Sale date</Label>
              <Input id="sell-date" type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSellingProperty(null)}>Cancel</Button>
              <Button
                onClick={() => sellMutation.mutate({ id: sellingProperty.id, salePrice: Number(sellPrice), date: sellDate })}
                disabled={!sellPrice || Number(sellPrice) <= 0 || sellMutation.isPending}
              >
                {sellMutation.isPending ? 'Recording…' : 'Confirm sale'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showPropertyForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">{editingProperty ? 'Edit Property' : 'Add Property'}</h2>
            <form
              onSubmit={propertyForm.handleSubmit((data) => {
                if (editingProperty) updatePropertyMutation.mutate({ id: editingProperty.id, data });
                else createPropertyMutation.mutate(data);
              })}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label required>Type</Label>
                  <select {...propertyForm.register('propertyType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(PROPERTY_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1"><Label required>Property Name</Label><Input {...propertyForm.register('propertyName')} placeholder="e.g. Flat 4B, Andheri West" /></div>
                <div className="space-y-1 col-span-2"><Label required>Location</Label><Input {...propertyForm.register('location')} placeholder="City, State" /></div>
                <div className="space-y-1"><Label required>Purchase Price (₹)</Label><Input {...propertyForm.register('purchasePrice')} type="number" /></div>
                <div className="space-y-1"><Label required>Current Value (₹)</Label><Input {...propertyForm.register('currentValue')} type="number" /></div>
                <div className="space-y-1"><Label required>Purchase Date</Label><Input {...propertyForm.register('purchaseDate')} type="date" /></div>
                <div className="space-y-1"><Label>Monthly Rental (₹)</Label><Input {...propertyForm.register('rentalIncomeMonthly')} type="number" placeholder="0 if not rented" /></div>
                <div className="space-y-1 col-span-2"><Label>Notes (optional)</Label><Input {...propertyForm.register('notes')} placeholder="Optional" /></div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label required>Owners</Label>
                  <span className={`text-xs ${Math.abs(propertyOwnerTotal - 100) <= 0.01 ? 'text-muted-foreground' : 'text-destructive'}`}>
                    Total {propertyOwnerTotal || 0}%
                  </span>
                </div>
                <div className="space-y-2">
                  {propertyOwnerFields.fields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-[1fr_120px_32px] gap-2 items-start">
                      <div>
                        <select {...propertyForm.register(`owners.${index}.userId`)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                          <option value="">Select owner</option>
                          {ownerOptions.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                        </select>
                        {propertyForm.formState.errors.owners?.[index]?.userId && (
                          <p className="text-xs text-destructive mt-1">{propertyForm.formState.errors.owners[index]?.userId?.message}</p>
                        )}
                      </div>
                      <div>
                        <Input {...propertyForm.register(`owners.${index}.sharePercent`)} type="number" min="0" max="100" step="0.01" placeholder="%" />
                        {propertyForm.formState.errors.owners?.[index]?.sharePercent && (
                          <p className="text-xs text-destructive mt-1">{propertyForm.formState.errors.owners[index]?.sharePercent?.message}</p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={propertyOwnerFields.fields.length === 1}
                        onClick={() => propertyOwnerFields.remove(index)}
                        title="Remove owner"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                {propertyForm.formState.errors.owners?.message && (
                  <p className="text-xs text-destructive">{propertyForm.formState.errors.owners.message}</p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => propertyOwnerFields.append({ userId: getNextOwnerId(propertyOwners), sharePercent: 0 })}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Owner
                </Button>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={closePropertyForm}>Cancel</Button>
                <Button type="submit" disabled={createPropertyMutation.isPending || updatePropertyMutation.isPending}>
                  {createPropertyMutation.isPending || updatePropertyMutation.isPending ? 'Saving…' : editingProperty ? 'Save Property' : 'Add Property'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingOwnersProperty && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-xl p-6">
            <h2 className="text-xl font-semibold mb-1">Edit Owners</h2>
            <p className="text-sm text-muted-foreground mb-4">{editingOwnersProperty.propertyName}</p>
            <form
              onSubmit={ownersForm.handleSubmit((data) => updateOwnersMutation.mutate({ id: editingOwnersProperty.id, owners: data.owners }))}
              className="space-y-4"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label required>Ownership Share</Label>
                  <span className={`text-xs ${Math.abs(editOwnerTotal - 100) <= 0.01 ? 'text-muted-foreground' : 'text-destructive'}`}>
                    Total {editOwnerTotal || 0}%
                  </span>
                </div>
                {editOwnerFields.fields.map((field, index) => (
                  <div key={field.id} className="grid grid-cols-[1fr_120px_32px] gap-2 items-start">
                    <div>
                      <select {...ownersForm.register(`owners.${index}.userId`)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                        <option value="">Select owner</option>
                        {ownerOptions.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                      </select>
                      {ownersForm.formState.errors.owners?.[index]?.userId && (
                        <p className="text-xs text-destructive mt-1">{ownersForm.formState.errors.owners[index]?.userId?.message}</p>
                      )}
                    </div>
                    <div>
                      <Input {...ownersForm.register(`owners.${index}.sharePercent`)} type="number" min="0" max="100" step="0.01" placeholder="%" />
                      {ownersForm.formState.errors.owners?.[index]?.sharePercent && (
                        <p className="text-xs text-destructive mt-1">{ownersForm.formState.errors.owners[index]?.sharePercent?.message}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={editOwnerFields.fields.length === 1}
                      onClick={() => editOwnerFields.remove(index)}
                      title="Remove owner"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {ownersForm.formState.errors.owners?.message && (
                  <p className="text-xs text-destructive">{ownersForm.formState.errors.owners.message}</p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => editOwnerFields.append({ userId: getNextOwnerId(editOwners), sharePercent: 0 })}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Owner
                </Button>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setEditingOwnersProperty(null)}>Cancel</Button>
                <Button type="submit" disabled={updateOwnersMutation.isPending}>Save Owners</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
