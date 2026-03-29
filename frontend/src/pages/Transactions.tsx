import { useState, useRef, useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useFY } from '@/contexts/FYContext';
import { useSearchParams } from 'react-router-dom';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { Receipt, Upload, Plus, X, CheckCircle, AlertCircle, Download, Pencil, Trash2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { loansApi } from '@/api/loans';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  date: string;
  paymentMode?: string;
  categoryName?: string;
  categoryId?: string;
  bankAccountName?: string;
  userId: string;
  transferPairId?: string | null;
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

async function fetchTransactions(fy: string, filters: TxFilters, cursor?: string): Promise<TransactionsResponse> {
  const res = await api.get<{ data: Transaction[]; pagination: TransactionsResponse['pagination'] }>('/transactions', {
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
    },
  });
  return { data: res.data.data, pagination: res.data.pagination };
}

const PAYMENT_MODE_COLORS: Record<string, string> = {
  UPI: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  NEFT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  RTGS: 'bg-yellow-100 text-yellow-700',
  IMPS: 'bg-yellow-100 text-yellow-700',
  CASH: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  CARD: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  EMI: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  AUTO_DEBIT: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
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

function ImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const [file, setFile] = useState<File | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [bank, setBank] = useState('');
  const [result, setResult] = useState<any>(null);
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
            <Button className="w-full" onClick={onClose}>Done</Button>
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

function AddTransactionModal({ onClose }: { onClose: () => void }) {
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

  const createMutation = useMutation({
    mutationFn: (data: TxForm) => api.post('/transactions', {
      ...data,
      tags: data.tags ? data.tags.split(',').map((t) => t.trim()) : [],
      loanId: data.loanId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      toast({ title: 'Transaction added', variant: 'success' });
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
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
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

  async function handleExport() {
    setExporting(true);
    try {
      await downloadTransactionsCsv(selectedFY);
    } finally {
      setExporting(false);
    }
  }

  const { data: categories = [] } = useCategories();

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ['transactions', selectedFY, filters],
    queryFn: ({ pageParam }) => fetchTransactions(selectedFY, filters, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
  });

  if (isLoading) return <PageLoader />;

  const transactions = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.pagination.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground">FY {selectedFY} · {total} transactions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowFilters((v) => !v)} className="relative">
            <SlidersHorizontal className="h-4 w-4 mr-2" /> Filters
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="h-4 w-4 mr-2" /> {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-2" /> Import CSV
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Transaction
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
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
            <div className="flex gap-2 items-center">
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
                className="text-sm"
                title="From date"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
              className="text-sm max-w-[180px]"
              title="To date"
            />
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({ search: '', type: '', categoryId: '', paymentMode: '', startDate: '', endDate: '' })}
              >
                <X className="h-3.5 w-3.5 mr-1" /> Clear all
              </Button>
            )}
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
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
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
                <tr key={tx.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {new Date(tx.date).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3 font-medium max-w-[200px] truncate">{tx.description}</td>
                  <td className="px-4 py-3 text-muted-foreground">{tx.categoryName ?? '—'}</td>
                  <td className="px-4 py-3">
                    {tx.paymentMode && (
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', PAYMENT_MODE_COLORS[tx.paymentMode] ?? 'bg-gray-100 text-gray-700')}>
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
      )}

      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : `Load more (${transactions.length} of ${total} shown)`}
          </Button>
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showAdd && <AddTransactionModal onClose={() => setShowAdd(false)} />}
      {editingTx && <EditTransactionModal tx={editingTx} onClose={() => setEditingTx(null)} />}
      {deletingTx && <DeleteConfirmModal tx={deletingTx} onClose={() => setDeletingTx(null)} />}
    </div>
  );
}
