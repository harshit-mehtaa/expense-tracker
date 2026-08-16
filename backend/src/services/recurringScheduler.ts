import { generateDueRecurringTransactionsForAllUsers } from './recurringService';

const CATCH_UP_DELAY_MS = 2_000;
const CATCH_UP_INTERVAL_MS = 60 * 60 * 1000;

/** Guards against a slow run overlapping the next tick. Module-level rather than a
 *  closure so both the timeout and the interval share one flag. */
let running = false;

export async function runRecurringCatchUp(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await generateDueRecurringTransactionsForAllUsers();
    if (result.generated > 0) {
      console.log(`[recurring] generated ${result.generated} transaction(s) for ${result.usersProcessed} user(s)`);
    }
  } catch (err) {
    console.error('[recurring] catch-up failed', err);
  } finally {
    running = false;
  }
}

/**
 * Start the background catch-up: once shortly after boot, then hourly.
 *
 * Returns both handles and calls `.unref()` on them so they never hold the process (or a
 * test worker) open — an un-unref'd hourly interval keeps Node alive indefinitely.
 */
export function startRecurringScheduler() {
  const initial = setTimeout(runRecurringCatchUp, CATCH_UP_DELAY_MS);
  const recurring = setInterval(runRecurringCatchUp, CATCH_UP_INTERVAL_MS);
  initial.unref?.();
  recurring.unref?.();
  return { initial, recurring };
}
