import { useState, useRef, useEffect } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useFY } from '@/contexts/FYContext';
import { useSearchParams } from 'react-router-dom';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { Receipt, Upload, X, CheckCircle, AlertCircle, Download, Pencil, Trash2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { loansApi } from '@/api/loans';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useBudgetsVsActuals, type BudgetActualItem } from '@/hooks/useBudgetsVsActuals';
import { useMemberSelector } from '@/hooks/useMemberSelector';

interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  date: string;
  paymentMode?: string;
  categoryName?: string;
  categoryIcon?: string | null;
  categoryId?: string;
  bankAccountName?: string;
  userId: string;
  transferPairId?: string | null;
}

interface RawTransaction extends Omit<Transaction, 'categoryName' | 'bankAccountName'> {
  category?: { name: string; color: string; icon: string } | null;
  bankAccount?: { bankName: string; accountNumberLast4?: string | null } | null;
}

interface TransactionsResponse {
  data: Transaction[];
  pagination: { total: number; hasMore: boolean; nextCursor?: string };
}

interface TxFilters {
  search: string;
  type: string;
  categoryId: string;
  paymentMode: string;
  startDate: string;
  endDate: string;
}

async function fetchTransactions(fy: string, filters: TxFilters, cursor?: string, targetUserId?: string): Promise<TransactionsResponse> {
  const res = await api.get<{ data: RawTransaction[]; pagination: TransactionsResponse['pagination'] }>('/transactions', {
    params: {
      fy,
      limit: 50,
      cursor: cursor || undefined,
      search: filters.search || undefined,
      type: filters.type || undefined,
      categoryId: filters.categoryId || undefined,
      paymentMode: filters.paymentMode || undefined,
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      targetUserId: targetUserId || undefined,
    },
  });
  const data: Transaction[] = (res.data.data ?? []).map((tx) => ({
    ...tx,
    categoryName: tx.category?.name,
    categoryIcon: tx.category?.icon,
    bankAccountName: tx.bankAccount
      ? `${tx.bankAccount.bankName}${tx.bankAccount.accountNumberLast4 ? ` ****${tx.bankAccount.accountNumberLast4}` : ''}`
      : undefined,
  }));
  return { data, pagination: res.data.pagination };
}

const PAYMENT_MODE_COLORS: Record<string, string> = {
  UPI: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  NEFT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  RTGS: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  IMPS: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  CASH: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  CHEQUE: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  CARD: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  EMI: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  AUTO_DEBIT: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
};

const PAYMENT_MODE_ICONS: Record<string, string> = {
  UPI: '📱',
  NEFT: '🏦',
  RTGS: '🏛️',
  IMPS: '⚡',
  CASH: '💵',
  CHEQUE: '📝',
  CARD: '💳',
  EMI: '📅',
  AUTO_DEBIT: '🔄',
};

const txSchema = z.object({
  description: z.string().min(1, 'Required'),
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

// Edit schema: TRANSFER type not allowed, bankAccountId excluded, paymentMode empty→undefined
const editTxSchema = z.object({
  description: z.string().min(1, 'Required'),
  amount: z.coerce.number().positive('Must be positive'),
  type: z.enum(['INCOME', 'EXPENSE']),
  date: z.string(),
  paymentMode: z.string().transform((v) => v || undefined).optional(),
  categoryId: z.string().optional(),
});

type EditTxForm = z.infer<typeof editTxSchema>;

function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ data: any[] }>('/categories').then((r) => r.data.data),
  });
}

function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<{ data: any[] }>('/accounts').then((r) => r.data.data),
  });
}

function useLoans() {
  return useQuery({
    queryKey: ['loans'],
    queryFn: () => loansApi.getAll(),
  });
}

function EditTransactionModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: categories = [] } = useCategories();

  const { register, handleSubmit, formState: { errors } } = useForm<EditTxForm>({
    resolver: zodResolver(editTxSchema),
    defaultValues: {
      description: tx.description,
      amount: tx.amount,
      type: tx.type === 'TRANSFER' ? 'EXPENSE' : tx.type,
      date: tx.date.slice(0, 10),
      paymentMode: tx.paymentMode ?? '',
      categoryId: tx.categoryId ?? '',
    },
  });

  const editMutation = useMutation({
    mutationFn: (data: EditTxForm) =>
      api.put(`/transactions/${tx.id}`, {
        ...data,
        paymentMode: data.paymentMode || undefined,
        categoryId: data.categoryId || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      toast({ title: 'Transaction updated', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Update failed',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Edit Transaction</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <form onSubmit={handleSubmit((data) => editMutation.mutate(data))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
              <Label>Description</Label>
              <Input {...register('description')} />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Amount (₹)</Label>
              <Input {...register('amount')} type="number" step="0.01" />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <select {...register('type')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Income</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input {...register('date')} type="date" />
            </div>
            <div className="space-y-1">
              <Label>Payment Mode</Label>
              <select {...register('paymentMode')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Select —</option>
                {['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Category</Label>
              <select {...register('categoryId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Uncategorized —</option>
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={editMutation.isPending}>
              {editMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CategoryRule { keyword: string; categoryId: string; categoryName: string }
const RULES_KEY = 'tx-category-rules';
function loadRules(): CategoryRule[] {
  try { return JSON.parse(localStorage.getItem(RULES_KEY) ?? '[]'); } catch { return []; }
}
function saveRules(rules: CategoryRule[]) { localStorage.setItem(RULES_KEY, JSON.stringify(rules)); }

function ImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const [file, setFile] = useState<File | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [bank, setBank] = useState('');
  const [result, setResult] = useState<any>(null);
  const [showRules, setShowRules] = useState(false);
  const [rules, setRules] = useState<CategoryRule[]>(loadRules);
  const [newKeyword, setNewKeyword] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [applying, setApplying] = useState(false);
  const [newBalance, setNewBalance] = useState('');
  const [savingBalance, setSavingBalance] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const formData = new FormData();
      formData.append('file', file);
      if (bankAccountId) formData.append('bankAccountId', bankAccountId);
      if (bank) formData.append('bank', bank);
      return api.post<{ data: any }>('/transactions/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      setResult(res.data.data);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  function addRule() {
    if (!newKeyword.trim() || !newCategoryId) return;
    const cat = categories.find((c: any) => c.id === newCategoryId);
    const updated = [...rules, { keyword: newKeyword.trim().toLowerCase(), categoryId: newCategoryId, categoryName: cat?.name ?? '' }];
    setRules(updated);
    saveRules(updated);
    setNewKeyword('');
    setNewCategoryId('');
  }

  function removeRule(i: number) {
    const updated = rules.filter((_, idx) => idx !== i);
    setRules(updated);
    saveRules(updated);
  }

  async function applyRules() {
    if (rules.length === 0) return;
    setApplying(true);
    try {
      // Fetch uncategorized transactions — paginate up to 1000 to avoid silent truncation
      const res = await api.get<{ data: any[]; pagination?: { total?: number } }>('/transactions', { params: { limit: 1000 } });
      const uncategorized = res.data.data.filter((tx: any) => !tx.categoryId && tx.type !== 'TRANSFER');
      const matches = uncategorized
        .map((tx: any) => {
          const desc = tx.description?.toLowerCase() ?? '';
          const match = rules.find((r) => desc.includes(r.keyword));
          return match ? { id: tx.id, categoryId: match.categoryId } : null;
        })
        .filter(Boolean) as { id: string; categoryId: string }[];

      await Promise.all(matches.map((m) => api.put(`/transactions/${m.id}`, { categoryId: m.categoryId })));
      qc.invalidateQueries({ queryKey: ['transactions'] });
      toast({ title: `Applied rules: ${matches.length} transaction${matches.length !== 1 ? 's' : ''} categorized`, variant: 'success' });
    } catch {
      toast({ title: 'Failed to apply rules', variant: 'error' });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Import Bank Statement</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {!result ? (
          <>
            <div className="space-y-1">
              <Label>Bank</Label>
              <select value={bank} onChange={(e) => setBank(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">Auto-detect from file</option>
                <option value="HDFC">HDFC Bank</option>
                <option value="SBI">SBI</option>
                <option value="ICICI">ICICI Bank</option>
                <option value="AXIS">Axis Bank</option>
                <option value="KOTAK">Kotak Bank</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Link to Account (optional)</Label>
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Don't link to account —</option>
                {accounts.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.bankName} ····{a.accountNumberLast4 ?? ''}</option>
                ))}
              </select>
            </div>
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/50 transition-colors',
                file && 'border-green-500 bg-green-50 dark:bg-green-950',
              )}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              {file ? (
                <p className="text-sm font-medium text-green-600">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">Drop CSV file here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports HDFC, SBI, ICICI, Axis, Kotak exports</p>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {importMutation.error && (
              <p className="text-sm text-destructive">{(importMutation.error as any)?.response?.data?.message ?? 'Import failed'}</p>
            )}
            {/* Categorization rules */}
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium bg-muted/50 hover:bg-muted/80 transition-colors"
                onClick={() => setShowRules((v) => !v)}
              >
                <span>Auto-categorization rules {rules.length > 0 && `(${rules.length})`}</span>
                <span className="text-muted-foreground">{showRules ? '▲' : '▼'}</span>
              </button>
              {showRules && (
                <div className="p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Keyword → category mappings applied after import</p>
                  {rules.map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-muted/30 rounded px-2 py-1">
                      <span><span className="font-mono text-xs">{r.keyword}</span> → {r.categoryName}</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeRule(i)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input
                      placeholder="keyword (e.g. swiggy)"
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      className="text-sm h-8"
                      onKeyDown={(e) => e.key === 'Enter' && addRule()}
                    />
                    <select
                      value={newCategoryId}
                      onChange={(e) => setNewCategoryId(e.target.value)}
                      className="rounded-md border bg-background px-2 py-1 text-sm flex-1"
                    >
                      <option value="">Category</option>
                      {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <Button size="sm" onClick={addRule} className="h-8">Add</Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => importMutation.mutate()} disabled={!file || importMutation.isPending}>
                {importMutation.isPending ? 'Importing…' : 'Import'}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 dark:bg-green-950 p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                <CheckCircle className="h-5 w-5" />
                <span className="font-semibold">Import Complete</span>
              </div>
              <div className="text-sm space-y-1">
                <p>Bank detected: <span className="font-medium">{result.bank}</span></p>
                <p>Rows parsed: <span className="font-medium">{result.total}</span></p>
                <p>Imported: <span className="font-medium text-green-600">{result.imported}</span></p>
                <p>Duplicates skipped: <span className="font-medium text-muted-foreground">{result.duplicatesSkipped}</span></p>
                {result.errors?.length > 0 && <p className="text-orange-600">Errors: {result.errors.length}</p>}
              </div>
              {result.warnings?.length > 0 && (
                <div className="flex items-start gap-2 text-orange-600 text-xs mt-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{result.warnings.join(' ')}</span>
                </div>
              )}
            </div>
            {/* Balance update — only shown when an account was linked */}
            {bankAccountId && (
              <div className="space-y-1">
                <Label>Update account balance (optional)</Label>
                <p className="text-xs text-muted-foreground">Enter the current balance shown in your bank app to keep it in sync.</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 45230.50"
                    value={newBalance}
                    onChange={(e) => setNewBalance(e.target.value)}
                  />
                  {newBalance && (
                    <Button
                      variant="outline"
                      disabled={savingBalance}
                      onClick={async () => {
                        setSavingBalance(true);
                        try {
                          await api.put(`/accounts/${bankAccountId}`, { currentBalance: Number(newBalance) });
                          qc.invalidateQueries({ queryKey: ['accounts'] });
                          toast({ title: 'Account balance updated', variant: 'success' });
                          setNewBalance('');
                        } catch {
                          toast({ title: 'Failed to update balance', variant: 'error' });
                        } finally {
                          setSavingBalance(false);
                        }
                      }}
                    >
                      {savingBalance ? 'Saving…' : 'Save'}
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-3">
              {rules.length > 0 && (
                <Button variant="outline" className="flex-1" onClick={applyRules} disabled={applying}>
                  {applying ? 'Applying…' : `Apply ${rules.length} rule${rules.length !== 1 ? 's' : ''}`}
                </Button>
              )}
              <Button className={rules.length > 0 ? 'flex-1' : 'w-full'} onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteConfirmModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/transactions/${tx.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      toast({ title: 'Transaction deleted', variant: 'success' });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Delete failed',
        description: err?.response?.data?.message ?? 'Something went wrong',
        variant: 'error',
      });
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg border shadow-xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold">Delete Transaction</h2>
        <p className="text-sm text-muted-foreground">
          Delete <span className="font-medium text-foreground">"{tx.description}"</span>? This cannot be undone.
        </p>
        {deleteMutation.error && (
          <p className="text-sm text-destructive">
            {(deleteMutation.error as any)?.response?.data?.message ?? 'Delete failed'}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddTransactionModal({ onClose, budgetActuals }: { onClose: () => void; budgetActuals: BudgetActualItem[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: loans = [] } = useLoans();

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<TxForm>({
    resolver: zodResolver(txSchema),
    defaultValues: { type: 'EXPENSE', date: new Date().toISOString().slice(0, 10) },
  });

  const amount = watch('amount');
  const selectedType = watch('type');
  const selectedCategoryId = watch('categoryId');

  const createMutation = useMutation({
    mutationFn: (data: TxForm) => api.post('/transactions', {
      ...data,
      tags: data.tags ? data.tags.split(',').map((t) => t.trim()) : [],
      loanId: data.loanId || undefined,
    }),
    onSuccess: (_, submittedData) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
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
              description: `₹${projectedActual.toLocaleString('en-IN')} spent of ₹${Number(budget.amount).toLocaleString('en-IN')} budget`,
              variant: 'error',
            });
          } else if (projectedPct >= 80) {
            toast({
              title: `Budget warning: ${budget.category.name}`,
              description: `${projectedPct.toFixed(0)}% used — ₹${(Number(budget.amount) - projectedActual).toLocaleString('en-IN')} remaining`,
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
              <Label>Description</Label>
              <Input {...register('description')} placeholder="e.g. Swiggy order" />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Amount (₹)</Label>
              <Input {...register('amount')} type="number" step="0.01" />
              {amount && <p className="text-xs text-muted-foreground">{Number(amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}</p>}
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <select {...register('type')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Income</option>
                <option value="TRANSFER">Transfer</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input {...register('date')} type="date" />
            </div>
            <div className="space-y-1">
              <Label>Payment Mode</Label>
              <select {...register('paymentMode')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Select —</option>
                {['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <select {...register('categoryId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— Uncategorized —</option>
                {categories.map((c: any) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>{selectedType === 'TRANSFER' ? 'From Account' : 'Bank Account'}</Label>
              <select {...register('bankAccountId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">— None —</option>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.bankName} ····{a.accountNumberLast4 ?? ''}</option>)}
              </select>
            </div>
            {selectedType === 'TRANSFER' && (
              <div className="col-span-2 space-y-1">
                <Label>To Account</Label>
                <select {...register('transferToAccountId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— Select destination —</option>
                  {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.bankName} ····{a.accountNumberLast4 ?? ''}</option>)}
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
                      {l.lenderName} ({l.loanType}) — ₹{Number(l.outstandingBalance).toLocaleString('en-IN')} outstanding
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-2 space-y-1">
              <Label>Tags (comma-separated)</Label>
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

async function downloadTransactionsCsv(fy: string) {
  const res = await fetch(`/api/transactions/export?fy=${encodeURIComponent(fy)}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${fy}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function TransactionsPage() {
  const { selectedFY } = useFY();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingOtherMember = isAdmin && viewUserId !== undefined;
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkCategorizing, setIsBulkCategorizing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<TxFilters>({
    search: '',
    type: '',
    categoryId: '',
    paymentMode: '',
    startDate: searchParams.get('startDate') ?? '',
    endDate: searchParams.get('endDate') ?? '',
  });

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  // Clear selection whenever the visible dataset changes
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkConfirmDelete(false);
  }, [filters, selectedFY]);

  // Auto-open add modal or filters from URL params
  useEffect(() => {
    if (searchParams.get('add') === '1') {
      setShowAdd(true);
    }
    if (searchParams.get('startDate') || searchParams.get('endDate')) {
      setShowFilters(true);
    }
    if (searchParams.get('add') || searchParams.get('startDate') || searchParams.get('endDate')) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const canEdit = (tx: Transaction) =>
    user?.role === 'ADMIN' || user?.id === tx.userId;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    setIsBulkDeleting(true);
    try {
      const ids = [...selectedIds];
      const results = await Promise.allSettled(ids.map((id) => api.delete(`/transactions/${id}`)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = ids.length - failed;
      qc.invalidateQueries({ queryKey: ['transactions'] });
      if (failed === 0) {
        toast({ title: `Deleted ${succeeded} transaction${succeeded !== 1 ? 's' : ''}`, variant: 'success' });
      } else {
        toast({ title: `Deleted ${succeeded}/${ids.length} — ${failed} failed`, variant: 'warning' });
      }
      setSelectedIds(new Set());
      setBulkConfirmDelete(false);
    } finally {
      setIsBulkDeleting(false);
    }
  }

  async function handleBulkCategorize() {
    if (!bulkCategoryId) return;
    setIsBulkCategorizing(true);
    try {
      const ids = [...selectedIds];
      const results = await Promise.allSettled(ids.map((id) => api.put(`/transactions/${id}`, { categoryId: bulkCategoryId })));
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = ids.length - failed;
      qc.invalidateQueries({ queryKey: ['transactions'] });
      if (failed === 0) {
        toast({ title: `Categorized ${succeeded} transaction${succeeded !== 1 ? 's' : ''}`, variant: 'success' });
      } else {
        toast({ title: `Categorized ${succeeded}/${ids.length} — ${failed} failed`, variant: 'warning' });
      }
      setSelectedIds(new Set());
      setBulkCategoryId('');
    } finally {
      setIsBulkCategorizing(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await downloadTransactionsCsv(selectedFY);
    } finally {
      setExporting(false);
    }
  }

  const { data: categories = [] } = useCategories();
  const { data: budgetActuals = [] } = useBudgetsVsActuals(selectedFY);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ['transactions', selectedFY, filters, viewUserId],
    queryFn: ({ pageParam }) => fetchTransactions(selectedFY, filters, pageParam as string | undefined, viewUserId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
  });

  if (isLoading) return <PageLoader />;

  const transactions = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.pagination.total ?? 0;

  const allSelectableIds = transactions
    .filter((tx) => !tx.transferPairId && canEdit(tx))
    .map((tx) => tx.id);
  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every((id) => selectedIds.has(id));

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allSelectableIds));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground">
            FY {selectedFY} · {total} transactions
            {isAdmin && viewUserId
              ? ` · ${members.find((m) => m.id === viewUserId)?.name ?? 'Member'}`
              : isAdmin ? ' · All Family' : ''}
          </p>
          {isAdmin && !isMembersLoading && (
            <div className="flex items-center gap-2 mt-2">
              <label htmlFor="tx-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
              {isMembersError ? (
                <span className="text-xs text-destructive">Could not load members</span>
              ) : (
                <select
                  id="tx-member-select"
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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowFilters((v) => !v)} className="relative">
            <SlidersHorizontal className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export CSV'}</span>
          </Button>
          {!isViewingOtherMember && (
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Import CSV</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="col-span-2 md:col-span-3 lg:col-span-1">
              <Input
                placeholder="Search description…"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              />
            </div>
            <select
              value={filters.type}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All types</option>
              <option value="INCOME">Income</option>
              <option value="EXPENSE">Expense</option>
              <option value="TRANSFER">Transfer</option>
            </select>
            <select
              value={filters.categoryId}
              onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All categories</option>
              {categories.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={filters.paymentMode}
              onChange={(e) => setFilters((f) => ({ ...f, paymentMode: e.target.value }))}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All modes</option>
              {['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <Input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
              className="text-sm"
              title="From date"
            />
            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
              className="text-sm"
              title="To date"
            />
          </div>
          {activeFilterCount > 0 && (
            <div className="flex">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({ search: '', type: '', categoryId: '', paymentMode: '', startDate: '', endDate: '' })}
              >
                <X className="h-3.5 w-3.5 mr-1" /> Clear all
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <select
              value={bulkCategoryId}
              onChange={(e) => setBulkCategoryId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="">Assign category…</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={handleBulkCategorize} disabled={!bulkCategoryId || isBulkCategorizing}>
              {isBulkCategorizing ? 'Applying…' : 'Apply'}
            </Button>
            {bulkConfirmDelete ? (
              <>
                <span className="text-sm text-destructive font-medium">Delete {selectedIds.size}?</span>
                <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting}>
                  {isBulkDeleting ? 'Deleting…' : 'Confirm'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setBulkConfirmDelete(false)}>Cancel</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive border-destructive/30" onClick={() => setBulkConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setSelectedIds(new Set()); setBulkConfirmDelete(false); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {transactions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No transactions yet"
          description="Add your first transaction or import a bank statement to start tracking."
          actionLabel="Import Bank Statement"
          onAction={() => setShowImport(true)}
        />
      ) : (<>
        <div className="hidden sm:block rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded"
                    title="Select all"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mode</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Amount</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className={cn('border-b border-border last:border-0 hover:bg-muted/30 transition-colors', selectedIds.has(tx.id) && 'bg-primary/5')}>
                  <td className="px-3 py-3">
                    {!tx.transferPairId && canEdit(tx) && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(tx.id)}
                        onChange={() => toggleSelect(tx.id)}
                        className="rounded"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {new Date(tx.date).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3 font-medium max-w-[200px] truncate">{tx.description}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {tx.categoryIcon && <span className="mr-1">{tx.categoryIcon}</span>}
                    {tx.categoryName ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {tx.paymentMode && (
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', PAYMENT_MODE_COLORS[tx.paymentMode] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300')}>
                        {PAYMENT_MODE_ICONS[tx.paymentMode]}
                        {tx.paymentMode}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <INRDisplay
                      amount={tx.type === 'EXPENSE' ? -tx.amount : tx.amount}
                      colorCode
                    />
                  </td>
                  <td className="px-4 py-3">
                    {canEdit(tx) && (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingTx(tx)}
                          disabled={!!tx.transferPairId}
                          title={tx.transferPairId ? 'Cannot edit transfers' : 'Edit transaction'}
                          className="h-7 w-7"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeletingTx(tx)}
                          disabled={!!tx.transferPairId}
                          title={tx.transferPairId ? 'Cannot delete transfers' : 'Delete transaction'}
                          className="h-7 w-7 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile card list — sm:hidden so it only shows below 640px */}
        <div className="sm:hidden rounded-xl border border-border bg-card divide-y divide-border">
          {transactions.map((tx) => {
            const isTransfer = !!tx.transferPairId;
            return (
              <div key={tx.id} className={cn('p-3 space-y-1.5', selectedIds.has(tx.id) && 'bg-primary/5')}>
                {/* Row 1: description + date */}
                <div className="flex items-start justify-between gap-2">
                  {!isTransfer && canEdit(tx) && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(tx.id)}
                      onChange={() => toggleSelect(tx.id)}
                      className="rounded mt-0.5 shrink-0"
                    />
                  )}
                  <span className="font-medium text-sm truncate">{tx.description}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {new Date(tx.date).toLocaleDateString('en-IN')}
                  </span>
                </div>
                {/* Row 2: badges */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isTransfer && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      Transfer
                    </span>
                  )}
                  {tx.categoryName ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                      {tx.categoryIcon}
                      {tx.categoryName}
                    </span>
                  ) : !isTransfer && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                  {tx.paymentMode && (
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', PAYMENT_MODE_COLORS[tx.paymentMode] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300')}>
                      {PAYMENT_MODE_ICONS[tx.paymentMode]}
                      {tx.paymentMode}
                    </span>
                  )}
                </div>
                {/* Row 3: amount + actions */}
                <div className="flex items-center justify-between">
                  {canEdit(tx) && !isTransfer ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingTx(tx)}
                        title="Edit transaction"
                        className="h-7 w-7"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingTx(tx)}
                        title="Delete transaction"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div />
                  )}
                  <INRDisplay amount={tx.type === 'EXPENSE' ? -tx.amount : tx.amount} colorCode />
                </div>
              </div>
            );
          })}
        </div>
      </>)}

      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : `Load more (${transactions.length} of ${total} shown)`}
          </Button>
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showAdd && <AddTransactionModal onClose={() => setShowAdd(false)} budgetActuals={budgetActuals} />}
      {editingTx && <EditTransactionModal tx={editingTx} onClose={() => setEditingTx(null)} />}
      {deletingTx && <DeleteConfirmModal tx={deletingTx} onClose={() => setDeletingTx(null)} />}
    </div>
  );
}
