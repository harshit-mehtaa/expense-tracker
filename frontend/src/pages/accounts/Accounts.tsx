import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Plus, Trash2, Edit2, Eye, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  SAVINGS: 'Savings', CURRENT: 'Current', SALARY: 'Salary',
  NRE: 'NRE', NRO: 'NRO', PPF: 'PPF', EPF: 'EPF', DEMAT: 'Demat',
};

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  SAVINGS: 'bg-blue-100 text-blue-800', CURRENT: 'bg-gray-100 text-gray-800',
  SALARY: 'bg-green-100 text-green-800', NRE: 'bg-purple-100 text-purple-800',
  NRO: 'bg-indigo-100 text-indigo-800', PPF: 'bg-amber-100 text-amber-800',
  EPF: 'bg-orange-100 text-orange-800', DEMAT: 'bg-teal-100 text-teal-800',
};

const BANKS = ['HDFC Bank', 'SBI', 'ICICI Bank', 'Axis Bank', 'Kotak Bank', 'PNB', 'Bank of Baroda', 'Canara Bank', 'Yes Bank', 'IDFC First Bank', 'Other'];

const accountSchema = z.object({
  bankName: z.string().min(1, 'Required'),
  accountType: z.string(),
  accountNumberLast4: z.string().max(4).optional(),
  ifscPrefix: z.string().max(4).optional(),
  currentBalance: z.coerce.number().default(0),
  upiId: z.string().optional(),
  interestRate: z.coerce.number().optional(),
});

type AccountForm = z.infer<typeof accountSchema>;

function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<{ data: any[] }>('/accounts').then((r) => r.data.data),
  });
}

export default function AccountsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [maskedBalances, setMaskedBalances] = useState(true);
  const [reconciling, setReconciling] = useState<any>(null);
  const [reconcileBalance, setReconcileBalance] = useState('');
  const [reconcileNote, setReconcileNote] = useState('');

  const { data: accounts = [], isLoading } = useAccounts();

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: { accountType: 'SAVINGS', currentBalance: 0 },
  });

  const createMutation = useMutation({
    mutationFn: (data: AccountForm) => api.post('/accounts', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); setShowForm(false); reset(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: AccountForm }) => api.put(`/accounts/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); setEditing(null); setShowForm(false); reset(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const reconcileMutation = useMutation({
    mutationFn: ({ id, actualBalance, note }: { id: string; actualBalance: number; note?: string }) =>
      api.post(`/accounts/${id}/reconcile`, { actualBalance, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setReconciling(null);
      setReconcileBalance('');
      setReconcileNote('');
    },
  });

  function startEdit(account: any) {
    setEditing(account);
    setValue('bankName', account.bankName);
    setValue('accountType', account.accountType);
    setValue('accountNumberLast4', account.accountNumberLast4 ?? '');
    setValue('ifscPrefix', account.ifscPrefix ?? '');
    setValue('currentBalance', account.currentBalance);
    setValue('upiId', account.upiId ?? '');
    setShowForm(true);
  }

  const totalBalance = accounts.reduce((s: number, a: any) => s + Number(a.currentBalance), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts & Deposits</h1>
          <p className="text-muted-foreground text-sm mt-1">{accounts.length} accounts</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setMaskedBalances(!maskedBalances)}>
            <Eye className="h-4 w-4 mr-1" /> {maskedBalances ? 'Show' : 'Hide'} Balances
          </Button>
          <Button onClick={() => { setEditing(null); reset(); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Add Account
          </Button>
        </div>
      </div>

      {/* Total Balance */}
      <div className="rounded-lg border bg-card p-5">
        <p className="text-sm text-muted-foreground">Total Balance Across All Accounts</p>
        {maskedBalances ? (
          <p className="text-3xl font-bold mt-1">₹ ••••••</p>
        ) : (
          <INRDisplay amount={totalBalance} className="text-3xl font-bold mt-1" />
        )}
      </div>

      {/* Account Cards */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading accounts…</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="font-medium">No bank accounts added yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add your savings, salary, or investment accounts</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account: any) => (
            <div key={account.id} className={cn('rounded-lg border bg-card p-5 space-y-3', !account.isActive && 'opacity-60')}>
              <div className="flex items-start justify-between">
                <div>
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', ACCOUNT_TYPE_COLORS[account.accountType] ?? 'bg-gray-100 text-gray-800')}>
                    {ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType}
                  </span>
                  <h3 className="font-semibold mt-2">{account.bankName}</h3>
                  {account.accountNumberLast4 && (
                    <p className="text-sm text-muted-foreground">····{account.accountNumberLast4}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" title="Reconcile balance" onClick={() => { setReconciling(account); setReconcileBalance(String(Number(account.currentBalance))); setReconcileNote(''); }}><RefreshCw className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => startEdit(account)}><Edit2 className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(account.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Balance</p>
                {maskedBalances ? (
                  <p className="text-xl font-bold">₹ ••••</p>
                ) : (
                  <INRDisplay amount={Number(account.currentBalance)} className="text-xl font-bold" />
                )}
              </div>

              {account.upiId && <p className="text-xs text-muted-foreground">UPI: {account.upiId}</p>}
              {account.interestRate && <p className="text-xs text-muted-foreground">Interest: {account.interestRate}% p.a.</p>}
            </div>
          ))}
        </div>
      )}

      {/* Reconcile Modal */}
      {reconciling && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-xl font-semibold">Reconcile Balance</h2>
            <p className="text-sm text-muted-foreground">
              {reconciling.bankName} ····{reconciling.accountNumberLast4 ?? ''}
            </p>
            <div className="space-y-1">
              <Label>Actual Balance (₹)</Label>
              <Input
                type="number"
                step="0.01"
                value={reconcileBalance}
                onChange={(e) => setReconcileBalance(e.target.value)}
                placeholder="Enter your actual bank balance"
              />
            </div>
            <div className="space-y-1">
              <Label>Note (optional)</Label>
              <Input
                value={reconcileNote}
                onChange={(e) => setReconcileNote(e.target.value)}
                placeholder="e.g. Monthly bank statement check"
              />
            </div>
            {reconcileMutation.isError && (
              <p className="text-sm text-destructive">
                {(reconcileMutation.error as any)?.response?.data?.message ?? 'Reconciliation failed'}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => { setReconciling(null); setReconcileBalance(''); setReconcileNote(''); }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => reconcileMutation.mutate({
                  id: reconciling.id,
                  actualBalance: parseFloat(reconcileBalance),
                  note: reconcileNote || undefined,
                })}
                disabled={reconcileMutation.isPending || !reconcileBalance || isNaN(parseFloat(reconcileBalance))}
              >
                {reconcileMutation.isPending ? 'Reconciling…' : 'Reconcile'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-4">{editing ? 'Edit Account' : 'Add Bank Account'}</h2>
            <form onSubmit={handleSubmit((data) => editing ? updateMutation.mutate({ id: editing.id, data }) : createMutation.mutate(data))} className="space-y-4">
              <div className="space-y-1">
                <Label>Bank Name</Label>
                <select {...register('bankName')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Account Type</Label>
                <select {...register('accountType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Last 4 digits of A/c No.</Label>
                  <Input {...register('accountNumberLast4')} maxLength={4} placeholder="1234" />
                </div>
                <div className="space-y-1">
                  <Label>IFSC Prefix (4 chars)</Label>
                  <Input {...register('ifscPrefix')} maxLength={4} placeholder="HDFC" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Current Balance (₹)</Label>
                <Input {...register('currentBalance')} type="number" step="0.01" />
              </div>
              <div className="space-y-1">
                <Label>UPI ID (optional)</Label>
                <Input {...register('upiId')} placeholder="name@upi" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editing ? 'Update' : 'Add'} Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
