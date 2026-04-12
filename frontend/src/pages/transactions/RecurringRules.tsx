import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PlusCircle, Trash2, Pencil, RefreshCw, ToggleLeft, ToggleRight, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { useToast } from '@/contexts/ToastContext';
import {
  fetchRecurringRules,
  createRecurringRule,
  updateRecurringRule,
  deleteRecurringRule,
  triggerGenerate,
  type RecurringRule,
  type CreateRecurringRuleInput,
  type RecurringFrequency,
} from '@/api/recurring';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};

const ruleSchema = z.object({
  description: z.string().min(1, 'Required').max(500),
  amount: z.coerce.number().positive('Must be positive'),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  categoryId: z.string().optional(),
  bankAccountId: z.string().optional(),
  nextRunDate: z.string().min(1, 'Required'),
});

type RuleForm = z.infer<typeof ruleSchema>;

function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ data: { id: string; name: string; type: string }[] }>('/categories').then((r) => r.data.data),
  });
}

function useBankAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () =>
      api.get<{ data: { id: string; bankName: string; accountNumberLast4: string | null }[] }>('/accounts').then((r) => r.data.data),
  });
}

export default function RecurringRulesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['recurring-rules'],
    queryFn: fetchRecurringRules,
  });

  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useBankAccounts();

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<RuleForm>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      type: 'EXPENSE',
      frequency: 'MONTHLY',
      nextRunDate: new Date().toISOString().slice(0, 10),
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['recurring-rules'] });

  const createMutation = useMutation({
    mutationFn: (data: CreateRecurringRuleInput) => createRecurringRule(data),
    onSuccess: () => {
      toast({ title: 'Recurring rule created', variant: 'success' });
      invalidate();
      setShowForm(false);
      reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ frequency: RecurringFrequency; nextRunDate: string; isActive: boolean }> }) =>
      updateRecurringRule(id, data),
    onSuccess: () => {
      toast({ title: 'Rule updated', variant: 'success' });
      invalidate();
      setEditingRule(null);
      reset();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRecurringRule(id),
    onSuccess: () => {
      toast({ title: 'Rule deleted', variant: 'success' });
      invalidate();
      setDeleteConfirmId(null);
    },
  });

  const generateMutation = useMutation({
    mutationFn: triggerGenerate,
    onSuccess: (result) => {
      toast({
        title: `Generated ${result.generated} transaction${result.generated !== 1 ? 's' : ''}`,
        variant: result.generated > 0 ? 'success' : 'default',
      });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const applyMutation = useMutation({
    mutationFn: (rule: RecurringRule) => {
      const t = rule.templateTransaction as RecurringRule['templateTransaction'] & { paymentMode?: string };
      return api.post('/transactions', {
        description: t.description,
        amount: Number(t.amount),
        type: t.type,
        date: new Date().toISOString().slice(0, 10),
        categoryId: t.categoryId ?? undefined,
        bankAccountId: t.bankAccountId ?? undefined,
        paymentMode: t.paymentMode ?? undefined,
        tags: t.tags ?? [],
      });
    },
    onSuccess: (_, rule) => {
      toast({ title: `Applied: ${rule.templateTransaction.description}`, variant: 'success' });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (err: any) => {
      toast({ title: err?.response?.data?.message ?? 'Failed to apply rule', variant: 'error' });
    },
  });

  const onSubmit = (data: RuleForm) => {
    const payload: CreateRecurringRuleInput = {
      description: data.description,
      amount: data.amount,
      type: data.type,
      frequency: data.frequency,
      nextRunDate: data.nextRunDate,
      categoryId: data.categoryId || undefined,
      bankAccountId: data.bankAccountId || undefined,
    };

    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: { frequency: data.frequency, nextRunDate: data.nextRunDate } });
    } else {
      createMutation.mutate(payload);
    }
  };

  const startEdit = (rule: RecurringRule) => {
    setEditingRule(rule);
    setValue('description', rule.templateTransaction.description);
    setValue('amount', Number(rule.templateTransaction.amount));
    setValue('type', rule.templateTransaction.type);
    setValue('frequency', rule.frequency);
    setValue('nextRunDate', rule.nextRunDate.slice(0, 10));
    setValue('categoryId', rule.templateTransaction.categoryId ?? '');
    setValue('bankAccountId', rule.templateTransaction.bankAccountId ?? '');
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingRule(null);
    reset();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recurring Transactions</h1>
          <p className="text-muted-foreground text-sm">Transactions generated automatically on schedule</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            <RefreshCw className={cn('h-4 w-4 mr-1', generateMutation.isPending && 'animate-spin')} />
            Generate Now
          </Button>
          <Button size="sm" onClick={() => { setEditingRule(null); reset(); setShowForm(true); }}>
            <PlusCircle className="h-4 w-4 mr-1" />
            Add Rule
          </Button>
        </div>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-base font-semibold">{editingRule ? 'Edit Rule' : 'New Recurring Rule'}</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="description">Description</Label>
                <Input id="description" {...register('description')} disabled={!!editingRule} />
                {errors.description && <p className="text-xs text-red-500 mt-1">{errors.description.message}</p>}
              </div>
              <div>
                <Label htmlFor="amount">Amount (₹)</Label>
                <Input id="amount" type="number" step="0.01" {...register('amount')} disabled={!!editingRule} />
                {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount.message}</p>}
              </div>
              <div>
                <Label htmlFor="type">Type</Label>
                <select id="type" {...register('type')} disabled={!!editingRule}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                  <option value="TRANSFER">Transfer</option>
                </select>
              </div>
              <div>
                <Label htmlFor="frequency">Frequency</Label>
                <select id="frequency" {...register('frequency')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="nextRunDate">Next Run Date</Label>
                <Input id="nextRunDate" type="date" {...register('nextRunDate')} />
                {errors.nextRunDate && <p className="text-xs text-red-500 mt-1">{errors.nextRunDate.message}</p>}
              </div>
              {!editingRule && (
                <div>
                  <Label htmlFor="categoryId">Category (optional)</Label>
                  <select id="categoryId" {...register('categoryId')}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="">— None —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {!editingRule && (
                <div>
                  <Label htmlFor="bankAccountId">Bank Account (optional)</Label>
                  <select id="bankAccountId" {...register('bankAccountId')}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="">— None —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.bankName}{a.accountNumberLast4 ? ` ···${a.accountNumberLast4}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingRule ? 'Save Changes' : 'Create Rule'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={cancelForm}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {/* Rules list */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-muted-foreground text-sm">No recurring rules set up yet.</p>
          <p className="text-muted-foreground text-xs mt-1">Add a rule to auto-generate transactions on a schedule.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-xl border border-border bg-card px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{rule.templateTransaction.description}</span>
                  {!rule.isActive && (
                    <span className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5">Paused</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <INRDisplay amount={Number(rule.templateTransaction.amount)} short className="inline font-medium text-foreground" />
                  <span>{rule.templateTransaction.type}</span>
                  <span>{FREQUENCY_LABELS[rule.frequency]}</span>
                  {rule.templateTransaction.category && (
                    <span className="truncate">{rule.templateTransaction.category.name}</span>
                  )}
                  <span>Next: {new Date(rule.nextRunDate).toLocaleDateString('en-IN')}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => rule.isActive && applyMutation.mutate(rule)}
                  disabled={!rule.isActive || applyMutation.isPending}
                  className={cn(
                    'p-1.5 rounded hover:bg-muted',
                    rule.isActive
                      ? 'text-primary hover:text-primary/80'
                      : 'text-muted-foreground opacity-40 cursor-not-allowed',
                  )}
                  title={rule.isActive ? 'Apply now (create transaction for today)' : 'Rule is paused'}
                >
                  <Zap className="h-4 w-4" />
                </button>
                <button
                  onClick={() => updateMutation.mutate({ id: rule.id, data: { isActive: !rule.isActive } })}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  title={rule.isActive ? 'Pause' : 'Resume'}
                >
                  {rule.isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => startEdit(rule)}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {deleteConfirmId === rule.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => deleteMutation.mutate(rule.id)}
                      className="text-xs text-red-600 hover:underline px-1"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="text-xs text-muted-foreground hover:underline px-1"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(rule.id)}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-500"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
