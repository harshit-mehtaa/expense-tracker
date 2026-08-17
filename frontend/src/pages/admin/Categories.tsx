import { useState, useEffect } from 'react';
import type { JSX } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Tag, Plus, MoreVertical, Lock, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { CategoryIcon } from '@/components/shared/CategoryIcon';
import { formatDate } from '@/lib/dateFormat';
import { INRDisplay } from '@/components/shared/INRDisplay';
import {
  getCategoryLabel,
  getCategoryPath,
  isCategoryDescendant,
  sortCategoriesByNameAsc,
} from '@/lib/categoryUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY';
  icon?: string | null;
  color?: string | null;
  parentId?: string | null;
  parent?: Category | null;
  _count?: { children: number };
  isDefault: boolean;
  userId: string | null;
  /** Family-wide usage. `direct` is what is filed against this category itself;
   *  `rollup` includes every descendant, so a category used purely as a grouping does
   *  not read as dead. Totals cover EXPENSE transactions only. */
  usage?: {
    directCount: number;
    directTotal: number;
    rollupCount: number;
    rollupTotal: number;
    lastUsed: string | null;
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Maximum 50 characters'),
  type: z.enum(['INCOME', 'EXPENSE', 'ASSET', 'LIABILITY'], { required_error: 'Type is required' }),
  icon: z.string().trim().max(30, 'Maximum 30 characters').optional(),
  parentId: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Enter a valid hex color (e.g. #22c55e)')
    .optional()
    .or(z.literal('')),
});

type CategoryForm = z.infer<typeof categorySchema>;

const editCategorySchema = categorySchema.extend({
  type: categorySchema.shape.type.optional(),
});
type EditCategoryForm = z.infer<typeof editCategorySchema>;

// ── Data hook ─────────────────────────────────────────────────────────────────

function useCategories() {
  return useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => api.get<{ data: Category[] }>('/categories').then((r) => r.data.data),
  });
}

// ── Preset colors ─────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#22c55e', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#f97316', '#ec4899', '#14b8a6', '#64748b',
];

const EMOJI_PRESETS = [
  '🍽️', '🥦', '🛒', '🍕', '💊', '🏥', '📺', '💇', '🏠',
  '🚗', '💡', '🎓', '🎬', '✈️', '💼', '💰', '📈', '🏦',
  '🧾', '🎁', '🛡️', '📱', '👕', '💳',
];

type CategoryPayload = {
  name?: string;
  type?: Category['type'];
  icon?: string | null;
  parentId?: string | null;
  color?: string;
};

function buildCategoryPayload(data: CategoryForm | EditCategoryForm): CategoryPayload {
  const payload: CategoryPayload = { ...data };
  if ('icon' in payload) {
    payload.icon = payload.icon?.trim() ? payload.icon.trim() : null;
  }
  if ('color' in payload && !payload.color?.trim()) {
    delete payload.color;
  }
  if ('parentId' in payload) {
    payload.parentId = payload.parentId?.trim() ? payload.parentId : null;
  }
  return payload;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [deleteCat, setDeleteCat] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [mergeCat, setMergeCat] = useState<Category | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [reassignToId, setReassignToId] = useState('');
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const { data: categories = [], isLoading, isError } = useCategories();

  // Close menu on Escape
  useEffect(() => {
    if (!activeMenu) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActiveMenu(null);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeMenu]);

  // ── Add form ───────────────────────────────────────────────────────────────
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CategoryForm>({
    resolver: zodResolver(categorySchema),
    // No colour preselected. The form used to default to COLOR_PRESETS[0], which meant
    // every new category was created green: the backend applies its own styling only when
    // no colour is sent, so a preselected swatch silently overrode it every time.
    defaultValues: { type: 'EXPENSE', color: '', parentId: '' },
  });

  // ── Edit form ──────────────────────────────────────────────────────────────
  const {
    register: editRegister,
    handleSubmit: editHandleSubmit,
    reset: editReset,
    watch: editWatch,
    setValue: editSetValue,
    formState: { errors: editErrors },
  } = useForm<EditCategoryForm>({ resolver: zodResolver(editCategorySchema) });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const [addError, setAddError] = useState<string | null>(null);
  const invalidateCategoryData = () => {
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['categories', 'all'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['category-rules'] });
    qc.invalidateQueries({ queryKey: ['budgets-actuals'] });
  };

  const addMutation = useMutation({
    mutationFn: (data: CategoryForm) => api.post('/categories', buildCategoryPayload(data)),
    onSuccess: () => {
      invalidateCategoryData();
      setShowAdd(false);
      reset();
      setAddError(null);
    },
    onError: (err: any) => {
      setAddError(err?.response?.data?.message ?? 'Failed to create category');
    },
  });

  const [editError, setEditError] = useState<string | null>(null);
  const editMutation = useMutation({
    mutationFn: ({ id, ...data }: EditCategoryForm & { id: string }) =>
      api.put(`/categories/${id}`, buildCategoryPayload(data)),
    onSuccess: () => {
      invalidateCategoryData();
      setEditCat(null);
      setEditError(null);
    },
    onError: (err: any) => {
      setEditError(err?.response?.data?.message ?? 'Failed to update category');
    },
  });

  const mergeMutation = useMutation({
    mutationFn: ({ id, targetId }: { id: string; targetId: string }) =>
      api.post(`/categories/${id}/merge`, { targetId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      // Transactions moved category, so anything showing them is stale too.
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setMergeCat(null); setMergeTargetId(''); setMergeError(null);
    },
    onError: (err: any) => setMergeError(err?.response?.data?.message ?? 'Merge failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, reassignTo }: { id: string; reassignTo?: string }) =>
      api.delete(`/categories/${id}`, { params: reassignTo ? { reassignTo } : {} }),
    onSuccess: () => {
      invalidateCategoryData();
      // Transactions may have moved category, so anything rendering them is stale.
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setDeleteCat(null);
      setDeleteError(null);
      setReassignToId('');
    },
    onError: (err: any) => {
      setDeleteError(err?.response?.data?.message ?? 'Failed to delete category');
    },
  });

  const openMerge = (cat: Category) => {
    setMergeError(null);
    setMergeTargetId('');
    setMergeCat(cat);
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const openEdit = (cat: Category) => {
    setEditError(null);
    editReset({
      name: cat.name,
      type: cat.type,
      parentId: cat.parentId ?? '',
      icon: cat.icon ?? '',
      color: cat.color ?? '',
    });
    setEditCat(cat);
    setActiveMenu(null);
  };

  const openDelete = (cat: Category) => {
    if (cat.isDefault) return; // should never happen — UI hides Delete for defaults
    setDeleteError(null);
    setDeleteCat(cat);
    setActiveMenu(null);
  };

  // Group by type
  const expenseCategories = categories.filter((c) => c.type === 'EXPENSE');
  const incomeCategories = categories.filter((c) => c.type === 'INCOME');
  const assetCategories = categories.filter((c) => c.type === 'ASSET');
  const liabilityCategories = categories.filter((c) => c.type === 'LIABILITY');

  const addColor = watch('color');
  const editColor = editWatch('color');
  const addIcon = watch('icon');
  const editIcon = editWatch('icon');
  const addType = watch('type');
  const editType = editWatch('type') ?? editCat?.type;
  const addParentOptions = sortCategoriesByNameAsc(categories.filter((c) => c.type === addType));
  const editParentOptions = sortCategoriesByNameAsc(categories.filter((c) => (
    c.type === editType
    && c.id !== editCat?.id
    && (!editCat || !isCategoryDescendant(c, editCat.id, categories))
  )));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage categories shared across your family.
          </p>
        </div>
        <Button onClick={() => { setAddError(null); reset(); setShowAdd(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Category
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Loading categories…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-16 text-destructive text-sm">
          Failed to load categories. Please refresh the page.
        </div>
      ) : (
        <div className="space-y-8">
          {/* Expense categories */}
          <CategoryGroup
            title="Expense Categories"
            type="EXPENSE"
            categories={expenseCategories}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            onEdit={openEdit}
            onDelete={openDelete}
            onMerge={openMerge}
          />
          {/* Income categories */}
          <CategoryGroup
            title="Income Categories"
            type="INCOME"
            categories={incomeCategories}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            onEdit={openEdit}
            onDelete={openDelete}
            onMerge={openMerge}
          />
          {/* Asset categories */}
          <CategoryGroup
            title="Asset Categories"
            type="ASSET"
            categories={assetCategories}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            onEdit={openEdit}
            onDelete={openDelete}
            onMerge={openMerge}
          />
          {/* Liability categories */}
          <CategoryGroup
            title="Liability Categories"
            type="LIABILITY"
            categories={liabilityCategories}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            onEdit={openEdit}
            onDelete={openDelete}
            onMerge={openMerge}
          />
        </div>
      )}

      {/* Outside-click backdrop for action menu */}
      {activeMenu && (
        <div className="fixed inset-0 z-[1]" onClick={() => setActiveMenu(null)} />
      )}

      {/* ── Add modal ────────────────────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6 space-y-5">
            <h2 className="text-lg font-semibold">Add Category</h2>
            <form
              onSubmit={handleSubmit((data) => addMutation.mutate(data))}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="add-name" required>Name</Label>
                <Input id="add-name" placeholder="e.g. Groceries" {...register('name')} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-type" required>Type</Label>
                <select
                  id="add-type"
                  {...register('type')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                  <option value="ASSET">Asset</option>
                  <option value="LIABILITY">Liability</option>
                </select>
                {errors.type && <p className="text-xs text-destructive">{errors.type.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-parent">Parent category (optional)</Label>
                <select
                  id="add-parent"
                  {...register('parentId')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">No parent</option>
                  {addParentOptions.map((c) => (
                    <option key={c.id} value={c.id}>{getCategoryLabel(c, categories)}</option>
                  ))}
                </select>
                {errors.parentId && <p className="text-xs text-destructive">{errors.parentId.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-icon">Icon (emoji, optional)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="add-icon"
                    placeholder="e.g. 🛒"
                    maxLength={30}
                    {...register('icon')}
                  />
                  <IconPreview icon={addIcon} />
                </div>
                <EmojiPicker
                  selected={addIcon}
                  onSelect={(emoji) => setValue('icon', emoji, { shouldDirty: true, shouldValidate: true })}
                  onClear={() => setValue('icon', '', { shouldDirty: true, shouldValidate: true })}
                />
                {errors.icon && <p className="text-xs text-destructive">{errors.icon.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Color (optional)</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setValue('color', c)}
                      className={cn(
                        'h-6 w-6 rounded-full border-2 transition-transform',
                        addColor === c ? 'border-foreground scale-110' : 'border-transparent',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <Input
                    className="w-28 font-mono text-xs"
                    placeholder="#22c55e"
                    {...register('color')}
                  />
                </div>
                {errors.color && <p className="text-xs text-destructive">{errors.color.message}</p>}
              </div>

              {addError && <p className="text-xs text-destructive">{addError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setShowAdd(false); setAddError(null); }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={addMutation.isPending}>
                  {addMutation.isPending ? 'Saving…' : 'Add Category'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit modal ───────────────────────────────────────────────────────── */}
      {editCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6 space-y-5">
            <h2 className="text-lg font-semibold">Edit Category</h2>
            <form
              onSubmit={editHandleSubmit((data) => editMutation.mutate({ ...data, id: editCat.id }))}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="edit-name" required>Name</Label>
                <Input id="edit-name" {...editRegister('name')} />
                {editErrors.name && <p className="text-xs text-destructive">{editErrors.name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-type" required>Type</Label>
                <select
                  id="edit-type"
                  {...editRegister('type', { disabled: editCat.isDefault })}
                  disabled={editCat.isDefault}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                  <option value="ASSET">Asset</option>
                  <option value="LIABILITY">Liability</option>
                </select>
                {editCat?.isDefault && (
                  <p className="text-xs text-muted-foreground">Type cannot be changed for default categories.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-parent">Parent category (optional)</Label>
                <select
                  id="edit-parent"
                  {...editRegister('parentId')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">No parent</option>
                  {editParentOptions.map((c) => (
                    <option key={c.id} value={c.id}>{getCategoryLabel(c, categories)}</option>
                  ))}
                </select>
                {editErrors.parentId && <p className="text-xs text-destructive">{editErrors.parentId.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-icon">Icon (emoji, optional)</Label>
                <div className="flex items-center gap-2">
                  <Input id="edit-icon" maxLength={30} {...editRegister('icon')} />
                  <IconPreview icon={editIcon} />
                </div>
                <EmojiPicker
                  selected={editIcon}
                  onSelect={(emoji) => editSetValue('icon', emoji, { shouldDirty: true, shouldValidate: true })}
                  onClear={() => editSetValue('icon', '', { shouldDirty: true, shouldValidate: true })}
                />
                {editErrors.icon && <p className="text-xs text-destructive">{editErrors.icon.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Color (optional)</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => editSetValue('color', c)}
                      className={cn(
                        'h-6 w-6 rounded-full border-2 transition-transform',
                        editColor === c ? 'border-foreground scale-110' : 'border-transparent',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <Input
                    className="w-28 font-mono text-xs"
                    placeholder="#22c55e"
                    {...editRegister('color')}
                  />
                </div>
                {editErrors.color && <p className="text-xs text-destructive">{editErrors.color.message}</p>}
              </div>

              {editError && <p className="text-xs text-destructive">{editError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditCat(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={editMutation.isPending}>
                  {editMutation.isPending ? 'Saving…' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ─────────────────────────────────────────── */}
      {mergeCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">Merge Category</h2>
            <p className="text-sm text-muted-foreground">
              Move everything from{' '}
              <span className="font-medium text-foreground">
                {mergeCat.icon} {getCategoryPath(mergeCat, categories)}
              </span>{' '}
              into another category, then delete it. This is how you get rid of duplicates
              like “Groceries” and “Grocery” without re-filing every transaction by hand.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="merge-target">Merge into</label>
              <select
                id="merge-target"
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Select a category…</option>
                {categories
                  .filter((c) => c.id !== mergeCat.id && c.type === mergeCat.type)
                  .map((c) => (
                    <option key={c.id} value={c.id}>{getCategoryPath(c, categories)}</option>
                  ))}
              </select>
            </div>

            {/* State exactly what moves, before it moves. A merge cannot be undone. */}
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">This will move:</p>
              <p>{mergeCat.usage?.directCount ?? 0} transaction{(mergeCat.usage?.directCount ?? 0) === 1 ? '' : 's'}</p>
              {(mergeCat._count?.children ?? 0) > 0 && (
                <p>
                  {mergeCat._count!.children} sub-categor
                  {mergeCat._count!.children === 1 ? 'y' : 'ies'}, which become sub-categories of the target
                </p>
              )}
              <p>any budgets and rules pointing at it</p>
              <p className="text-destructive">This cannot be undone.</p>
            </div>

            {mergeError && (
              <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2">
                {mergeError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setMergeCat(null); setMergeError(null); }}>
                Cancel
              </Button>
              <Button
                onClick={() => mergeMutation.mutate({ id: mergeCat.id, targetId: mergeTargetId })}
                disabled={!mergeTargetId || mergeMutation.isPending}
              >
                {mergeMutation.isPending ? 'Merging…' : 'Merge'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">Delete Category</h2>
            <p className="text-sm text-muted-foreground">
              Delete{' '}
              <span className="font-medium text-foreground">
                {deleteCat.icon} {getCategoryPath(deleteCat, categories)}
              </span>?
            </p>

            {/* The old dialog said transactions "will become uncategorized" and meant it:
                the FK is SET NULL and nothing checked. Offer somewhere for them to go
                instead of quietly losing the filing. */}
            {(deleteCat.usage?.directCount ?? 0) > 0 ? (
              <div className="space-y-2">
                <p className="text-sm">
                  {deleteCat.usage!.directCount} transaction
                  {deleteCat.usage!.directCount === 1 ? '' : 's'} use this category. Move
                  {deleteCat.usage!.directCount === 1 ? ' it' : ' them'} to:
                </p>
                <select
                  value={reassignToId}
                  onChange={(e) => setReassignToId(e.target.value)}
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  aria-label="Move transactions to"
                >
                  <option value="">Select a category…</option>
                  {categories
                    .filter((c) => c.id !== deleteCat.id && c.type === deleteCat.type)
                    .map((c) => (
                      <option key={c.id} value={c.id}>{getCategoryPath(c, categories)}</option>
                    ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing is filed under it, so nothing will be lost.
              </p>
            )}

            {deleteError && (
              <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setDeleteCat(null); setDeleteError(null); setReassignToId(''); }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate({
                  id: deleteCat.id,
                  reassignTo: reassignToId || undefined,
                })}
                disabled={
                  deleteMutation.isPending
                  || ((deleteCat.usage?.directCount ?? 0) > 0 && !reassignToId)
                }
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconPreview({ icon }: { icon?: string | null }) {
  const value = icon?.trim();

  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/30 text-lg"
      aria-hidden="true"
    >
      {value ? <span>{value}</span> : <Tag className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

interface EmojiPickerProps {
  selected?: string | null;
  onSelect: (emoji: string) => void;
  onClear: () => void;
}

function EmojiPicker({ selected, onSelect, onClear }: EmojiPickerProps) {
  const selectedEmoji = selected?.trim();

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {EMOJI_PRESETS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          title={`Use ${emoji}`}
          aria-label={`Use ${emoji} emoji`}
          onClick={() => onSelect(emoji)}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md border text-base transition-colors hover:bg-muted',
            selectedEmoji === emoji ? 'border-primary bg-primary/10' : 'border-input bg-background',
          )}
        >
          {emoji}
        </button>
      ))}
      {selectedEmoji && (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}

// ── CategoryGroup sub-component ────────────────────────────────────────────────

interface CategoryGroupProps {
  title: string;
  type: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY';
  categories: Category[];
  activeMenu: string | null;
  setActiveMenu: (id: string | null) => void;
  onEdit: (cat: Category) => void;
  onDelete: (cat: Category) => void;
  onMerge: (cat: Category) => void;
}

const TYPE_STYLES: Record<'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY', { color: string; badge: string }> = {
  INCOME:    { color: 'text-green-600 dark:text-green-400',  badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  EXPENSE:   { color: 'text-rose-600 dark:text-rose-400',    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  ASSET:     { color: 'text-blue-600 dark:text-blue-400',    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  LIABILITY: { color: 'text-amber-600 dark:text-amber-400',  badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
};

/**
 * One category row, plus its children indented beneath it.
 *
 * The list used to be flat and alphabetical, so "Food" and "Food › Groceries" could sit
 * far apart and the hierarchy existed only in the data. Rendering the tree makes the
 * structure visible and reorganising it obvious.
 */
function CategoryRow({
  cat, children, depth, collapsed, onToggle, activeMenu, setActiveMenu, onEdit, onDelete, onMerge,
}: {
  cat: Category;
  children: Category[];
  depth: number;
  collapsed: boolean;
  onToggle: () => void;
  activeMenu: string | null;
  setActiveMenu: (id: string | null) => void;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
  onMerge: (c: Category) => void;
}) {
  const usage = cat.usage;
  // Dead means nothing filed against it OR anything under it — a grouping parent is not
  // dead just because it has no transactions of its own.
  const isUnused = !!usage && usage.rollupCount === 0;
  const hasChildren = children.length > 0;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card p-3',
        // NOT dimmed when unused. Reduced opacity reads as "disabled", and an unused
        // category is fully manageable — it is the one most likely to need editing,
        // merging or deleting, so it should be the easiest to reach, not the hardest.
        isUnused && 'border-dashed',
      )}
      style={{ marginLeft: depth * 20 }}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn('shrink-0 text-muted-foreground', !hasChildren && 'invisible')}
        aria-label={collapsed ? `Expand ${cat.name}` : `Collapse ${cat.name}`}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      <div
        className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: cat.color ? `${cat.color}22` : '#f1f5f9' }}
      >
        <CategoryIcon name={cat.name} icon={cat.icon} color={cat.color} size={18} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{cat.name}</p>
          {cat.isDefault && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          {isUnused ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
              Never used
            </span>
          ) : usage ? (
            <>
              <span>{usage.rollupCount} txn{usage.rollupCount === 1 ? '' : 's'}</span>
              {usage.rollupTotal > 0 && (
                <>
                  <span>·</span>
                  <INRDisplay amount={usage.rollupTotal} />
                </>
              )}
              {/* A grouping parent spends nothing itself; say so rather than let the
                  rolled-up figure imply it did. */}
              {hasChildren && usage.directCount === 0 && <span>· via sub-categories</span>}
              {usage.lastUsed && <span>· last {formatDate(usage.lastUsed)}</span>}
            </>
          ) : null}
        </div>
      </div>

      <div className="relative shrink-0">
        <button
          onClick={() => setActiveMenu(activeMenu === cat.id ? null : cat.id)}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground"
          aria-label={`Actions for ${cat.name}`}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {activeMenu === cat.id && (
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border bg-popover shadow-md">
            <button
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => { setActiveMenu(null); onEdit(cat); }}
            >
              Edit
            </button>
            {!cat.isDefault && (
              <button
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => { setActiveMenu(null); onMerge(cat); }}
              >
                Merge into…
              </button>
            )}
            {!cat.isDefault && (
              <button
                className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-muted"
                onClick={() => { setActiveMenu(null); onDelete(cat); }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryGroup({ title, type, categories, activeMenu, setActiveMenu, onEdit, onDelete, onMerge }: CategoryGroupProps) {
  const { color: typeColor, badge: typeBadge } = TYPE_STYLES[type];
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const childrenOf = new Map<string | null, Category[]>();
  for (const c of sortCategoriesByNameAsc(categories)) {
    const key = c.parentId ?? null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), c]);
  }

  const groupTotal = categories
    .filter((c) => !c.parentId)
    .reduce((sum, c) => sum + (c.usage?.rollupTotal ?? 0), 0);

  const toggle = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderBranch = (parentId: string | null, depth: number): JSX.Element[] =>
    (childrenOf.get(parentId) ?? []).flatMap((cat) => {
      const kids = childrenOf.get(cat.id) ?? [];
      const isCollapsed = collapsed.has(cat.id);
      return [
        <CategoryRow
          key={cat.id}
          cat={cat}
          children={kids}
          depth={depth}
          collapsed={isCollapsed}
          onToggle={() => toggle(cat.id)}
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          onEdit={onEdit}
          onDelete={onDelete}
          onMerge={onMerge}
        />,
        ...(isCollapsed ? [] : renderBranch(cat.id, depth + 1)),
      ];
    });

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className={cn('text-base font-semibold', typeColor)}>{title}</h2>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', typeBadge)}>
          {categories.length}
        </span>
        {groupTotal > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            <INRDisplay amount={groupTotal} /> total
          </span>
        )}
      </div>

      {categories.length === 0 ? (
        <div className="rounded-xl border border-dashed py-6 text-center text-muted-foreground text-sm">
          No {type.toLowerCase()} categories yet. Add one above.
        </div>
      ) : (
        <div className="space-y-2">{renderBranch(null, 0)}</div>
      )}
    </section>
  );
}
