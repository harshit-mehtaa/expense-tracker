import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, ArrowUpRight } from 'lucide-react';
import { fetchUpcomingAlerts, type UpcomingAlert } from '@/api/dashboard';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';

/** Exhaustive against the FRONTEND's own `UpcomingAlert['type']` union — a Record
 *  literal missing a key fails `tsc` here. That does NOT make this exhaustive against
 *  the backend: `getUpcomingAlerts` (dashboardService.ts) has no return-type annotation,
 *  its type strings are inferred from inline `as const` literals, and this frontend
 *  union is a hand-maintained, unlinked copy (there's also an orphaned, already-drifted
 *  `UpcomingAlert` in shared/types/index.ts with zero importers — needs a dedicated
 *  unification task, not done here). A new backend alert type compiles cleanly without
 *  touching this file, so the lookup below is guarded at runtime, not just typed. */
export const ALERT_TYPE_ROUTE: Record<UpcomingAlert['type'], string> = {
  EMI: '/loans',
  SIP: '/investments',
  FD_MATURITY: '/investments',
  RD_MATURITY: '/investments',
  INSURANCE_PREMIUM: '/insurance',
  SUBSCRIPTION_TRIAL: '/transactions?tab=subscriptions',
  SUBSCRIPTION_RENEWAL: '/transactions?tab=subscriptions',
  ADVANCE_TAX: '/tax',
  BUDGET_ALERT: '/budgets',
};

export default function RemindersPage() {
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();

  // Byte-identical to Dashboard.tsx's own alerts query — shares one cache entry
  // instead of a duplicate fetch when both pages have been visited this session.
  const { data: alerts = [], isLoading, isError } = useQuery({
    queryKey: ['dashboard', 'alerts', viewUserId],
    queryFn: () => fetchUpcomingAlerts(viewUserId),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reminders</h1>
          {/* Not FY-scoped — getUpcomingAlerts is a rolling ~30-day window off
              today's date, unlike most other pages' FY-year subtitle. */}
          <p className="text-muted-foreground text-sm mt-1">
            Due in the next 30 days
            {isAdmin && viewUserId
              ? ` · ${members.find((m) => m.id === viewUserId)?.name ?? 'Member'}`
              : isAdmin ? ' · All Family' : ''}
          </p>
          {isAdmin && !isMembersLoading && (
            <div className="flex items-center gap-2 mt-2">
              <label htmlFor="reminders-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
              {isMembersError ? (
                <span className="text-xs text-destructive">Could not load members</span>
              ) : (
                <select
                  id="reminders-member-select"
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
      </div>

      {isLoading ? (
        <PageLoader />
      ) : isError ? (
        <p className="text-center py-12 text-sm text-destructive">
          Failed to load reminders. Please refresh the page.
        </p>
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nothing due soon"
          description="You're all caught up — nothing needs your attention in the next 30 days."
        />
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            // Runtime-guarded: see the comment on ALERT_TYPE_ROUTE above — an alert
            // type this frontend doesn't know about renders as a plain, non-clickable
            // row instead of a misleading link (an unguarded lookup would silently
            // pass `undefined` to `Link`'s `to`, which React Router treats as "stay on
            // this page" — no crash, no console error, no test would catch it).
            const href = (ALERT_TYPE_ROUTE as Partial<Record<string, string>>)[alert.type];
            const rowClassName = 'flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3';
            const content = (
              <>
                <div>
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {alert.daysUntilDue === 0
                      ? 'Due today'
                      : alert.daysUntilDue === 1
                      ? 'Due tomorrow'
                      : `Due in ${alert.daysUntilDue} days`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {alert.amount != null && (
                    <INRDisplay amount={alert.amount} short className="text-sm font-semibold" />
                  )}
                  {href && <ArrowUpRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </>
            );
            return href ? (
              <Link key={alert.entityId} to={href} className={`${rowClassName} hover:bg-muted/40 transition-colors`}>
                {content}
              </Link>
            ) : (
              <div key={alert.entityId} className={rowClassName}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
