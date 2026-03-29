import { useEffect } from 'react';
import { triggerGenerate } from '@/api/recurring';

const STORAGE_KEY = 'last-recurring-generate';

/**
 * Silently triggers recurring transaction generation once per day on login.
 * Uses localStorage to guard against multiple calls within the same day.
 */
export function useRecurringAutoGenerate() {
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (localStorage.getItem(STORAGE_KEY) === today) return;
    triggerGenerate()
      .then(() => localStorage.setItem(STORAGE_KEY, today))
      .catch(() => {}); // Non-fatal — never break the app on failure
  }, []);
}
