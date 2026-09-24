import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSearchParams } from 'react-router-dom';
import { User, Globe, RefreshCw, LogOut, SlidersHorizontal, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import { formatDate } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';
import CategoriesPage from '@/pages/admin/Categories';

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
            <p className="text-xs text-muted-foreground">Updated {formatDate(r.updatedAt)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// URL-backed tabs (?tab=categories), same pattern as Assets.tsx. Categories moved here from
// its own sidebar item; /categories redirects to this tab (App.tsx).
const TABS = ['general', 'categories'] as const;
type SettingsTab = (typeof TABS)[number];
const DEFAULT_TAB: SettingsTab = 'general';
const TAB_META: Record<SettingsTab, { label: string; icon: LucideIcon }> = {
  general: { label: 'General', icon: SlidersHorizontal },
  categories: { label: 'Categories', icon: Tag },
};

// Array membership, not an object-key lookup, so `?tab=constructor` isn't accepted.
function isTab(v: string): v is SettingsTab {
  return (TABS as readonly string[]).includes(v);
}

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: SettingsTab = rawTab && isTab(rawTab) ? rawTab : DEFAULT_TAB;
  function setActiveTab(tab: SettingsTab) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === DEFAULT_TAB) next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div role="tablist" aria-label="Settings sections" className="flex border-b border-border">
        {TABS.map((tab) => {
          const Icon = TAB_META[tab].icon;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
              )}
            >
              <Icon className="h-4 w-4" />
              {TAB_META[tab].label}
            </button>
          );
        })}
      </div>

      {activeTab === 'categories' ? <CategoriesPage /> : <GeneralSettings />}
    </div>
  );
}

function GeneralSettings() {
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
      {/* Profile */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><User className="h-4 w-4" /> Profile</h2>
        <form onSubmit={profileForm.handleSubmit((data) => updateProfileMutation.mutate(data))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label required>Name</Label>
              <Input {...profileForm.register('name')} />
            </div>
            <div className="space-y-1">
              <Label required>Email</Label>
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
            <Label required>Current Password</Label>
            <Input {...pwdForm.register('oldPassword')} type="password" />
          </div>
          <div className="space-y-1">
            <Label required>New Password</Label>
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
