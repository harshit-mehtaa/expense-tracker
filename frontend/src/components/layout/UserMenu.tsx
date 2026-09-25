import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, LogOut, Settings } from 'lucide-react';
import { Link, useMatch } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLogout } from '@/hooks/useLogout';
import { cn } from '@/lib/utils';
import { destructiveMenuItemClass, menuContentClass, menuItemClass } from '@/components/ui/menuItemClasses';

const ROLE_LABEL = { ADMIN: 'Admin', MEMBER: 'Member' } as const;

/**
 * Account menu under the header avatar: who is signed in, Settings, Log out.
 * Settings lives here rather than in the sidebar; while on any Settings tab the trigger
 * shows a ring and the item is marked current, standing in for the sidebar's active link.
 */
export function UserMenu() {
  const { user } = useAuth();
  const logout = useLogout();
  const onSettings = useMatch('/settings/*') !== null;

  // Rendered inside the authenticated shell, but user is null for the moment between
  // mount and session restore (and right after logout) — nothing to show yet.
  if (!user) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          aria-label={`Account menu for ${user.name}`}
          data-active={onSettings || undefined}
          className={cn('h-8 gap-2 px-1.5', onSettings && 'ring-2 ring-primary/40')}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm"
            style={{ backgroundColor: user.colorTag ?? '#7c3aed' }}
            aria-hidden="true"
          >
            {user.name?.[0]?.toUpperCase() ?? 'U'}
          </span>
          <span className="hidden max-w-32 truncate text-sm font-medium text-foreground xl:block">{user.name}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className={cn(menuContentClass, 'w-64')}
        >
          <DropdownMenu.Label className="px-2 py-1.5">
            <p className="truncate text-sm font-medium" title={user.name}>{user.name}</p>
            <p className="truncate text-xs text-muted-foreground" title={user.email}>
              {user.email} · {ROLE_LABEL[user.role]}
            </p>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {/* A real <a>, so middle-click / open-in-new-tab work. Radix closes the menu
              via the onClick it merges onto the Link; never give this Link an onClick
              that calls preventDefault, or the menu would navigate but stay open. */}
          <DropdownMenu.Item asChild className={menuItemClass}>
            <Link to="/settings" aria-current={onSettings ? 'page' : undefined}>
              <Settings className="h-4 w-4" aria-hidden="true" /> Settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={destructiveMenuItemClass} onSelect={() => { void logout(); }}>
            <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
