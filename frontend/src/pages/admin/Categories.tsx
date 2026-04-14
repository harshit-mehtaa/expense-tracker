import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Tag, Plus, MoreVertical, Pencil, Trash2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  icon?: string | null;
  color?: string | null;
  isDefault: boolean;
  userId: string | null;
}

// ── Validation ────────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Maximum 50 characters'),
  type: z.enum(['INCOME', 'EXPENSE'], { required_error: 'Type is required' }),
  icon: z.string().max(10).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Enter a valid hex color (e.g. #22c55e)')
    .optional()
    .or(z.literal('')),
});

type CategoryForm = z.infer<typeof categorySchema>;

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

// ── Main component ────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [deleteCat, setDeleteCat] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
    defaultValues: { type: 'EXPENSE', color: COLOR_PRESETS[0] },
  });

  // ── Edit form ──────────────────────────────────────────────────────────────
  const {
    register: editRegister,
    handleSubmit: editHandleSubmit,
    reset: editReset,
    watch: editWatch,
    setValue: editSetValue,
    formState: { errors: editErrors },
  } = useForm<CategoryForm>({ resolver: zodResolver(categorySchema) });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const [addError, setAddError] = useState<string | null>(null);
  const addMutation = useMutation({
    mutationFn: (data: CategoryForm) => api.post('/categories', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
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
    mutationFn: ({ id, ...data }: CategoryForm & { id: string }) =>
      api.put(`/categories/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setEditCat(null);
      setEditError(null);
    },
    onError: (err: any) => {
      setEditError(err?.response?.data?.message ?? 'Failed to update category');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setDeleteCat(null);
      setDeleteError(null);
    },
    onError: (err: any) => {
      setDeleteError(err?.response?.data?.message ?? 'Failed to delete category');
    },
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const openEdit = (cat: Category) => {
    setEditError(null);
    editReset({ name: cat.name, type: cat.type, icon: cat.icon ?? '', color: cat.color ?? '' });
    setEditCat(cat);
    setActiveMenu(null);
  };

  const openDelete = (cat: Category) => {
    setDeleteError(null);
    setDeleteCat(cat);
    setActiveMenu(null);
  };

  // Group by type
  const expenseCategories = categories.filter((c) => c.type === 'EXPENSE');
  const incomeCategories = categories.filter((c) => c.type === 'INCOME');

  const addColor = watch('color');
  const editColor = editWatch('color');

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage income and expense categories shared across your family.
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
                <Label htmlFor="add-name">Name</Label>
                <Input id="add-name" placeholder="e.g. Groceries" {...register('name')} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-type">Type</Label>
                <select
                  id="add-type"
                  {...register('type')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                </select>
                {errors.type && <p className="text-xs text-destructive">{errors.type.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-icon">Icon (emoji)</Label>
                <Input id="add-icon" placeholder="e.g. 🛒" maxLength={10} {...register('icon')} />
              </div>

              <div className="space-y-1.5">
                <Label>Color</Label>
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
                <Label htmlFor="edit-name">Name</Label>
                <Input id="edit-name" {...editRegister('name')} />
                {editErrors.name && <p className="text-xs text-destructive">{editErrors.name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-type">Type</Label>
                <select
                  id="edit-type"
                  {...editRegister('type')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-icon">Icon (emoji)</Label>
                <Input id="edit-icon" maxLength={10} {...editRegister('icon')} />
              </div>

              <div className="space-y-1.5">
                <Label>Color</Label>
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
      {deleteCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">Delete Category</h2>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                {deleteCat.icon} {deleteCat.name}
              </span>
              ? Transactions linked to this category will become uncategorized.
            </p>
            {deleteError && (
              <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setDeleteCat(null); setDeleteError(null); }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleteCat.id)}
                disabled={deleteMutation.isPending}
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

// ── CategoryGroup sub-component ────────────────────────────────────────────────

interface CategoryGroupProps {
  title: string;
  type: 'INCOME' | 'EXPENSE';
  categories: Category[];
  activeMenu: string | null;
  setActiveMenu: (id: string | null) => void;
  onEdit: (cat: Category) => void;
  onDelete: (cat: Category) => void;
}

function CategoryGroup({ title, type, categories, activeMenu, setActiveMenu, onEdit, onDelete }: CategoryGroupProps) {
  const typeColor = type === 'INCOME' ? 'text-green-600 dark:text-green-400' : 'text-rose-600 dark:text-rose-400';
  const typeBadge = type === 'INCOME'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className={cn('text-base font-semibold', typeColor)}>{title}</h2>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', typeBadge)}>
          {categories.length}
        </span>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-xl border border-dashed py-6 text-center text-muted-foreground text-sm">
          No {type.toLowerCase()} categories yet. Add one above.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="relative flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors"
            >
              {/* Color swatch */}
              <div
                className="h-9 w-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                style={{ backgroundColor: cat.color ? `${cat.color}22` : '#f1f5f9' }}
              >
                {cat.icon ? (
                  <span>{cat.icon}</span>
                ) : (
                  <Tag className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Name + badge */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{cat.name}</p>
                {cat.isDefault && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <Lock className="h-3 w-3" />
                    Default
                  </span>
                )}
              </div>

              {/* Color dot */}
              {cat.color && (
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
              )}

              {/* Actions (non-default only) */}
              {!cat.isDefault && (
                <div className="relative">
                  <button
                    onClick={() => setActiveMenu(activeMenu === cat.id ? null : cat.id)}
                    className="rounded-md p-1 hover:bg-muted/60 transition-colors"
                  >
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {activeMenu === cat.id && (
                    <div className="absolute right-0 top-7 z-10 min-w-[130px] rounded-lg border bg-popover shadow-md py-1">
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
                        onClick={() => onEdit(cat)}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={() => onDelete(cat)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
