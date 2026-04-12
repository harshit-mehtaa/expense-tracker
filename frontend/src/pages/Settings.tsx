import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Globe, RefreshCw, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';

const profileSchema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.string().email(),
});

const pwdSchema = z.object({
  oldPassword: z.string().min(1, 'Required'),
  newPassword: z.string().min(8, 'Minimum 8 characters'),
});

type ProfileForm = z.infer<typeof profileSchema>;
type PwdForm = z.infer<typeof pwdSchema>;

function ExchangeRateSettings() {
  const qc = useQueryClient();
  const { data: rates = [] } = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: () => api.get<{ data: any[] }>('/investments/exchange-rates').then((r) => r.data.data),
  });

  const [editRates, setEditRates] = useState<Record<string, string>>({});

  const updateMutation = useMutation({
    mutationFn: ({ currency, rate }: { currency: string; rate: number }) =>
      api.put(`/investments/exchange-rates/${currency}`, { rate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exchange-rates'] }),
  });

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><Globe className="h-4 w-4" /> Exchange Rates (₹ per 1 unit)</h2>
      <p className="text-sm text-muted-foreground">Used for foreign equity INR valuation. Update periodically for accurate portfolio values.</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {rates.map((r: any) => (
          <div key={r.fromCurrency} className="space-y-1">
            <Label>{r.fromCurrency}/INR</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.01"
                value={editRates[r.fromCurrency] ?? String(r.rate)}
                onChange={(e) => setEditRates((p) => ({ ...p, [r.fromCurrency]: e.target.value }))}
                className="text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateMutation.mutate({ currency: r.fromCurrency, rate: Number(editRates[r.fromCurrency] ?? r.rate) })}
                disabled={updateMutation.isPending}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Updated {new Date(r.updatedAt).toLocaleDateString('en-IN')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [pwdSuccess, setPwdSuccess] = useState(false);

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: { name: user?.name ?? '', email: user?.email ?? '' },
  });

  const pwdForm = useForm<PwdForm>({ resolver: zodResolver(pwdSchema) });

  const updateProfileMutation = useMutation({
    mutationFn: (data: ProfileForm) => api.put(`/admin/users/${user?.id}`, data),
  });

  const changePwdMutation = useMutation({
    mutationFn: (data: PwdForm) => api.post('/auth/change-password', data),
    onSuccess: () => { setPwdSuccess(true); pwdForm.reset(); },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      {/* Profile */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><User className="h-4 w-4" /> Profile</h2>
        <form onSubmit={profileForm.handleSubmit((data) => updateProfileMutation.mutate(data))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input {...profileForm.register('name')} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input {...profileForm.register('email')} type="email" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Role: <span className="font-medium text-foreground">{user?.role}</span>
            </span>
            <Button type="submit" size="sm" disabled={updateProfileMutation.isPending}>Save Profile</Button>
          </div>
        </form>
      </div>

      {/* Change Password */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold">Change Password</h2>
        {pwdSuccess && <p className="text-sm text-green-600">Password changed successfully.</p>}
        <form onSubmit={pwdForm.handleSubmit((data) => changePwdMutation.mutate(data))} className="space-y-4">
          <div className="space-y-1">
            <Label>Current Password</Label>
            <Input {...pwdForm.register('oldPassword')} type="password" />
          </div>
          <div className="space-y-1">
            <Label>New Password</Label>
            <Input {...pwdForm.register('newPassword')} type="password" />
            {pwdForm.formState.errors.newPassword && (
              <p className="text-xs text-destructive">{pwdForm.formState.errors.newPassword.message}</p>
            )}
          </div>
          <Button type="submit" size="sm" disabled={changePwdMutation.isPending}>Change Password</Button>
        </form>
      </div>

      {/* Exchange Rates */}
      <ExchangeRateSettings />

      {/* Logout */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold mb-3">Session</h2>
        <Button variant="destructive" onClick={logout} className="flex items-center gap-2">
          <LogOut className="h-4 w-4" /> Log Out
        </Button>
      </div>
    </div>
  );
}
