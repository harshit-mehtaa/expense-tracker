import { Bell, Plus, Moon, Sun, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useFY } from '@/contexts/FYContext';
import { formatFYLabel, listFYOptions } from '@/lib/financialYear';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function Header() {
  const { user, logout } = useAuth();
  const { selectedFY, setSelectedFY } = useFY();
  const [isDark, setIsDark] = useState(false);
  const navigate = useNavigate();
  const fyOptions = listFYOptions(5);

  const toggleDark = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
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
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-5 w-5" />
        </Button>

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
