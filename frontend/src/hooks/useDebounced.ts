import { useEffect, useState } from 'react';

/**
 * Delays a value by `delay` ms after it stops changing. Used to keep a typed value out
 * of a React Query key on every keystroke — the key change is what unmounts a page under
 * an `isLoading` guard, and re-firing a request per letter is wasteful either way.
 *
 * Previously duplicated inside CommandPalette.tsx. Extracted here so Transactions.tsx,
 * which has the same "typed text feeds a server-side filter" shape, does not grow a third
 * copy.
 */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
