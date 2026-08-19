import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, Plus, Trash2, Edit2, Phone, User, Calendar, CheckCircle2, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { insuranceApi, type InsurancePolicy } from '@/api/insurance';
import { assetsApi } from '@/api/assets';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { cn } from '@/lib/utils';
import { formatDate, formatNextOccurrence } from '@/lib/dateFormat';

const POLICY_TYPE_LABELS: Record<string, string> = {
  TERM_LIFE: 'Term Life', ENDOWMENT: 'Endowment', ULIP: 'ULIP',
  WHOLE_LIFE: 'Whole Life', HEALTH: 'Health / Mediclaim', SUPER_TOP_UP: 'Super Top-Up',
  CRITICAL_ILLNESS: 'Critical Illness', PERSONAL_ACCIDENT: 'Personal Accident',
  VEHICLE: 'Vehicle', HOME: 'Home', TRAVEL: 'Travel',
};

const FREQ_LABELS: Record<string, string> = {
  MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', HALF_YEARLY: 'Half-Yearly',
  ANNUALLY: 'Annually', SINGLE: 'Single Premium',
};

const policySchema = z.object({
  policyType: z.string(),
  providerName: z.string().min(1, 'Required'),
  policyNumber: z.string().min(1, 'Required'),
  policyName: z.string().min(1, 'Required'),
  sumAssured: z.coerce.number().positive(),
  premiumAmount: z.coerce.number().positive(),
  premiumFrequency: z.string(),
  // A blank input posts '' — z.coerce.number() reads that as Number('') === 0 BEFORE
  // .optional() ever runs, so leaving this genuinely-optional field blank failed
  // .min(1) with no visible error message (this component never rendered one for this
  // field) and silently blocked every submit.
  //
  // Preprocesses to `null`, not `undefined`: this form always sends every field (never
  // a partial diff), so an `undefined` here would be dropped by JSON.stringify and the
  // backend's `.partial()` PUT would read the key as "not sent" (no change) rather
  // than "cleared" — silently leaving a stale value in place. `null` survives
  // serialization and the backend now accepts it as an explicit clear
  // (backend/src/routes/insurance.ts).
  premiumDueDate: z.preprocess(
    (v) => (v === '' || v == null ? null : Number(v)),
    z.union([z.number().int().min(1).max(31), z.null()]),
  ),
  startDate: z.string(),
  endDate: z.string().optional(),
  nomineeName: z.string().optional(),
  agentName: z.string().optional(),
  agentContact: z.string().optional(),
  is80cEligible: z.boolean().default(false),
  is80dEligible: z.boolean().default(false),
  isForParents: z.boolean().default(false),
  notes: z.string().optional(),
});

type PolicyForm = z.infer<typeof policySchema>;

function getAnnualPremium(policy: InsurancePolicy): number {
  const m: Record<string, number> = { MONTHLY: 12, QUARTERLY: 4, HALF_YEARLY: 2, ANNUALLY: 1, SINGLE: 1 };
  return policy.premiumAmount * (m[policy.premiumFrequency] ?? 1);
}

function policyColor(type: string): string {
  const map: Record<string, string> = {
    TERM_LIFE: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    HEALTH: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    SUPER_TOP_UP: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
    VEHICLE: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    ULIP: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  };
  return map[type] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
}

export default function InsurancePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<InsurancePolicy | null>(null);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const { user } = useAuth();
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingFamilyWide = isAdmin && !viewUserId;

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['insurance', viewUserId],
    queryFn: () => insuranceApi.getAll(viewUserId ? { targetUserId: viewUserId } : undefined),
  });

  const { data: deduction80D } = useQuery({
    queryKey: ['insurance', '80d', viewUserId],
    queryFn: () => insuranceApi.get80D(viewUserId ? { targetUserId: viewUserId } : undefined),
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<PolicyForm>({
    resolver: zodResolver(policySchema),
    defaultValues: { policyType: 'TERM_LIFE', premiumFrequency: 'ANNUALLY', is80cEligible: false, is80dEligible: false, isForParents: false },
  });
  const watchedPolicyType = watch('policyType');

  // Who the candidate vehicle list must belong to — the policy's actual owner when
  // editing (not necessarily the requester, e.g. an ADMIN editing a member's policy
  // from family-wide view), else whoever the member selector is scoped to, else the
  // current user (matches createMutation's own targetUserId fallback below). Mirrors
  // Assets.tsx's own policyOwnerId pattern for its (reciprocal) insurance picker.
  const assetOwnerId = editing?.userId ?? viewUserId ?? user?.id;
  const { data: allAssets = [], isError: isAssetsError } = useQuery({
    queryKey: ['assets', assetOwnerId],
    queryFn: () => assetsApi.getAll(assetOwnerId),
    enabled: showForm && watchedPolicyType === 'VEHICLE',
  });
  // Sold vehicles are hidden from NEW candidates (mirrors Loans.tsx's own asset
  // picker) but a vehicle already selected stays visible/unlinkable — selling a car
  // after it was linked shouldn't make it impossible to remove the link here.
  const candidateVehicles = allAssets.filter(
    (a) => a.assetType === 'VEHICLE' && (!a.soldAt || selectedVehicleIds.includes(a.id)),
  );

  function toggleVehicle(id: string) {
    setSelectedVehicleIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  // A create/update/delete here can each change what a linked vehicle asset shows
  // (provider/policy name on update, the link itself on delete) — every mutation
  // invalidates ['assets'] too, not just delete, so the Assets page never lags.
  const invalidateInsurance = () => {
    qc.invalidateQueries({ queryKey: ['insurance'] });
    qc.invalidateQueries({ queryKey: ['assets'] });
  };

  // Neither mutation closes the form / invalidates caches in its own onSuccess — that
  // now happens once, at the end of onSubmit's full orchestration below, after any
  // vehicle link/unlink reconciliation has also completed. Only onError stays here
  // (belt-and-suspenders alongside onSubmit's own try/catch).
  const createMutation = useMutation({
    mutationFn: (data: PolicyForm) => insuranceApi.create(data, viewUserId ? { targetUserId: viewUserId } : undefined),
    onError: (err: any) => toast({ title: err?.response?.data?.message ?? 'Failed to add policy', variant: 'error' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PolicyForm }) => insuranceApi.update(id, data),
    onError: (err: any) => toast({ title: err?.response?.data?.message ?? 'Failed to update policy', variant: 'error' }),
  });

  const deleteMutation = useMutation({
    mutationFn: insuranceApi.delete,
    onSuccess: () => {
      invalidateInsurance();
    },
  });

  function startEdit(policy: InsurancePolicy) {
    setEditing(policy);
    // `assets` isn't a form field — it's a nested array, not a scalar the resolver can
    // validate — so it's excluded here rather than swept in by the blanket setValue loop.
    const { assets: _assets, ...formFields } = policy;
    Object.entries(formFields).forEach(([k, v]) => setValue(k as any, v ?? ''));
    setValue('startDate', policy.startDate.slice(0, 10));
    if (policy.endDate) setValue('endDate', policy.endDate.slice(0, 10));
    setSelectedVehicleIds(policy.assets?.map((a) => a.id) ?? []);
    setShowForm(true);
  }

  // Vehicle link/unlink isn't part of the InsurancePolicy record — Asset owns the FK
  // (Asset.insurancePolicyId) — so it's reconciled here via the existing, already-
  // validated PUT /api/assets/:id, not folded into the policy create/update payload.
  //
  // Order matters for exactly one reason: insuranceService's updateInsurancePolicy
  // 409s if the policyType is changing AWAY from VEHICLE while linked assets still
  // exist (checked against a fresh DB read, not the request body) — so those unlinks
  // must complete BEFORE that specific policy PUT, or a coherent "deselect everything,
  // then switch away from VEHICLE" edit would falsely 409. Staying VEHICLE doesn't
  // have this hazard, so an unlink failure there is reported but doesn't block the
  // policy save. Every unlink/link phase always attempts every item (Promise.allSettled,
  // never an early-abort loop) so a later failure can never hide an earlier success.
  async function onSubmit(data: PolicyForm) {
    setIsSaving(true);
    try {
      const originalVehicleIds = editing?.assets?.map((a) => a.id) ?? [];
      const targetVehicleIds = data.policyType === 'VEHICLE' ? selectedVehicleIds : [];
      const toUnlink = originalVehicleIds.filter((id) => !targetVehicleIds.includes(id));
      const toLink = targetVehicleIds.filter((id) => !originalVehicleIds.includes(id));

      if (toUnlink.length > 0) {
        const results = await Promise.allSettled(
          toUnlink.map((id) => assetsApi.update(id, { insurancePolicyId: '' })),
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          if (data.policyType !== 'VEHICLE') {
            toast({
              title: `Could not unlink ${failed} of ${toUnlink.length} vehicle(s) — policy not saved`,
              variant: 'error',
            });
            return;
          }
          toast({ title: `Could not unlink ${failed} of ${toUnlink.length} vehicle(s)`, variant: 'warning' });
        }
      }

      const savedPolicy = editing
        ? await updateMutation.mutateAsync({ id: editing.id, data })
        : await createMutation.mutateAsync(data);

      if (toLink.length > 0) {
        const results = await Promise.allSettled(
          toLink.map((id) => assetsApi.update(id, { insurancePolicyId: savedPolicy.id })),
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          toast({
            title: `Policy saved, but ${failed} of ${toLink.length} vehicle link(s) failed`,
            variant: 'warning',
          });
        }
      }

      setEditing(null);
      setShowForm(false);
      setSelectedVehicleIds([]);
      reset();
    } catch {
      // createMutation/updateMutation's own onError already toasts the specific
      // message; this just prevents an unhandled rejection from mutateAsync (which
      // still rejects even with onError defined) from escaping RHF's handleSubmit.
    } finally {
      // Any phase above may have already changed server state (a partial unlink, a
      // saved policy, a partial link) even when this function returns early or
      // throws — invalidate unconditionally so neither the Insurance nor Assets page
      // is left showing data the server no longer agrees with.
      invalidateInsurance();
      setIsSaving(false);
    }
  }

  const totalAnnualPremium = policies.reduce((s, p) => s + getAnnualPremium(p), 0);
  const totalSumAssured = policies.reduce((s, p) => s + p.sumAssured, 0);
  const paidPolicies = policies.filter((p) => p.isPaid).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insurance</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {policies.length} policies · Annual premium <INRDisplay amount={totalAnnualPremium} />
          </p>
          {isAdmin && !isMembersLoading && (
            <div className="flex items-center gap-2 mt-2">
              <label htmlFor="insurance-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
              {isMembersError ? (
                <span className="text-xs text-destructive">Could not load members</span>
              ) : (
                <select
                  id="insurance-member-select"
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
          <Button onClick={() => { setEditing(null); reset(); setSelectedVehicleIds([]); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Add Policy
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Sum Assured</p>
          <INRDisplay amount={totalSumAssured} short className="text-2xl font-bold" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Annual Premium</p>
          <INRDisplay amount={totalAnnualPremium} className="text-2xl font-bold" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">80C Eligible</p>
          <INRDisplay
            amount={policies.filter((p) => p.is80cEligible).reduce((s, p) => s + getAnnualPremium(p), 0)}
            className="text-2xl font-bold text-green-600"
          />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Paid Policies</p>
          <p className="text-2xl font-bold text-green-600">{paidPolicies}/{policies.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">80D Deduction</p>
          <INRDisplay amount={deduction80D?.total} className="text-2xl font-bold text-green-600" fallback="—" />
        </div>
      </div>

      {/* Policy Cards */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading policies…</div>
      ) : policies.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="font-medium">No insurance policies added yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add your first policy to track premiums and coverage</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {policies.map((policy) => (
            <div key={policy.id} className="rounded-lg border bg-card p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', policyColor(policy.policyType))}>
                    {POLICY_TYPE_LABELS[policy.policyType] ?? policy.policyType}
                  </span>
                  <h3 className="font-semibold mt-2">{policy.policyName}</h3>
                  <p className="text-sm text-muted-foreground">{policy.providerName}</p>
                  {isViewingFamilyWide && policy.userName && (
                    <p className="text-xs text-muted-foreground mt-0.5">{policy.userName}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(policy)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(policy.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Sum Assured</p>
                  <INRDisplay amount={policy.sumAssured} short className="font-semibold" />
                </div>
                <div>
                  <p className="text-muted-foreground">Premium</p>
                  <p className="font-semibold">
                    <INRDisplay amount={policy.premiumAmount} /> / {FREQ_LABELS[policy.premiumFrequency]?.split('-')[0] ?? ''}
                  </p>
                </div>
                {policy.premiumDueDate && (
                  <div>
                    <p className="text-muted-foreground">Next Due</p>
                    <p className="font-semibold flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatNextOccurrence(policy.premiumDueDate)}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Maturity/End</p>
                  <p className="font-semibold">{policy.endDate ? formatDate(policy.endDate) : '—'}</p>
                </div>
              </div>

              {policy.nomineeName && (
                <div className="text-sm flex items-center gap-1 text-muted-foreground">
                  <User className="h-3 w-3" /> Nominee: {policy.nomineeName}
                </div>
              )}
              {policy.agentContact && (
                <div className="text-sm flex items-center gap-1 text-muted-foreground">
                  <Phone className="h-3 w-3" /> {policy.agentContact}
                </div>
              )}
              {policy.assets && policy.assets.length > 0 && (() => {
                const assets = policy.assets;
                return (
                  <div className="text-sm flex items-start gap-1 text-muted-foreground">
                    <Car className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="flex flex-wrap items-center gap-1">
                      Covers:
                      {assets.map((a, i) => (
                        <span key={a.id} className="inline-flex items-center gap-1">
                          {a.name}
                          {a.registrationNumber && <span className="text-xs">({a.registrationNumber})</span>}
                          {a.soldAt && (
                            <span className="text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full">
                              Sold {formatDate(a.soldAt)}
                            </span>
                          )}
                          {i < assets.length - 1 && ','}
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })()}

              <div className="flex gap-2 pt-1">
                {policy.isPaid && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200">
                    <CheckCircle2 className="h-3 w-3" /> Paid
                  </span>
                )}
                {policy.is80cEligible && (
                  <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-2 py-0.5 rounded-full">80C</span>
                )}
                {policy.is80dEligible && (
                  <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 rounded-full">80D</span>
                )}
              </div>
              {policy.isPaid && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
                  Paid via linked transaction
                  {policy.lastPaidDate && <> on {formatDate(policy.lastPaidDate)}</>}
                  {policy.lastPaidAmount != null && <> for <INRDisplay amount={policy.lastPaidAmount} /></>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">{editing ? 'Edit Policy' : 'Add Insurance Policy'}</h2>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="policy-type" required>Policy Type</Label>
                  <select id="policy-type" {...register('policyType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(POLICY_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label required>Provider Name</Label>
                  <Input {...register('providerName')} placeholder="LIC, HDFC Life…" />
                  {errors.providerName && <p className="text-xs text-destructive">{errors.providerName.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="policy-number" required>Policy Number</Label>
                  <Input id="policy-number" {...register('policyNumber')} />
                  {errors.policyNumber && <p className="text-xs text-destructive">{errors.policyNumber.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="policy-name" required>Policy Name</Label>
                  <Input id="policy-name" {...register('policyName')} placeholder="e.g., Jeevan Anand" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="policy-sum-assured" required>Sum Assured (₹)</Label>
                  <Input id="policy-sum-assured" {...register('sumAssured')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="policy-premium-amount" required>Premium Amount (₹)</Label>
                  <Input id="policy-premium-amount" {...register('premiumAmount')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label required>Frequency</Label>
                  <select {...register('premiumFrequency')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="policy-premium-due-date">Premium Due Day (1-31, optional)</Label>
                  <Input id="policy-premium-due-date" {...register('premiumDueDate')} type="number" min="1" max="31" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="policy-start-date" required>Start Date</Label>
                  <Input id="policy-start-date" {...register('startDate')} type="date" />
                </div>
                <div className="space-y-1">
                  <Label>End/Maturity Date (optional)</Label>
                  <Input {...register('endDate')} type="date" />
                </div>
                <div className="space-y-1">
                  <Label>Nominee Name (optional)</Label>
                  <Input {...register('nomineeName')} />
                </div>
                <div className="space-y-1">
                  <Label>Agent Contact (optional)</Label>
                  <Input {...register('agentContact')} placeholder="+91 98765 43210" />
                </div>
              </div>
              {watchedPolicyType === 'VEHICLE' && (
                <div className="space-y-1">
                  <Label>Covers (optional)</Label>
                  {isAssetsError ? (
                    <p className="text-xs text-destructive">
                      Couldn't load vehicles — an existing link won't show here, but is unaffected.
                    </p>
                  ) : candidateVehicles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No vehicle assets yet — add one on the Assets page first.
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                      {candidateVehicles.map((v) => (
                        <label key={v.id} className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={selectedVehicleIds.includes(v.id)}
                            onChange={() => toggleVehicle(v.id)}
                            className="rounded"
                          />
                          <span>
                            {v.name}
                            {v.registrationNumber && ` (${v.registrationNumber})`}
                            {v.insurancePolicyId && v.insurancePolicyId !== editing?.id && (
                              <span className="text-xs text-muted-foreground">
                                {' '}— currently linked to {v.insurancePolicy?.providerName ?? 'another policy'}
                                {v.insurancePolicy?.policyName ? ` · ${v.insurancePolicy.policyName}` : ''}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register('is80cEligible')} className="rounded" />
                  <span className="text-sm">80C Eligible (LIC premiums etc.)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register('is80dEligible')} className="rounded" />
                  <span className="text-sm">80D Eligible (Health insurance)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register('isForParents')} className="rounded" />
                  <span className="text-sm">For Parents (80D parents sub-limit ₹25K)</span>
                </label>
              </div>
              <div className="space-y-1">
                <Label>Notes (optional)</Label>
                <Input {...register('notes')} placeholder="Optional notes" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  // Disabled while saving: the modal is the only way to reach a
                  // different Edit/Add session (the backdrop below it blocks clicks),
                  // so this is what stops a still-in-flight submission's own
                  // end-of-flow (setShowForm(false) etc.) from later closing/resetting
                  // a DIFFERENT form the user opened in the meantime.
                  disabled={isSaving}
                  onClick={() => { setShowForm(false); setEditing(null); setSelectedVehicleIds([]); reset(); }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {editing ? 'Update' : 'Add'} Policy
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
