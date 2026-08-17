import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Repeat, Plus, Trash2, Edit2, X, ExternalLink, AlertTriangle, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import {
  subscriptionsApi, FREQUENCIES, SUBSCRIPTION_STATUSES,
  type Subscription, type Frequency, type SubscriptionStatus,
} from '@/api/subscriptions';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import { PAYMENT_MODES, paymentModeLabel } from '@/lib/paymentModes';
import { formatAccountOption, formatAccountShort } from '@/lib/accountFormat';
import { toCategoryTreeOptions, getCategoryTreeOptionLabel } from '@/lib/categoryUtils';
import api from '@/lib/api';
import { formatDate, toDateInputValue } from '@/lib/dateFormat';
import { useToast } from '@/contexts/ToastContext';

const subscriptionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  vendor: z.string().optional(),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  startDate: z.string().min(1, 'Start date is required'),
  trialEndDate: z.string().optional(),
  cancellationUrl: z.string().optional(),
  notes: z.string().optional(),
  // How the charge is paid. Optional because plenty of people genuinely do not know
  // offhand which card a subscription sits on, and refusing to record the subscription
  // over it would be worse than recording it without.
  paymentMode: z.string().optional(),
  bankAccountId: z.string().optional(),
  categoryId: z.string().optional(),
});
type SubscriptionForm = z.infer<typeof subscriptionSchema>;

const priceSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  effectiveFrom: z.string().min(1, 'Date is required'),
  note: z.string().optional(),
});
type PriceForm = z.infer<typeof priceSchema>;

const STATUS_STYLE: Record<SubscriptionStatus, string> = {
  TRIALING: 'bg-blue-100 text-blue-700',
  ACTIVE: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-muted text-muted-foreground',
};

function SubscriptionCard({
  subscription, onEdit, onCancel, onResume, onDelete, onPriceChange,
  confirmingDelete, onRequestDelete, onCancelDelete,
}: {
  subscription: Subscription;
  onEdit: () => void;
  onCancel: () => void;
  onResume: () => void;
  onDelete: () => void;
  onPriceChange: () => void;
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
}) {
  const { usage } = subscription;
  const frequency = subscription.recurringRule?.frequency;

  // "UPI · HDFC Bank ····4821 · Streaming", skipping whichever parts are unset rather
  // than rendering empty separators.
  const rule = subscription.recurringRule;
  const paidBy = [
    paymentModeLabel(rule?.paymentMode),
    formatAccountShort(rule?.bankAccount),
    rule?.category?.name ?? '',
  ].filter(Boolean);
  const isCancelled = subscription.status === 'CANCELLED';

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold truncate">{subscription.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[subscription.status]}`}>
              {SUBSCRIPTION_STATUSES[subscription.status]}
            </span>
          </div>
          {subscription.vendor && (
            <p className="text-xs text-muted-foreground truncate">{subscription.vendor}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" aria-label="Edit subscription" onClick={onEdit}>
            <Edit2 className="h-4 w-4" />
          </Button>
          {/* Two-step, matching the Recurring tab. Deleting removes the subscription and
              its price history from view — a heavier action than anything on that screen,
              so it should not be a weaker guard. */}
          {confirmingDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={onDelete}
                className="text-xs text-red-600 hover:underline px-1"
              >
                Confirm
              </button>
              <button
                onClick={onCancelDelete}
                className="text-xs text-muted-foreground hover:underline px-1"
              >
                Keep
              </button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete subscription"
              onClick={onRequestDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Price</p>
          {subscription.currentPrice !== null
            ? <INRDisplay amount={subscription.currentPrice} className="font-semibold" />
            : <span className="text-muted-foreground">—</span>}
          {frequency && <span className="text-xs text-muted-foreground"> / {FREQUENCIES[frequency].toLowerCase()}</span>}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Per year</p>
          {subscription.annualisedCost !== null
            ? <INRDisplay amount={subscription.annualisedCost} className="font-semibold" />
            : <span className="text-muted-foreground">—</span>}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            {subscription.status === 'TRIALING' ? 'Trial ends' : 'Next renewal'}
          </p>
          <p className="font-medium">
            {formatDate(subscription.status === 'TRIALING'
              ? subscription.trialEndDate
              : subscription.nextRenewalDate)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Paid so far</p>
          <INRDisplay amount={usage.totalPaid} className="font-medium" />
          <span className="text-xs text-muted-foreground"> ({usage.chargeCount})</span>
        </div>
        {/* Worth its own line: "which card is this on?" is the question you ask when a
            card is replaced or a charge shows up you did not expect. */}
        <div className="col-span-2">
          <p className="text-xs text-muted-foreground">Paid by</p>
          <p className="font-medium">
            {paidBy.length > 0
              ? paidBy.join(' · ')
              : <span className="text-muted-foreground font-normal">Not set</span>}
          </p>
        </div>
      </div>

      {/* The honest use of transaction data: it cannot say whether you used the service,
          but it can say the vendor charged more than you have on record. */}
      {usage.priceMismatch && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Charged more than expected</p>
            <p>
              {formatDate(usage.priceMismatch.date)}: charged{' '}
              <INRDisplay amount={usage.priceMismatch.charged} /> but{' '}
              <INRDisplay amount={usage.priceMismatch.expected} /> is on record.
            </p>
            <button type="button" className="underline mt-1" onClick={onPriceChange}>
              Record the new price
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onPriceChange}>
          <TrendingUp className="h-3 w-3 mr-1" /> Price change
        </Button>
        {isCancelled
          ? <Button variant="outline" size="sm" onClick={onResume}>Resume</Button>
          : <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>}
        {subscription.cancellationUrl && (
          <a
            href={subscription.cancellationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-xs text-primary underline"
          >
            How to cancel <ExternalLink className="h-3 w-3 ml-1" />
          </a>
        )}
      </div>

      {subscription.prices.length > 1 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Price history ({subscription.prices.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {subscription.prices.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{formatDate(p.effectiveFrom)}</span>
                <INRDisplay amount={p.amount} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function SubscriptionsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [pricingFor, setPricingFor] = useState<Subscription | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: subscriptions = [], isLoading } = useQuery({
    queryKey: ['subscriptions', viewUserId],
    queryFn: () => subscriptionsApi.getAll(viewUserId),
  });

  // Scoped to the member being viewed: the backend rejects an account or category owned
  // by somebody else, so offering the whole family's would only produce a failed save.
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', viewUserId],
    queryFn: () => api.get<{ data: any[] }>('/accounts', {
      params: viewUserId ? { userId: viewUserId } : {},
    }).then((r) => r.data.data),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api.get<{ data: any[] }>('/categories').then((r) => r.data.data),
  });

  // Same sorted, indented tree the transaction form uses, so a category is in the place
  // you expect on both screens.
  const categoryOptions = toCategoryTreeOptions(categories);

  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm<SubscriptionForm>({
    resolver: zodResolver(subscriptionSchema),
    defaultValues: { frequency: 'MONTHLY', startDate: toDateInputValue(new Date()) },
  });

  const priceForm = useForm<PriceForm>({ resolver: zodResolver(priceSchema) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['subscriptions'] });

  /**
   * Without this, every failure is silent. The backend deliberately writes user-facing
   * conflicts ("This subscription is already cancelled", "This rule belongs to a
   * subscription…") that nothing was showing — the user clicked and nothing happened.
   */
  const showError = (fallback: string) => (err: any) =>
    toast({ title: err?.response?.data?.message ?? fallback, variant: 'error' });

  /**
   * A cleared <input> serializes as `""`, not as an absent key, which the backend used
   * to turn into an Invalid Date or a dangling foreign key. The API normalizes these
   * too; stripping here keeps the wire payload honest about what was left blank.
   */
  const stripBlanks = (data: SubscriptionForm) => {
    const out: Record<string, unknown> = { ...data };
    for (const key of [
      'vendor', 'trialEndDate', 'cancellationUrl', 'notes',
      'paymentMode', 'bankAccountId', 'categoryId',
    ]) {
      if (out[key] === '') out[key] = null;
    }
    return out;
  };

  const createMutation = useMutation({
    mutationFn: (data: SubscriptionForm) =>
      subscriptionsApi.create(stripBlanks(data), viewUserId ? { targetUserId: viewUserId } : undefined),
    onSuccess: () => { invalidate(); closeForm(); },
    onError: showError('Failed to add subscription'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: SubscriptionForm }) =>
      subscriptionsApi.update(id, stripBlanks(data)),
    onSuccess: () => { invalidate(); closeForm(); },
    onError: showError('Failed to update subscription'),
  });

  const priceMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PriceForm }) =>
      subscriptionsApi.recordPrice(id, { ...data, note: data.note || null }),
    onSuccess: () => { invalidate(); setPricingFor(null); priceForm.reset(); },
    onError: showError('Failed to record the price change'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => subscriptionsApi.cancel(id),
    onSuccess: invalidate,
    onError: showError('Failed to cancel'),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => {
      // F9: today's date satisfies `nextRunDate <= now`, so the next hourly tick bills
      // immediately. Resuming should schedule the next charge, not trigger one.
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return subscriptionsApi.resume(id, toDateInputValue(tomorrow));
    },
    onSuccess: invalidate,
    onError: showError('Failed to resume'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => subscriptionsApi.delete(id),
    onSuccess: () => { invalidate(); setDeleteConfirmId(null); },
    onError: showError('Failed to delete'),
  });

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    reset({ frequency: 'MONTHLY', startDate: toDateInputValue(new Date()) });
  }

  function startEdit(subscription: Subscription) {
    setEditing(subscription);
    reset({
      name: subscription.name,
      vendor: subscription.vendor ?? '',
      amount: subscription.currentPrice ?? undefined,
      frequency: (subscription.recurringRule?.frequency ?? 'MONTHLY') as Frequency,
      startDate: subscription.startDate.slice(0, 10),
      trialEndDate: subscription.trialEndDate ? subscription.trialEndDate.slice(0, 10) : '',
      cancellationUrl: subscription.cancellationUrl ?? '',
      notes: subscription.notes ?? '',
      // These live on the owned rule, not on the subscription itself.
      paymentMode: subscription.recurringRule?.paymentMode ?? '',
      bankAccountId: subscription.recurringRule?.bankAccountId ?? '',
      categoryId: subscription.recurringRule?.categoryId ?? '',
    });
    setShowForm(true);
  }

  const active = subscriptions.filter((s) => s.status !== 'CANCELLED');
  const totalPerYear = active.reduce((sum, s) => sum + (s.annualisedCost ?? 0), 0);

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading subscriptions…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Repeat className="h-6 w-6" /> Subscriptions
          </h1>
          <p className="text-sm text-muted-foreground">
            {active.length} active — <INRDisplay amount={totalPerYear} /> a year
            {viewUserId
              ? ` · ${members.find((m) => m.id === viewUserId)?.name ?? 'Member'}`
              : isAdmin ? ' · All Family' : ''}
          </p>
          {/* Without this an ADMIN is stuck in the family-wide view, which is read-only —
              a new subscription needs exactly one owner — and so had no way to add one. */}
          {isAdmin && !isMembersLoading && (
            <div className="flex items-center gap-2 mt-2">
              <label htmlFor="subs-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
              {isMembersError ? (
                <span className="text-xs text-destructive">Could not load members</span>
              ) : (
                <select
                  id="subs-member-select"
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
        {/* A new subscription needs exactly one owner, so the family-wide view cannot
            create one. Say so rather than simply omitting the button. */}
        {isAdmin && !viewUserId ? (
          <p className="text-xs text-muted-foreground max-w-[16rem] text-right">
            Choose a member above to add a subscription.
          </p>
        ) : (
          <Button onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Subscription
          </Button>
        )}
      </div>

      {subscriptions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <Repeat className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No subscriptions yet.</p>
          <p className="text-sm">Add Netflix, Spotify, iCloud — anything that bills you on a schedule.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {subscriptions.map((s) => (
            <SubscriptionCard
              key={s.id}
              subscription={s}
              onEdit={() => startEdit(s)}
              onCancel={() => cancelMutation.mutate(s.id)}
              onResume={() => resumeMutation.mutate(s.id)}
              onDelete={() => deleteMutation.mutate(s.id)}
              confirmingDelete={deleteConfirmId === s.id}
              onRequestDelete={() => setDeleteConfirmId(s.id)}
              onCancelDelete={() => setDeleteConfirmId(null)}
              onPriceChange={() => {
                setPricingFor(s);
                priceForm.reset({
                  amount: s.currentPrice ?? 0,
                  effectiveFrom: toDateInputValue(new Date()),
                });
              }}
            />
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-background rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {editing ? 'Edit Subscription' : 'Add Subscription'}
              </h2>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={closeForm}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form
              onSubmit={handleSubmit((data) =>
                editing
                  ? updateMutation.mutate({ id: editing.id, data })
                  : createMutation.mutate(data))}
              className="space-y-4"
            >
              <div>
                <Label htmlFor="sub-name">Name</Label>
                <Input {...register('name')} id="sub-name" placeholder="Netflix" />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>

              <div>
                <Label htmlFor="sub-vendor">Vendor (optional)</Label>
                <Input {...register('vendor')} id="sub-vendor" placeholder="Netflix India" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="sub-amount">Amount (₹)</Label>
                  <Input
                    {...register('amount')}
                    id="sub-amount"
                    type="number"
                    step="0.01"
                    disabled={editing !== null}
                    readOnly={editing !== null}
                  />
                  {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
                </div>
                <div>
                  <Label htmlFor="sub-frequency">Billing frequency</Label>
                  <select
                    {...register('frequency')}
                    id="sub-frequency"
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    {Object.entries(FREQUENCIES).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="sub-startDate">Start date</Label>
                  <Input
                    {...register('startDate')}
                    id="sub-startDate"
                    type="date"
                    disabled={editing !== null}
                    readOnly={editing !== null}
                  />
                  {!editing && (
                    <p className="text-xs text-muted-foreground mt-1">
                      When you started paying. Billing begins today — this is for your records.
                    </p>
                  )}
                  {errors.startDate && <p className="text-xs text-destructive">{errors.startDate.message}</p>}
                </div>
                <div>
                  <Label htmlFor="sub-trialEndDate">Trial ends (optional)</Label>
                  <Input {...register('trialEndDate')} id="sub-trialEndDate" type="date" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Nothing is charged until this date.
                  </p>
                </div>
              </div>

              <div>
                <Label htmlFor="sub-cancellationUrl">Cancellation link (optional)</Label>
                <Input
                  {...register('cancellationUrl')}
                  id="sub-cancellationUrl"
                  placeholder="https://…/account/cancel"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Where to go when you want out — worth saving now, not when you are annoyed.
                </p>
              </div>

              {/* How it is paid. Every generated charge inherits these, so leaving them
                  blank produces an uncategorised transaction attached to no account. */}
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">How it is paid</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="sub-paymentMode">Payment type</Label>
                    <select
                      {...register('paymentMode')}
                      id="sub-paymentMode"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">— Not set —</option>
                      {PAYMENT_MODES.map((m) => (
                        <option key={m} value={m}>{paymentModeLabel(m)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="sub-bankAccountId">Paid from</Label>
                    <select
                      {...register('bankAccountId')}
                      id="sub-bankAccountId"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">— Not set —</option>
                      {accounts.map((a: any) => (
                        <option key={a.id} value={a.id}>{formatAccountOption(a)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="sub-categoryId">Category</Label>
                  <select
                    {...register('categoryId')}
                    id="sub-categoryId"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— Not set —</option>
                    {categoryOptions.map(({ category, depth }) => (
                      <option key={category.id} value={category.id}>
                        {getCategoryTreeOptionLabel(category, depth)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Each charge is recorded with these. Without a category the spend will
                    not appear against any budget.
                  </p>
                </div>
              </div>

              <div>
                <Label htmlFor="sub-notes">Notes (optional)</Label>
                <Input {...register('notes')} id="sub-notes" />
              </div>

              {editing && (
                <p className="text-xs text-muted-foreground">
                  Amount and start date are fixed here on purpose. Use “Price change” to
                  record a new price from a date, so past charges keep the price you
                  actually paid.
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editing ? 'Save' : 'Add'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pricingFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-background rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Price change — {pricingFor.name}</h2>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setPricingFor(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form
              onSubmit={priceForm.handleSubmit((data) =>
                priceMutation.mutate({ id: pricingFor.id, data }))}
              className="space-y-4"
            >
              <div>
                <Label htmlFor="price-amount">New amount (₹)</Label>
                <Input {...priceForm.register('amount')} id="price-amount" type="number" step="0.01" />
                {priceForm.formState.errors.amount && (
                  <p className="text-xs text-destructive">{priceForm.formState.errors.amount.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="price-effectiveFrom">Effective from</Label>
                <Input {...priceForm.register('effectiveFrom')} id="price-effectiveFrom" type="date" />
                <p className="text-xs text-muted-foreground mt-1">
                  Charges before this date keep the old price.
                </p>
              </div>
              <div>
                <Label htmlFor="price-note">Note (optional)</Label>
                <Input {...priceForm.register('note')} id="price-note" placeholder="Annual price rise" />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPricingFor(null)}>Cancel</Button>
                <Button type="submit" disabled={priceMutation.isPending}>Record</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
