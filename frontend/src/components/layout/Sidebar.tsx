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
  Users,
  Settings,
  Gem,
  IndianRupee,
  Repeat,
  Home,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/transactions', icon: Receipt, label: 'Transactions' },
  { to: '/recurring', icon: Repeat, label: 'Recurring' },
  { to: '/accounts', icon: Building2, label: 'Accounts & Deposits' },
  { to: '/investments', icon: TrendingUp, label: 'Investments' },
  { to: '/gold', icon: Gem, label: 'Gold' },
  { to: '/real-estate', icon: Home, label: 'Real Estate' },
  { to: '/insurance', icon: Shield, label: 'Insurance' },
  { to: '/budgets', icon: Target, label: 'Budgets' },
  { to: '/loans', icon: CreditCard, label: 'Loans & EMIs' },
  { to: '/tax', icon: IndianRupee, label: 'Tax Centre' },
  { to: '/profit-loss', icon: FileText, label: 'P&L Report' },
];

const ADMIN_NAV_ITEMS = [
  { to: '/family', icon: Users, label: 'Family Members' },
  { to: '/reports', icon: FileText, label: 'Reports' },
];

export function Sidebar() {
  const { user } = useAuth();

  return (
    <aside
      data-sidebar
      className="flex h-full w-64 flex-col border-r border-border bg-sidebar"
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-primary-sm">
          <IndianRupee className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-semibold tracking-tight text-foreground">Family Finance</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            </li>
          ))}

          {user?.role === 'ADMIN' && (
            <>
              <li className="mt-4 mb-1 px-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Admin
                </p>
              </li>
              {ADMIN_NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </>
          )}
        </ul>
      </nav>

      {/* Bottom: Settings */}
      <div className="border-t border-border p-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )
          }
        >
          <Settings className="h-4 w-4" />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}
