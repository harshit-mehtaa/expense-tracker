import { cn } from '@/lib/utils';

/** Panel styling for Radix DropdownMenu.Content (row actions, account menu). */
export const menuContentClass = 'z-50 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl';

/** Item styling for Radix DropdownMenu items (row actions, account menu). */
export const menuItemClass = 'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus:bg-muted';
export const destructiveMenuItemClass = cn(menuItemClass, 'text-destructive hover:bg-destructive/10 focus:bg-destructive/10');
