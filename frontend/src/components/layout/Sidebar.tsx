import type { ElementType } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Receipt,
  Building2,
  TrendingUp,
  Shield,
  Target,
  CreditCard,
  FileText,
  IndianRupee,
  Gem,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavEntry { to: string; icon: ElementType; label: string; exact?: boolean }

// Grouped under section labels. Moved out of the sidebar (old URLs redirect, App.tsx):
// Reminders → the header bell's "View all"; Subscriptions → a Transactions tab;
// Categories and Family Members (admin-only) → Settings tabs. Settings itself → the
// header's account menu (UserMenu).
const NAV_GROUPS: Array<{ label: string | null; items: NavEntry[] }> = [
  { label: null, items: [{ to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true }] },
  {
    label: 'Money',
    items: [
      { to: '/transactions', icon: Receipt, label: 'Transactions' },
      { to: '/budgets', icon: Target, label: 'Budgets' },
    ],
  },
  {
    label: 'Wealth',
    items: [
      { to: '/accounts', icon: Building2, label: 'Accounts & Deposits' },
      { to: '/investments', icon: TrendingUp, label: 'Investments' },
      { to: '/assets', icon: Gem, label: 'Assets' },
    ],
  },
  {
    // Not "Liabilities": elsewhere in the app that means loans only (net worth), and
    // insurance never counts toward net worth.
    label: 'Protection & Debt',
    items: [
      { to: '/loans', icon: CreditCard, label: 'Loans & EMIs' },
      { to: '/insurance', icon: Shield, label: 'Insurance' },
    ],
  },
  {
    label: 'Planning',
    items: [
      { to: '/tax', icon: IndianRupee, label: 'Tax Centre' },
      { to: '/reports', icon: FileText, label: 'Reports' },
    ],
  },
];

const groupId = (label: string) => `nav-group-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;

// Renders an <li>; must be used inside a <ul>/<ol> or the browser default list
// marker (disc) shows up, since Tailwind preflight only resets list-style on ul/ol.
function NavItem({ to, icon: Icon, label, exact }: { to: string; icon: ElementType; label: string; exact?: boolean }) {
  return (
    <li>
      <NavLink
        to={to}
        end={exact}
        className={({ isActive }) =>
          cn(
            'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
            )}
            <Icon className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
            {label}
          </>
        )}
      </NavLink>
    </li>
  );
}

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 flex-col bg-background border-r border-border/60">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-5 border-b border-border/60">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary shadow-violet-md">
          <IndianRupee className="h-4 w-4 text-white" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-foreground">Family Finance</span>
      </div>

      {/* Navigation — each labelled group is a nested list named by its (non-heading) label */}
      <nav aria-label="Main" className="flex-1 overflow-y-auto py-3 px-3">
        <ul className="space-y-4">
          {NAV_GROUPS.map(({ label, items }) => (
            <li key={label ?? 'top'}>
              {label && (
                <p
                  id={groupId(label)}
                  className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60"
                >
                  {label}
                </p>
              )}
              <ul className="space-y-0.5" aria-labelledby={label ? groupId(label) : undefined}>
                {items.map((item) => <NavItem key={item.to} {...item} />)}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
