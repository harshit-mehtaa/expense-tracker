import { cn } from '@/lib/utils';
import { formatINR, formatINRShort } from '@/lib/indianFormat';

interface INRDisplayProps {
  amount: number | null | undefined;
  short?: boolean;        // Use lakh/crore shorthand
  forcePaise?: boolean;   // Always show 2 decimal places
  className?: string;
  positive?: boolean;     // Force green color
  negative?: boolean;     // Force red color
  colorCode?: boolean;    // Auto-color: positive=green, negative=red
  fallback?: string;      // Display when amount is null/undefined
}

/**
 * INRDisplay — the only approved way to display monetary amounts in the UI.
 * Never use raw formatINR() in JSX templates. Always use this component.
 */
export function INRDisplay({
  amount,
  short = false,
  forcePaise = false,
  className,
  positive,
  negative,
  colorCode = false,
  fallback = '—',
}: INRDisplayProps) {
  if (amount === null || amount === undefined) {
    return <span className={cn('text-muted-foreground', className)}>{fallback}</span>;
  }

  const formatted = short ? formatINRShort(amount) : formatINR(amount, forcePaise);

  const colorClass = cn(
    positive && 'text-green-600 dark:text-green-400',
    negative && 'text-red-600 dark:text-red-400',
    colorCode && amount > 0 && 'text-green-600 dark:text-green-400',
    colorCode && amount < 0 && 'text-red-600 dark:text-red-400',
    colorCode && amount === 0 && 'text-muted-foreground',
  );

  // When displaying an abbreviated amount (Cr/L), also show the exact value below.
  const isAbbreviated = short && Math.abs(amount) >= 100_000;

  if (isAbbreviated) {
    return (
      <span className="inline-block">
        <span className={cn(colorClass, className)}>{formatted}</span>
        <span className="block text-xs font-normal text-muted-foreground">{formatINR(amount)}</span>
      </span>
    );
  }

  return <span className={cn(colorClass, className)}>{formatted}</span>;
}
