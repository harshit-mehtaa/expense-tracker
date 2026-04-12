import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Users, Plus, MoreVertical, UserX, Key, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

function useUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ data: any[] }>('/admin/users').then((r) => r.data.data),
  });
}

const userSchema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.string().email(),
  password: z.string().min(8, 'Minimum 8 characters'),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
  colorTag: z.string().optional(),
  panNumberMasked: z.string().optional(),
});

const editUserSchema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
  role: z.enum(['ADMIN', 'MEMBER']),
  colorTag: z.string().optional(),
  panNumberMasked: z.string().optional(),
});

type UserForm = z.infer<typeof userSchema>;
type EditUserForm = z.infer<typeof editUserSchema>;

const MEMBER_COLORS = ['#FF9933', '#138808', '#000080', '#9B2335', '#2E86C1', '#8E44AD', '#117A65', '#784212'];

export default function FamilyMembersPage() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [resetPwdUser, setResetPwdUser] = useState<{ id: string; name: string } | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [editUser, setEditUser] = useState<any | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteUser, setDeleteUser] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: users = [], isLoading } = useUsers();

  // Close dropdown on Escape key
  useEffect(() => {
    if (!activeMenu) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActiveMenu(null);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeMenu]);

  // ── Create form ────────────────────────────────────────────────────────────
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<UserForm>({
    resolver: zodResolver(userSchema),
    defaultValues: { role: 'MEMBER', colorTag: MEMBER_COLORS[0] },
  });
  const selectedColor = watch('colorTag');

  // ── Edit form ──────────────────────────────────────────────────────────────
  const {
    register: editRegister,
    handleSubmit: editHandleSubmit,
    reset: editReset,
    watch: editWatch,
    setValue: editSetValue,
    formState: { errors: editErrors },
  } = useForm<EditUserForm>({ resolver: zodResolver(editUserSchema) });
  const editSelectedColor = editWatch('colorTag');

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: UserForm) => api.post('/admin/users', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setShowForm(false); reset(); },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.put(`/admin/users/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const resetPwdMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => api.post(`/admin/users/${id}/reset-password`, { password }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setResetPwdUser(null); setNewPwd(''); },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, ...data }: EditUserForm & { id: string }) => api.put(`/admin/users/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setEditUser(null); setEditError(null); },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Failed to save changes';
      setEditError(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.delete(`/admin/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setDeleteUser(null); setDeleteError(null); },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Failed to delete member';
      setDeleteError(msg);
    },
  });

  const openEditModal = (user: any) => {
    setEditError(null);
    editReset({
      name: user.name,
      email: user.email,
      role: user.role,
      colorTag: user.colorTag ?? MEMBER_COLORS[0],
      panNumberMasked: user.panNumberMasked ?? '',
    });
    setEditUser(user);
    setActiveMenu(null);
  };

  const openDeleteModal = (user: any) => {
    setDeleteError(null);
    setDeleteUser({ id: user.id, name: user.name });
    setActiveMenu(null);
  };

  const isAdmin = currentUser?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Family Members</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage who has access to this family finance tracker</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-2" /> Add Member</Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading members…</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((user: any) => (
            <div key={user.id} className={cn('rounded-lg border bg-card p-5 space-y-3', !user.isActive && 'opacity-60')}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg"
                    style={{ backgroundColor: user.colorTag ?? '#666' }}
                  >
                    {user.name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold">{user.name}</p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>
                </div>
                {isAdmin && (
                  <div className="relative">
                    <Button variant="ghost" size="icon" onClick={() => setActiveMenu(activeMenu === user.id ? null : user.id)}>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                    {activeMenu === user.id && (
                      <div className="absolute right-0 top-8 bg-background border rounded-md shadow-lg z-10 py-1 w-48">
                        <button
                          className="w-full text-left px-4 py-2 text-sm hover:bg-muted flex items-center gap-2"
                          onClick={() => openEditModal(user)}
                        >
                          <Pencil className="h-3 w-3" /> Edit Details
                        </button>
                        <button
                          className="w-full text-left px-4 py-2 text-sm hover:bg-muted flex items-center gap-2"
                          onClick={() => { setResetPwdUser({ id: user.id, name: user.name }); setActiveMenu(null); }}
                        >
                          <Key className="h-3 w-3" /> Reset Password
                        </button>
                        <button
                          className="w-full text-left px-4 py-2 text-sm hover:bg-muted flex items-center gap-2"
                          onClick={() => { toggleActiveMutation.mutate({ id: user.id, isActive: !user.isActive }); setActiveMenu(null); }}
                        >
                          <UserX className="h-3 w-3" /> {user.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        {user.id !== currentUser?.id && (
                          <button
                            className="w-full text-left px-4 py-2 text-sm hover:bg-muted flex items-center gap-2 text-destructive"
                            onClick={() => openDeleteModal(user)}
                          >
                            <Trash2 className="h-3 w-3" /> Delete Member
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  user.role === 'ADMIN' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
                )}>
                  {user.role}
                </span>
                {!user.isActive && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>}
              </div>

              {user._count && (
                <p className="text-xs text-muted-foreground">
                  {user._count.accounts} accounts · {user._count.transactions} transactions
                </p>
              )}

              {user.lastLoginAt && (
                <p className="text-xs text-muted-foreground">
                  Last login: {new Date(user.lastLoginAt).toLocaleDateString('en-IN')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {users.length === 0 && !isLoading && (
        <div className="text-center py-12 border rounded-lg">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="font-medium">No family members added yet</p>
        </div>
      )}

      {/* ── Transparent overlay to close dropdown on outside click ─────── */}
      {activeMenu && (
        <div className="fixed inset-0 z-[5]" onClick={() => setActiveMenu(null)} aria-hidden="true" />
      )}

      {/* ── Add Member Modal ──────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-4">Add Family Member</h2>
            <form onSubmit={handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
              <div className="space-y-1"><Label>Name</Label><Input {...register('name')} /></div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input {...register('email')} type="email" />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Temporary Password</Label>
                <Input {...register('password')} type="password" />
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                <p className="text-xs text-muted-foreground">User will be prompted to change on first login</p>
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <select {...register('role')} className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Color Tag</Label>
                <div className="flex gap-2 flex-wrap">
                  {MEMBER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setValue('colorTag', color)}
                      className={cn(
                        'w-7 h-7 rounded-full border-2 transition-all',
                        selectedColor === color ? 'border-foreground scale-110' : 'border-transparent',
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label>PAN (masked, optional)</Label>
                <Input {...register('panNumberMasked')} placeholder="ABCDE1234F" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>Add Member</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Member Modal ─────────────────────────────────────────────── */}
      {editUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-4">Edit Member Details</h2>
            <form onSubmit={editHandleSubmit((data) => editMutation.mutate({ ...data, id: editUser.id }))} className="space-y-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input {...editRegister('name')} />
                {editErrors.name && <p className="text-xs text-destructive">{editErrors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input {...editRegister('email')} type="email" />
                {editErrors.email && <p className="text-xs text-destructive">{editErrors.email.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <select
                  {...editRegister('role')}
                  disabled={editUser.id === currentUser?.id}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                {editUser.id === currentUser?.id && (
                  <p className="text-xs text-muted-foreground">You cannot change your own role</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Color Tag</Label>
                <div className="flex gap-2 flex-wrap">
                  {MEMBER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => editSetValue('colorTag', color)}
                      className={cn(
                        'w-7 h-7 rounded-full border-2 transition-all',
                        editSelectedColor === color ? 'border-foreground scale-110' : 'border-transparent',
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label>PAN (masked, optional)</Label>
                <Input {...editRegister('panNumberMasked')} placeholder="ABCDE1234F" />
              </div>
              {editError && (
                <p className="text-sm text-destructive border border-destructive/20 bg-destructive/10 rounded-md px-3 py-2">
                  {editError}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" disabled={editMutation.isPending} onClick={() => { setEditUser(null); setEditError(null); }}>Cancel</Button>
                <Button type="submit" disabled={editMutation.isPending}>Save Changes</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Dialog ────────────────────────────────────── */}
      {deleteUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-sm p-6">
            <h2 className="text-xl font-semibold mb-2">Delete Member</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to remove <strong>{deleteUser.name}</strong>? This will deactivate their account and they will lose access.
            </p>
            {deleteError && (
              <p className="text-sm text-destructive border border-destructive/20 bg-destructive/10 rounded-md px-3 py-2 mb-4">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setDeleteUser(null); setDeleteError(null); }}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate({ id: deleteUser.id })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete Member'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Password Dialog ─────────────────────────────────────────── */}
      {resetPwdUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-sm p-6">
            <h2 className="text-xl font-semibold mb-2">Reset Password</h2>
            <p className="text-sm text-muted-foreground mb-4">Set a new temporary password for {resetPwdUser.name}</p>
            <Input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="New password (min 8 chars)"
            />
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="outline" onClick={() => { setResetPwdUser(null); setNewPwd(''); }}>Cancel</Button>
              <Button
                onClick={() => resetPwdMutation.mutate({ id: resetPwdUser.id, password: newPwd })}
                disabled={newPwd.length < 8 || resetPwdMutation.isPending}
              >
                Reset Password
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
