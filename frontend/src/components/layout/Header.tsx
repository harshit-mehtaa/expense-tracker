import { Bell, Plus, Moon, Sun, LogOut } from 'lucide-react';
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

  // Sync class on mount and whenever isDark changes
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
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      {/* FY Selector */}
      <div className="flex items-center gap-2">
        <select
          value={selectedFY}
          onChange={(e) => setSelectedFY(e.target.value)}
          className={cn(
            'rounded-md border border-input bg-background px-3 py-1.5 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring',
          )}
          aria-label="Financial Year"
        >
          {fyOptions.map((fy) => (
            <option key={fy} value={fy}>
              {fy === selectedFY ? formatFYLabel(fy) : `FY ${fy}`}
            </option>
          ))}
        </select>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        {/* Quick add */}
        <Button size="sm" className="gap-1" onClick={() => navigate('/transactions?add=1')}>
          <Plus className="h-4 w-4" />
          Add Transaction
        </Button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            onClick={() => setShowNotifications((v) => !v)}
            className="relative"
          >
            <Bell className="h-5 w-5" />
            {alerts.length > 0 && (
              <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white font-bold">
                {alerts.length > 9 ? '9+' : alerts.length}
              </span>
            )}
          </Button>
          {showNotifications && (
            <div className="absolute right-0 top-full mt-1 w-80 rounded-xl border border-border bg-card shadow-lg z-50 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border">
                <p className="text-sm font-semibold">Notifications</p>
              </div>
              {alerts.length === 0 ? (
                <p className="px-4 py-6 text-sm text-center text-muted-foreground">No upcoming alerts</p>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-border">
                  {alerts.map((alert) => (
                    <div key={alert.entityId} className="px-4 py-3 hover:bg-muted/50 transition-colors">
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
        <Button variant="ghost" size="icon" onClick={toggleDark} aria-label="Toggle dark mode">
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {/* User avatar + logout */}
        <div className="flex items-center gap-2 pl-2 border-l border-border">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-white text-sm font-medium"
            style={{ backgroundColor: user?.colorTag ?? '#6366f1' }}
          >
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <span className="text-sm font-medium">{user?.name}</span>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
