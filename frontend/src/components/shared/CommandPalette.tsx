import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { INRDisplay } from './INRDisplay';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface TxResult {
  id: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  date: string;
  categoryName?: string;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['cmd-search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return [];
      const res = await api.get<{ data: TxResult[] }>('/transactions', {
        params: { search: debouncedQuery, limit: 8 },
      });
      return res.data.data;
    },
    enabled: debouncedQuery.trim().length > 0,
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transactions…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">Esc</kbd>
          )}
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto">
          {isFetching && (
            <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
          )}
          {!isFetching && debouncedQuery && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No results for "{debouncedQuery}"</p>
          )}
          {!debouncedQuery && (
            <p className="px-4 py-8 text-sm text-center text-muted-foreground">Type to search transactions</p>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 text-left transition-colors border-b border-border last:border-0"
              onClick={() => {
                navigate('/transactions');
                onClose();
              }}
            >
              <div className="min-w-0 mr-4">
                <p className="text-sm font-medium truncate">{r.description}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.date).toLocaleDateString('en-IN')}
                  {r.categoryName ? ` · ${r.categoryName}` : ''}
                </p>
              </div>
              <INRDisplay
                amount={r.type === 'EXPENSE' ? -r.amount : r.amount}
                colorCode
                className="text-sm font-medium shrink-0"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
