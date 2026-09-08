import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { toDateInputValue } from '@/lib/dateFormat';
import { toCategoryTreeOptions, getCategoryTreeOptionLabel } from '@/lib/categoryUtils';
import { useToast } from '@/contexts/ToastContext';
import { type BudgetActualItem } from '@/hooks/useBudgetsVsActuals';
import { useCategories, useAccounts, useLoans } from '@/hooks/useTransactionFormOptions';
import { formatINR } from '@/lib/indianFormat';
import { PAYMENT_MODES } from '@/lib/paymentModes';
import { formatAccountOption } from '@/lib/accountFormat';
import { invalidateTransactionMutationCaches } from '@/lib/queryInvalidation';

const txSchema = z.object({
  description: z.string().min(1, 'Required'),
  remark: z.string().optional(),
  amount: z.coerce.number().positive(),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  date: z.string(),
  paymentMode: z.string().optional(),
  categoryId: z.string().optional(),
  bankAccountId: z.string().optional(),
  transferToAccountId: z.string().optional(),
  loanId: z.string().optional(),
  tags: z.string().optional(),
});

type TxForm = z.infer<typeof txSchema>;

export function AddTransactionModal({
  onClose,
  budgetActuals,
  targetUserId,
  showAccountOwner = false,
  fallbackAccountOwnerName,
  defaultType = 'EXPENSE',
}: {
  onClose: () => void;
  budgetActuals: BudgetActualItem[];
  targetUserId?: string;
  showAccountOwner?: boolean;
  fallbackAccountOwnerName?: string;
  defaultType?: 'EXPENSE' | 'INCOME';
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts(targetUserId);
  const { data: loans = [] } = useLoans(targetUserId);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<TxForm>({
    resolver: zodResolver(txSchema),
    defaultValues: { type: defaultType, date: toDateInputValue(new Date()) },
  });

  const amount = watch('amount');
  const selectedType = watch('type');

  // Reset categoryId when transaction type changes so a stale cross-type category is never submitted
  useEffect(() => {
    setValue('categoryId', '');
  }, [selectedType, setValue]);

  const transactionCategories = categories.filter((c: any) => {
    if (selectedType === 'INCOME') return c.type === 'INCOME';
    if (selectedType === 'EXPENSE') return c.type === 'EXPENSE';
    return false; // TRANSFER — no categories
  });
  const formatModalAccountOption = (account: any) => formatAccountOption(account, {
    showOwner: showAccountOwner,
    fallbackOwnerName: fallbackAccountOwnerName,
  });

  const createMutation = useMutation({
    mutationFn: (data: TxForm) => api.post('/transactions', {
      ...data,
      remark: data.remark?.trim() || undefined,
      tags: data.tags ? data.tags.split(',').map((t) => t.trim()) : [],
      loanId: data.loanId || undefined,
      // These 4 fields are `<select>`s whose empty-choice value is `''`, but the
      // backend's Zod schema types them `z.string().cuid()/.enum().optional()` — which
      // accepts `undefined`, not `''`. A quick-add filling only description+amount
      // (the exact minimal-friction path this feature exists for) would submit `''`
      // for all four and get rejected 422. EditTransactionModal already normalizes this
      // the same way (Transactions.tsx's editMutation); this modal needs it too.
      categoryId: data.categoryId || undefined,
      bankAccountId: data.bankAccountId || undefined,
      transferToAccountId: data.transferToAccountId || undefined,
      paymentMode: data.paymentMode || undefined,
    }, {
      params: targetUserId ? { targetUserId } : {},
    }),
    onSuccess: (_, submittedData) => {
      // Shared with every other transaction-mutating call site (Transactions.tsx,
      // RecurringRules.tsx) — see queryInvalidation.ts for why this can't be a
      // ['budgets']-only invalidation (Budgets.tsx's own page reads ['budgets-actuals'],
      // a disjoint key from useBudgetsVsActuals.ts's Dashboard-widget key).
      invalidateTransactionMutationCaches(qc);
      toast({ title: 'Transaction added', variant: 'success' });
      // Check if this EXPENSE pushes a budget over 80% or 100%
      if (submittedData.type === 'EXPENSE' && submittedData.categoryId) {
        const budget = budgetActuals.find((b) => b.categoryId === submittedData.categoryId);
        if (budget) {
          const projectedActual = budget.actual + Number(submittedData.amount);
          const projectedPct = (projectedActual / Number(budget.amount)) * 100;
          if (projectedPct >= 100) {
            toast({
              title: `Budget exceeded: ${budget.category.name}`,
              description: `${formatINR(projectedActual)} spent of ${formatINR(Number(budget.amount))} budget`,
              variant: 'error',
            });
          } else if (projectedPct >= 80) {
            toast({
              title: `Budget warning: ${budget.category.name}`,
              description: `${projectedPct.toFixed(0)}% used — ${formatINR(Number(budget.amount) - projectedActual)} remaining`,
              variant: 'warning',
            });
          }
        }
      }
      onClose();
      reset();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Add Transaction</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <form onSubmit={handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
              <Label required>Description</Label>
              <Input {...register('description')} placeholder="e.g. Swiggy order" />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Remark (optional)</Label>
              <Input {...register('remark')} placeholder="Bank transaction remark or note" />
            </div>
            <div className="space-y-1">
              <Label required>Amount (₹)</Label>
              <Input {...register('amount')} type="number" step="0.01" />
              {amount && <p className="text-xs text-muted-foreground">{formatINR(Number(amount))}</p>}
            </div>
            <div className="space-y-1">
              <Label required>Type</Label>
              <select {...register('type')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Income</option>
                <option value="TRANSFER">Transfer</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label required>Date</Label>
              <Input {...register('date')} type="date" />
            </div>
            <div className="space-y-1">
              <Label>Payment Mode (optional)</Label>
              <select {...register('paymentMode')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Select —</option>
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tx-add-categoryId">Category (optional)</Label>
              <select id="tx-add-categoryId" {...register('categoryId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Uncategorized —</option>
                {toCategoryTreeOptions(transactionCategories).map(({ category: c, depth }) => (
                  <option key={c.id} value={c.id}>{getCategoryTreeOptionLabel(c, depth)}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>{selectedType === 'TRANSFER' ? 'From Account (optional)' : 'Bank Account (optional)'}</Label>
              <select {...register('bankAccountId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— None —</option>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{formatModalAccountOption(a)}</option>)}
              </select>
            </div>
            {selectedType === 'TRANSFER' && (
              <div className="col-span-2 space-y-1">
                <Label required>To Account</Label>
                <select {...register('transferToAccountId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— Select destination —</option>
                  {accounts.map((a: any) => <option key={a.id} value={a.id}>{formatModalAccountOption(a)}</option>)}
                </select>
              </div>
            )}
            {selectedType === 'EXPENSE' && loans.length > 0 && (
              <div className="col-span-2 space-y-1">
                <Label>Link to Loan (optional)</Label>
                <select {...register('loanId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— None —</option>
                  {loans.map((l: any) => (
                    <option key={l.id} value={l.id}>
                      {l.lenderName} ({l.loanType}) — {formatINR(Number(l.outstandingBalance))} outstanding
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-2 space-y-1">
              <Label>Tags (comma-separated, optional)</Label>
              <Input {...register('tags')} placeholder="food, work, travel" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>Add Transaction</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
