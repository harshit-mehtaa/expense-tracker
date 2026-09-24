import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';
import {
  getCategoryLabel,
  getCategoryTreeOptionLabel,
  toCategoryTreeOptions,
  type CategoryLike,
} from '@/lib/categoryUtils';

export type CategoryRuleMatchType = 'KEYWORD' | 'REGEX';

// Mirrors backend categoryRuleService's response. Kept here rather than in `@shared`:
// the production frontend image is built from ./frontend alone and can't see ../shared,
// and the backend can't import it either, so a shared copy would guard nothing.
export interface CategoryRule {
  id: string;
  matchType: CategoryRuleMatchType;
  pattern: string;
  categoryId: string;
  category: CategoryLike & { type: 'INCOME' | 'EXPENSE' };
}

const MATCH_TYPE_OPTIONS: Array<{ value: CategoryRuleMatchType; label: string; placeholder: string }> = [
  { value: 'KEYWORD', label: 'Contains text', placeholder: 'text (e.g. swiggy)' },
  { value: 'REGEX', label: 'Regex pattern', placeholder: 'regex (e.g. ^upi/.*swiggy)' },
];

function errorMessage(err: unknown, fallback: string): string {
  return (err as any)?.response?.data?.message ?? fallback;
}

export function useCategoryRules(targetUserId?: string) {
  return useQuery({
    queryKey: ['category-rules', targetUserId],
    queryFn: () => api.get<{ data: CategoryRule[] }>('/category-rules', {
      params: targetUserId ? { targetUserId } : {},
    }).then((r) => r.data.data),
  });
}

/**
 * Lists and edits a user's auto-categorization rules. Used on the Categories page (the
 * signed-in user's own rules) and in the statement-import dialog (where an ADMIN may be
 * acting for `targetUserId`).
 */
export function CategoryRulesManager({
  categories,
  targetUserId,
}: {
  categories: CategoryLike[];
  targetUserId?: string;
}) {
  const qc = useQueryClient();
  const { data: rules = [], isLoading, isError } = useCategoryRules(targetUserId);
  // Rules only ever assign INCOME/EXPENSE categories (the backend enforces this too).
  const ruleCategories = categories.filter((c) => c.type === 'INCOME' || c.type === 'EXPENSE');

  const [matchType, setMatchType] = useState<CategoryRuleMatchType>('KEYWORD');
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [patternError, setPatternError] = useState<string | null>(null);

  const addRuleMutation = useMutation({
    mutationFn: (data: { matchType: CategoryRuleMatchType; pattern: string; categoryId: string }) =>
      api.post('/category-rules', data, { params: targetUserId ? { targetUserId } : {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-rules'] });
      setPattern('');
      setCategoryId('');
    },
  });

  const removeRuleMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/category-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-rules'] }),
  });

  // An error describes the input that was submitted; once the user edits, it's stale.
  function clearErrors() {
    setPatternError(null);
    if (addRuleMutation.isError) addRuleMutation.reset();
  }

  function addRule() {
    const trimmed = pattern.trim();
    if (!trimmed || !categoryId) return;
    if (matchType === 'REGEX') {
      // Syntax check only — the pattern is compiled, never executed, in the browser.
      try {
        new RegExp(trimmed, 'i');
      } catch (err) {
        setPatternError(`Invalid regular expression: ${(err as Error).message}`);
        return;
      }
    }
    setPatternError(null);
    // Not lowercased here: the backend folds keywords itself, and lowercasing a regex
    // would change its meaning (\D → \d).
    addRuleMutation.mutate({ matchType, pattern: trimmed, categoryId });
  }

  const noCategories = ruleCategories.length === 0;
  const placeholder = MATCH_TYPE_OPTIONS.find((o) => o.value === matchType)!.placeholder;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Transactions added without a category are matched against their description, ignoring
        case. Regex rules are checked first (oldest first), then text rules (A–Z); the first
        match wins. Rules are listed in that order.
      </p>
      {noCategories && (
        <p className="text-xs text-amber-600">
          Create at least one income or expense category before adding auto-categorization rules.
        </p>
      )}
      {isError && <p className="text-xs text-destructive">Could not load rules.</p>}
      {!noCategories && !isLoading && !isError && rules.length === 0 && (
        <p className="text-xs text-muted-foreground">No rules saved yet.</p>
      )}

      {rules.length > 0 && (
        <ol className="space-y-1" aria-label="Auto-categorization rules">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm bg-muted/30 rounded px-2 py-1">
              <span className="min-w-0 break-all">
                {r.matchType === 'REGEX' ? (
                  <>
                    <span className="mr-1 rounded bg-primary/10 px-1 text-[10px] font-medium uppercase text-primary">regex</span>
                    <span className="font-mono text-xs">/{r.pattern}/</span>
                  </>
                ) : (
                  <span className="font-mono text-xs">{r.pattern}</span>
                )}
                {' → '}
                {getCategoryLabel(r.category, categories)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                aria-label={`Delete rule ${r.pattern}`}
                disabled={removeRuleMutation.isPending}
                onClick={() => removeRuleMutation.mutate(r.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {removeRuleMutation.isError && (
        <p className="text-xs text-destructive">{errorMessage(removeRuleMutation.error, 'Could not delete rule')}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Match type"
          value={matchType}
          onChange={(e) => { setMatchType(e.target.value as CategoryRuleMatchType); clearErrors(); }}
          className="rounded-md border bg-background px-2 py-1 text-sm"
          disabled={noCategories}
        >
          {MATCH_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Input
          aria-label="Pattern"
          placeholder={placeholder}
          value={pattern}
          maxLength={200}
          onChange={(e) => { setPattern(e.target.value); clearErrors(); }}
          className={`text-sm h-8 flex-1 min-w-[8rem] ${matchType === 'REGEX' ? 'font-mono' : ''}`}
          disabled={noCategories}
          onKeyDown={(e) => e.key === 'Enter' && addRule()}
        />
        <select
          aria-label="Category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-sm flex-1"
          disabled={noCategories}
        >
          <option value="">{noCategories ? 'No categories available' : 'Category'}</option>
          {toCategoryTreeOptions(ruleCategories).map(({ category: c, depth }) => (
            <option key={c.id} value={c.id}>{getCategoryTreeOptionLabel(c, depth)}</option>
          ))}
        </select>
        <Button size="sm" onClick={addRule} disabled={addRuleMutation.isPending || noCategories} className="h-8">
          Add
        </Button>
      </div>
      {patternError && <p className="text-xs text-destructive">{patternError}</p>}
      {addRuleMutation.isError && (
        <p className="text-xs text-destructive">{errorMessage(addRuleMutation.error, 'Could not save rule')}</p>
      )}
    </div>
  );
}
