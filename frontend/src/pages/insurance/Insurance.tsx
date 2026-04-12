import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, Plus, Trash2, Edit2, Phone, User, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { insuranceApi, type InsurancePolicy } from '@/api/insurance';
import { cn } from '@/lib/utils';

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
  premiumDueDate: z.coerce.number().int().min(1).max(31).optional(),
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
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<InsurancePolicy | null>(null);
  const [showAmortization, setShowAmortization] = useState<string | null>(null);

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['insurance'],
    queryFn: insuranceApi.getAll,
  });

  const { data: deduction80D } = useQuery({
    queryKey: ['insurance', '80d'],
    queryFn: insuranceApi.get80D,
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<PolicyForm>({
    resolver: zodResolver(policySchema),
    defaultValues: { policyType: 'TERM_LIFE', premiumFrequency: 'ANNUALLY', is80cEligible: false, is80dEligible: false, isForParents: false },
  });

  const createMutation = useMutation({
    mutationFn: (data: PolicyForm) => insuranceApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['insurance'] }); setShowForm(false); reset(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PolicyForm }) => insuranceApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['insurance'] }); setEditing(null); setShowForm(false); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: insuranceApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['insurance'] }),
  });

  function startEdit(policy: InsurancePolicy) {
    setEditing(policy);
    Object.entries(policy).forEach(([k, v]) => setValue(k as any, v ?? ''));
    setValue('startDate', policy.startDate.slice(0, 10));
    if (policy.endDate) setValue('endDate', policy.endDate.slice(0, 10));
    setShowForm(true);
  }

  function onSubmit(data: PolicyForm) {
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate(data);
  }

  const totalAnnualPremium = policies.reduce((s, p) => s + getAnnualPremium(p), 0);
  const totalSumAssured = policies.reduce((s, p) => s + p.sumAssured, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insurance</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {policies.length} policies · Annual premium <INRDisplay amount={totalAnnualPremium} />
          </p>
        </div>
        <Button onClick={() => { setEditing(null); reset(); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Add Policy
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                    <p className="text-muted-foreground">Due Day</p>
                    <p className="font-semibold flex items-center gap-1"><Calendar className="h-3 w-3" /> {policy.premiumDueDate}th</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Maturity/End</p>
                  <p className="font-semibold">{policy.endDate ? new Date(policy.endDate).toLocaleDateString('en-IN') : '—'}</p>
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

              <div className="flex gap-2 pt-1">
                {policy.is80cEligible && (
                  <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-2 py-0.5 rounded-full">80C</span>
                )}
                {policy.is80dEligible && (
                  <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 rounded-full">80D</span>
                )}
              </div>
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
                  <Label>Policy Type</Label>
                  <select {...register('policyType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(POLICY_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Provider Name</Label>
                  <Input {...register('providerName')} placeholder="LIC, HDFC Life…" />
                  {errors.providerName && <p className="text-xs text-destructive">{errors.providerName.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Policy Number</Label>
                  <Input {...register('policyNumber')} />
                  {errors.policyNumber && <p className="text-xs text-destructive">{errors.policyNumber.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Policy Name</Label>
                  <Input {...register('policyName')} placeholder="e.g., Jeevan Anand" />
                </div>
                <div className="space-y-1">
                  <Label>Sum Assured (₹)</Label>
                  <Input {...register('sumAssured')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label>Premium Amount (₹)</Label>
                  <Input {...register('premiumAmount')} type="number" />
                </div>
                <div className="space-y-1">
                  <Label>Frequency</Label>
                  <select {...register('premiumFrequency')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Premium Due Day (1-31)</Label>
                  <Input {...register('premiumDueDate')} type="number" min="1" max="31" />
                </div>
                <div className="space-y-1">
                  <Label>Start Date</Label>
                  <Input {...register('startDate')} type="date" />
                </div>
                <div className="space-y-1">
                  <Label>End/Maturity Date</Label>
                  <Input {...register('endDate')} type="date" />
                </div>
                <div className="space-y-1">
                  <Label>Nominee Name</Label>
                  <Input {...register('nomineeName')} />
                </div>
                <div className="space-y-1">
                  <Label>Agent Contact</Label>
                  <Input {...register('agentContact')} placeholder="+91 98765 43210" />
                </div>
              </div>
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
                <Label>Notes</Label>
                <Input {...register('notes')} placeholder="Optional notes" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); reset(); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
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
