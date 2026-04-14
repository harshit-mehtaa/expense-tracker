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
  Users,
  Settings,
  Gem,
  IndianRupee,
  Home,
  Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/transactions', icon: Receipt, label: 'Transactions' },
  { to: '/accounts', icon: Building2, label: 'Accounts & Deposits' },
  { to: '/investments', icon: TrendingUp, label: 'Investments' },
  { to: '/gold', icon: Gem, label: 'Gold' },
  { to: '/real-estate', icon: Home, label: 'Real Estate' },
  { to: '/insurance', icon: Shield, label: 'Insurance' },
  { to: '/budgets', icon: Target, label: 'Budgets' },
  { to: '/loans', icon: CreditCard, label: 'Loans & EMIs' },
  { to: '/tax', icon: IndianRupee, label: 'Tax Centre' },
  { to: '/reports', icon: FileText, label: 'Reports' },
  { to: '/categories', icon: Tag, label: 'Categories' },
];

const ADMIN_NAV_ITEMS = [
  { to: '/family', icon: Users, label: 'Family Members' },
];

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
  const { user } = useAuth();

  return (
    <aside className="flex h-full w-60 flex-col bg-background border-r border-border/60">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-5 border-b border-border/60">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary shadow-violet-md">
          <IndianRupee className="h-4 w-4 text-white" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-foreground">Family Finance</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}

          {user?.role === 'ADMIN' && (
            <>
              <li className="mt-5 mb-1.5 px-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  Admin
                </p>
              </li>
              {ADMIN_NAV_ITEMS.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </>
          )}
        </ul>
      </nav>

      {/* Bottom: Settings */}
      <div className="border-t border-border/60 p-3">
        <NavItem to="/settings" icon={Settings} label="Settings" />
      </div>
    </aside>
  );
}
