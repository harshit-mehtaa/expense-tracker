import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PlusCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { useFY } from '@/contexts/FYContext';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

function useBudgets(fy: string, targetUserId?: string) {
  return useQuery({
    queryKey: ['budgets-actuals', fy, targetUserId],
    queryFn: () => {
      const params: Record<string, string> = { fy };
      if (targetUserId) params.targetUserId = targetUserId;
      return api.get<{ data: any[] }>('/budgets/vs-actuals', { params }).then((r) => r.data.data);
    },
  });
}

function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ data: any[] }>('/categories').then((r) => r.data.data),
  });
}

const budgetSchema = z.object({
  categoryId: z.string().min(1, 'Select a category'),
  amount: z.coerce.number().positive(),
  period: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'FY']),
  fyYear: z.string().optional(),
});

type BudgetForm = z.infer<typeof budgetSchema>;

export default function BudgetsPage() {
  const { selectedFY } = useFY();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();

  const { data: budgets = [], isLoading } = useBudgets(selectedFY, viewUserId);
  const { data: categories = [] } = useCategories();
  const isViewingOtherMember = isAdmin && viewUserId !== undefined;
  const expenseCategories = categories.filter((c: any) => c.type === 'EXPENSE');

  const { register, handleSubmit, reset, formState: { errors } } = useForm<BudgetForm>({
    resolver: zodResolver(budgetSchema),
    defaultValues: { period: 'MONTHLY', fyYear: selectedFY },
  });

  const createMutation = useMutation({
    mutationFn: (data: BudgetForm) => api.post('/budgets', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budgets-actuals'] }); setShowForm(false); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/budgets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets-actuals'] }),
  });

  const totalBudgeted = budgets.reduce((s: number, b: any) => s + Number(b.amount), 0);
  const totalActual = budgets.reduce((s: number, b: any) => s + b.actual, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budgets</h1>
          <p className="text-muted-foreground text-sm mt-1">
            FY {selectedFY}
            {isAdmin && viewUserId
              ? ` · ${members.find((m) => m.id === viewUserId)?.name ?? 'Member'}`
              : isAdmin ? ' · All Family' : ''}
          </p>
          {isAdmin && !isMembersLoading && (
            <div className="flex items-center gap-2 mt-2">
              <label htmlFor="budget-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
              {isMembersError ? (
                <span className="text-xs text-destructive">Could not load members</span>
              ) : (
                <select
                  id="budget-member-select"
                  value={viewUserId ?? ''}
                  onChange={(e) => setViewUserId(e.target.value || undefined)}
                  className="rounded-md border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="">All Family</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
        {!isViewingOtherMember && (
          <Button onClick={() => setShowForm(true)}><PlusCircle className="h-4 w-4 mr-2" /> Add Budget</Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Budgeted</p>
          <INRDisplay amount={totalBudgeted} className="text-2xl font-bold" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Spent</p>
          <INRDisplay amount={totalActual} className="text-2xl font-bold" />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Remaining</p>
          <INRDisplay
            amount={totalBudgeted - totalActual}
            colorCode
            className="text-2xl font-bold"
          />
        </div>
      </div>

      {/* Budget cards */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading budgets…</div>
      ) : budgets.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <PlusCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="font-medium">No budgets set up yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add your first budget to track spending by category</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {budgets.map((budget: any) => {
            const pct = budget.pctUsed;
            const isOver = pct > 100;
            return (
              <div key={budget.id} className={cn(
                'rounded-lg border bg-card p-5 space-y-3',
                isOver && 'border-red-400',
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {budget.category?.icon && <span>{budget.category.icon}</span>}
                    <p className="font-semibold">{budget.category?.name ?? 'Unknown'}</p>
                  </div>
                  {!isViewingOtherMember && (
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(budget.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>

                {/* Circular-ish progress: simple bar */}
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <INRDisplay amount={budget.actual} />
                    <span className="text-muted-foreground">of <INRDisplay amount={Number(budget.amount)} /></span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', isOver ? 'bg-red-500' : pct > 75 ? 'bg-yellow-500' : 'bg-green-500')}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-xs">
                    <span className={cn(isOver ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                      {pct.toFixed(0)}% used
                    </span>
                    {!isOver && <span className="text-green-600"><INRDisplay amount={budget.remaining} className="text-xs" /> left</span>}
                    {isOver && <span className="text-red-600"><INRDisplay amount={budget.actual - Number(budget.amount)} className="text-xs" /> over</span>}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground capitalize">{budget.period.toLowerCase()} budget</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Budget Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-sm p-6">
            <h2 className="text-xl font-semibold mb-4">Add Budget</h2>
            <form onSubmit={handleSubmit((data) => createMutation.mutate({ ...data, fyYear: selectedFY }))} className="space-y-4">
              <div className="space-y-1">
                <Label>Category</Label>
                <select {...register('categoryId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— Select category —</option>
                  {expenseCategories.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>
                  ))}
                </select>
                {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Amount (₹)</Label>
                <Input {...register('amount')} type="number" placeholder="Monthly budget amount" />
              </div>
              <div className="space-y-1">
                <Label>Period</Label>
                <select {...register('period')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="YEARLY">Yearly</option>
                  <option value="FY">Financial Year</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>Add Budget</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
