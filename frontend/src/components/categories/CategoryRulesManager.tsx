import { useRef, useState } from 'react';
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

/** A rule before it's saved (and the identity the server's uniqueness check uses). */
export interface RuleDraft {
  matchType: CategoryRuleMatchType;
  pattern: string;
}

// Mirrors of server limits — pinned against the backend source by
// CategoryRulesManager.test.tsx ("client/server rule limits stay in sync").
export const MAX_RULES = 100; // categoryRuleService.MAX_RULES_PER_USER
export const MAX_PATTERN_LENGTH = 200; // routes/categoryRules.ts
export const REGEX_LITERAL_WITH_FLAGS = /^\/[^/]+\/[dgimsuyv]+$/; // utils/safeRegex.ts

const MATCH_TYPE_OPTIONS: Array<{ value: CategoryRuleMatchType; label: string; placeholder: string }> = [
  { value: 'KEYWORD', label: 'Contains text', placeholder: 'text (e.g. swiggy)' },
  { value: 'REGEX', label: 'Regex pattern', placeholder: 'regex (e.g. ^upi/.*swiggy)' },
];

export function errorMessage(err: unknown, fallback: string): string {
  return (err as any)?.response?.data?.message ?? fallback;
}

/** How the server stores a pattern: keywords are case-folded; a regex is kept as typed. */
function normalizePattern(matchType: CategoryRuleMatchType, pattern: string): string {
  const trimmed = pattern.trim();
  return matchType === 'KEYWORD' ? trimmed.toLowerCase() : trimmed;
}

/**
 * The server's rule checks (routes/categoryRules.ts, categoryRuleService, safeRegex), run
 * in the browser so a rule staged in the Add Category dialog can't fail after its category
 * has already been created. The server stays authoritative: the browser's regex engine is
 * newer than the backend's Node 20, so a few modern-syntax patterns pass here and are still
 * rejected there. The 100-rule cap is checked by callers, which know what else is pending.
 */
export function validateRuleInput(
  matchType: CategoryRuleMatchType,
  rawPattern: string,
  existing: RuleDraft[],
): string | null {
  const pattern = rawPattern.trim();
  if (!pattern) return 'Pattern is required';
  if (pattern.length > MAX_PATTERN_LENGTH) return `Pattern must be at most ${MAX_PATTERN_LENGTH} characters`;
  if (matchType === 'REGEX') {
    if (REGEX_LITERAL_WITH_FLAGS.test(pattern)) {
      return 'Enter the pattern without the surrounding slashes and flags — matching is already case-insensitive';
    }
    let re: RegExp;
    try {
      // Compiled, never run against transaction data, in the browser.
      re = new RegExp(pattern, 'i');
    } catch (err) {
      return (err as Error).message;
    }
    if (re.test('')) return 'This pattern matches empty text, so it would match every transaction';
  }
  const normalized = normalizePattern(matchType, pattern);
  // The server's unique key is (user, matchType, pattern) — the category isn't part of it.
  if (existing.some((r) => r.matchType === matchType && normalizePattern(r.matchType, r.pattern) === normalized)) {
    return `A ${matchType.toLowerCase()} rule for "${normalized}" already exists`;
  }
  return null;
}

const capMessage = `You can have at most ${MAX_RULES} auto-categorization rules`;

/** The one place a rule is created from the UI. */
export function postCategoryRule(
  data: RuleDraft & { categoryId: string },
  targetUserId?: string,
) {
  return api.post('/category-rules', data, { params: targetUserId ? { targetUserId } : {} });
}

export function useCategoryRules(targetUserId?: string) {
  return useQuery({
    queryKey: ['category-rules', targetUserId],
    queryFn: () => api.get<{ data: CategoryRule[] }>('/category-rules', {
      params: targetUserId ? { targetUserId } : {},
    }).then((r) => r.data.data),
  });
}

// ── Presentational pieces shared by every rule editor ────────────────────────
// Every button is type="button" and Enter is preventDefault'ed: these render inside dialogs
// that contain a category <form>, and the shared <Button> has no default type.

interface RuleListItem extends RuleDraft {
  key: string;
  categoryLabel?: string;
}

function RuleList({ label, items, removeLabel, onRemove, removing }: {
  label: string;
  items: RuleListItem[];
  removeLabel: string;
  onRemove: (key: string) => void;
  removing?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <ol className="space-y-1" aria-label={label}>
      {items.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-2 text-sm bg-muted/30 rounded px-2 py-1">
          <span className="min-w-0 break-all">
            {r.matchType === 'REGEX' ? (
              <>
                <span className="mr-1 rounded bg-primary/10 px-1 text-[10px] font-medium uppercase text-primary">regex</span>
                <span className="font-mono text-xs">/{r.pattern}/</span>
              </>
            ) : (
              <span className="font-mono text-xs">{r.pattern}</span>
            )}
            {r.categoryLabel && <>{' → '}{r.categoryLabel}</>}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            aria-label={`${removeLabel} ${r.pattern}`}
            disabled={removing}
            onClick={() => onRemove(r.key)}
          >
            <X className="h-3 w-3" />
          </Button>
        </li>
      ))}
    </ol>
  );
}

/**
 * Match type + pattern (+ category, when `categories` is given) + Add. Validates with
 * `validate`, then hands the draft to `onAdd`, which resolves true if the input should clear.
 */
function RuleForm({ defaultMatchType, categories, validate, onAdd, pending, disabled, serverError, onEdit }: {
  defaultMatchType: CategoryRuleMatchType;
  categories?: CategoryLike[];
  validate: (draft: RuleDraft) => string | null;
  onAdd: (draft: RuleDraft & { categoryId: string }) => boolean | Promise<boolean>;
  pending?: boolean;
  disabled?: boolean;
  serverError?: string | null;
  onEdit?: () => void;
}) {
  const [matchType, setMatchType] = useState<CategoryRuleMatchType>(defaultMatchType);
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  // Guards a second Enter/click before the first add settles (it would POST twice).
  const inFlight = useRef(false);

  // An error describes the input that was submitted; once the user edits, it's stale.
  function clearErrors() {
    setInputError(null);
    onEdit?.();
  }

  async function addRule() {
    const trimmed = pattern.trim();
    if (inFlight.current || pending || disabled || !trimmed || (categories && !categoryId)) return;
    const error = validate({ matchType, pattern: trimmed });
    if (error) {
      setInputError(error);
      return;
    }
    // Not lowercased here: the backend folds keywords itself, and lowercasing a regex
    // would change its meaning (\D → \d).
    inFlight.current = true;
    try {
      if (await onAdd({ matchType, pattern: trimmed, categoryId })) {
        setPattern('');
        setCategoryId('');
      }
    } finally {
      inFlight.current = false;
    }
  }

  const placeholder = MATCH_TYPE_OPTIONS.find((o) => o.value === matchType)!.placeholder;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Match type"
          value={matchType}
          onChange={(e) => { setMatchType(e.target.value as CategoryRuleMatchType); clearErrors(); }}
          className="rounded-md border bg-background px-2 py-1 text-sm"
          disabled={disabled}
        >
          {MATCH_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Input
          aria-label="Pattern"
          placeholder={placeholder}
          value={pattern}
          maxLength={MAX_PATTERN_LENGTH}
          onChange={(e) => { setPattern(e.target.value); clearErrors(); }}
          className={`text-sm h-8 flex-1 min-w-[8rem] ${matchType === 'REGEX' ? 'font-mono' : ''}`}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void addRule();
          }}
        />
        {categories && (
          <select
            aria-label="Category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm flex-1"
            disabled={disabled}
          >
            <option value="">{categories.length === 0 ? 'No categories available' : 'Category'}</option>
            {toCategoryTreeOptions(categories).map(({ category: c, depth }) => (
              <option key={c.id} value={c.id}>{getCategoryTreeOptionLabel(c, depth)}</option>
            ))}
          </select>
        )}
        <Button type="button" size="sm" onClick={() => void addRule()} disabled={pending || disabled} className="h-8">
          Add
        </Button>
      </div>
      {inputError && <p className="text-xs text-destructive">{inputError}</p>}
      {serverError && <p className="text-xs text-destructive">{serverError}</p>}
    </>
  );
}

// ── Saved rules (dedicated section, import dialog, Edit Category dialog) ──────

/**
 * Lists and edits a user's saved auto-categorization rules — changes save immediately.
 * Used on the Categories page (the signed-in user's own rules), in the statement-import
 * dialog (where an ADMIN may be acting for `targetUserId`), and — with `categoryId` — in the
 * Edit Category dialog, scoped to that one category. Every mode reads and invalidates the
 * same ['category-rules'] cache, so they all show the same rules.
 */
export function CategoryRulesManager({
  categories,
  targetUserId,
  categoryId,
}: {
  categories: CategoryLike[];
  targetUserId?: string;
  categoryId?: string;
}) {
  const qc = useQueryClient();
  const { data: rules = [], isLoading, isError } = useCategoryRules(targetUserId);
  // Rules only ever assign INCOME/EXPENSE categories (the backend enforces this too).
  const ruleCategories = categories.filter((c) => c.type === 'INCOME' || c.type === 'EXPENSE');
  const scoped = categoryId !== undefined;
  const shown = scoped ? rules.filter((r) => r.categoryId === categoryId) : rules;

  const addRuleMutation = useMutation({
    mutationFn: (data: RuleDraft & { categoryId: string }) => postCategoryRule(data, targetUserId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-rules'] }),
  });

  const removeRuleMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/category-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['category-rules'] }),
  });

  const noCategories = !scoped && ruleCategories.length === 0;

  return (
    <div className="space-y-2">
      {!scoped && (
        <p className="text-xs text-muted-foreground">
          Transactions added without a category are matched against their description, ignoring
          case. Regex rules are checked first (oldest first), then text rules (A–Z); the first
          match wins. Rules are listed in that order.
        </p>
      )}
      {noCategories && (
        <p className="text-xs text-amber-600">
          Create at least one income or expense category before adding auto-categorization rules.
        </p>
      )}
      {isError && <p className="text-xs text-destructive">Could not load rules.</p>}
      {!noCategories && !isLoading && !isError && shown.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {scoped ? 'No rules for this category yet.' : 'No rules saved yet.'}
        </p>
      )}

      <RuleList
        label={scoped ? 'Rules for this category' : 'Auto-categorization rules'}
        items={shown.map((r) => ({
          key: r.id,
          matchType: r.matchType,
          pattern: r.pattern,
          categoryLabel: scoped ? undefined : getCategoryLabel(r.category, categories),
        }))}
        removeLabel="Delete rule"
        onRemove={(id) => removeRuleMutation.mutate(id)}
        removing={removeRuleMutation.isPending}
      />
      {removeRuleMutation.isError && (
        <p className="text-xs text-destructive">{errorMessage(removeRuleMutation.error, 'Could not delete rule')}</p>
      )}

      <RuleForm
        defaultMatchType={scoped ? 'REGEX' : 'KEYWORD'}
        categories={scoped ? undefined : ruleCategories}
        validate={(draft) => (rules.length >= MAX_RULES ? capMessage : validateRuleInput(draft.matchType, draft.pattern, rules))}
        onAdd={async (draft) => {
          try {
            await addRuleMutation.mutateAsync({ ...draft, categoryId: categoryId ?? draft.categoryId });
            return true;
          } catch {
            return false; // shown below via addRuleMutation.error
          }
        }}
        pending={addRuleMutation.isPending}
        disabled={noCategories}
        serverError={addRuleMutation.isError ? errorMessage(addRuleMutation.error, 'Could not save rule') : null}
        onEdit={() => { if (addRuleMutation.isError) addRuleMutation.reset(); }}
      />
    </div>
  );
}

// ── Staged rules (Add Category dialog) ────────────────────────────────────────

/**
 * Rules for a category that doesn't exist yet: held locally and saved by the caller once
 * the category is created. Validated against the user's saved rules AND each other, so
 * they can't fail for any deterministic reason after the category is saved.
 */
export function StagedCategoryRules({ value, onChange, existingRules, rulesUnavailable, disabled }: {
  value: RuleDraft[];
  onChange: (rules: RuleDraft[]) => void;
  existingRules: RuleDraft[];
  /** The saved rules are still loading or failed to load — duplicates can't be checked. */
  rulesUnavailable?: boolean;
  /** Locked while the caller saves: an edit then would diverge from what gets saved. */
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Rules are saved when you add the category.</p>
      {rulesUnavailable && (
        <p className="text-xs text-amber-600">
          Your existing rules aren&apos;t loaded, so a duplicate would only be caught when saving.
        </p>
      )}
      <RuleList
        label="Rules to add"
        // Unique by construction: validation rejects a second (matchType, normalized pattern).
        items={value.map((r) => ({ ...r, key: stagedKey(r) }))}
        removeLabel="Remove rule"
        onRemove={(key) => onChange(value.filter((r) => stagedKey(r) !== key))}
        removing={disabled}
      />
      <RuleForm
        defaultMatchType="REGEX"
        validate={(draft) => (existingRules.length + value.length >= MAX_RULES
          ? capMessage
          : validateRuleInput(draft.matchType, draft.pattern, [...existingRules, ...value]))}
        onAdd={({ matchType, pattern }) => {
          onChange([...value, { matchType, pattern }]);
          return true;
        }}
        disabled={disabled}
      />
    </div>
  );
}

function stagedKey(rule: RuleDraft): string {
  return `${rule.matchType}:${normalizePattern(rule.matchType, rule.pattern)}`;
}
