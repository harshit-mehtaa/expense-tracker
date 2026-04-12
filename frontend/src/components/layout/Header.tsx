import { Bell, Plus, Moon, Sun, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useFY } from '@/contexts/FYContext';
import { formatFYLabel, listFYOptions } from '@/lib/financialYear';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchUpcomingAlerts } from '@/api/dashboard';

export function Header() {
  const { user, logout } = useAuth();
  const { selectedFY, setSelectedFY } = useFY();
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const navigate = useNavigate();
  const fyOptions = listFYOptions(5);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: alerts = [] } = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn: () => fetchUpcomingAlerts(),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    if (!showNotifications) return;
    function handleOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showNotifications]);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/60 bg-background px-5">
      {/* FY Selector */}
      <div className="relative flex items-center">
        <select
          value={selectedFY}
          onChange={(e) => setSelectedFY(e.target.value)}
          className={cn(
            'appearance-none rounded-lg border border-input bg-muted/50 py-1.5 pl-3 pr-8 text-sm font-medium',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 cursor-pointer',
            'text-foreground transition-colors hover:bg-muted',
          )}
          aria-label="Financial Year"
        >
          {fyOptions.map((fy) => (
            <option key={fy} value={fy}>
              {fy === selectedFY ? formatFYLabel(fy) : `FY ${fy}`}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-muted-foreground" />
      </div>

      {/* Right section */}
      <div className="flex items-center gap-1.5">
        {/* Quick add */}
        <Button size="sm" className="gap-1.5 h-8 px-3 text-xs" onClick={() => navigate('/transactions?add=1')}>
          <Plus className="h-3.5 w-3.5" />
          Add Transaction
        </Button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            onClick={() => setShowNotifications((v) => !v)}
            className="relative h-8 w-8"
          >
            <Bell className="h-4 w-4" />
            {alerts.length > 0 && (
              <span className="absolute top-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] text-white font-bold leading-none">
                {alerts.length > 9 ? '9+' : alerts.length}
              </span>
            )}
          </Button>
          {showNotifications && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border bg-background shadow-card-hover z-50 overflow-hidden animate-slide-up-fade">
              <div className="px-4 py-3 border-b border-border/60">
                <p className="text-sm font-semibold">Notifications</p>
              </div>
              {alerts.length === 0 ? (
                <p className="px-4 py-6 text-sm text-center text-muted-foreground">No upcoming alerts</p>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
                  {alerts.map((alert) => (
                    <div key={alert.entityId} className="px-4 py-3 hover:bg-muted/40 transition-colors">
                      <p className="text-sm font-medium">{alert.title}</p>
                      <p className={cn(
                        'text-xs mt-0.5',
                        alert.daysUntilDue === 0 ? 'text-red-500' :
                        alert.daysUntilDue <= 3 ? 'text-orange-500' :
                        'text-muted-foreground',
                      )}>
                        {alert.daysUntilDue === 0 ? 'Due today' :
                         alert.daysUntilDue === 1 ? 'Due tomorrow' :
                         `Due in ${alert.daysUntilDue} days`}
                        {alert.amount != null ? ` · ₹${Number(alert.amount).toLocaleString('en-IN')}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dark mode toggle */}
        <Button variant="ghost" size="icon" onClick={toggleDark} aria-label="Toggle dark mode" className="h-8 w-8">
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* Divider */}
        <div className="mx-1 h-5 w-px bg-border" />

        {/* User avatar + logout */}
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-white text-xs font-semibold shadow-sm"
            style={{ backgroundColor: user?.colorTag ?? '#7c3aed' }}
          >
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <span className="hidden sm:block text-sm font-medium text-foreground">{user?.name}</span>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Logout" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
