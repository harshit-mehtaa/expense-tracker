/**
 * Tests for recurringScheduler — the background catch-up job extracted from index.ts.
 *
 * Covers the reentrancy guard (a slow run must not overlap the next tick), the log
 * branches, the error path, and that startRecurringScheduler's handles are unref'd so
 * they can never hold a test worker (or the process) open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/recurringService', () => ({
  generateDueRecurringTransactionsForAllUsers: vi.fn(),
}));

import { generateDueRecurringTransactionsForAllUsers } from '../services/recurringService';
import { runRecurringCatchUp, startRecurringScheduler } from '../services/recurringScheduler';

const generateMock = generateDueRecurringTransactionsForAllUsers as ReturnType<typeof vi.fn>;

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  generateMock.mockResolvedValue({ generated: 0, usersProcessed: 0 });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe('runRecurringCatchUp — logging branches', () => {
  it('logs a summary when generated > 0', async () => {
    generateMock.mockResolvedValue({ generated: 3, usersProcessed: 2 });
    await runRecurringCatchUp();
    expect(logSpy).toHaveBeenCalledWith('[recurring] generated 3 transaction(s) for 2 user(s)');
  });

  it('stays silent when generated === 0 (the common no-op tick)', async () => {
    generateMock.mockResolvedValue({ generated: 0, usersProcessed: 5 });
    await runRecurringCatchUp();
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('runRecurringCatchUp — error path', () => {
  it('swallows a generator rejection and logs it, so a failing tick cannot crash the process', async () => {
    const boom = new Error('db unavailable');
    generateMock.mockRejectedValue(boom);

    // Must not reject — this runs unawaited from a setInterval in production.
    await expect(runRecurringCatchUp()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('[recurring] catch-up failed', boom);
  });

  it('resets the guard in finally, so a later run still proceeds after a failure', async () => {
    generateMock.mockRejectedValueOnce(new Error('transient'));
    await runRecurringCatchUp();

    generateMock.mockResolvedValue({ generated: 1, usersProcessed: 1 });
    await runRecurringCatchUp();

    // Second call got through — the flag did not stay stuck at true.
    expect(generateMock).toHaveBeenCalledTimes(2);
  });
});

describe('runRecurringCatchUp — reentrancy guard', () => {
  it('drops a concurrent invocation while the first is still pending', async () => {
    let release!: (v: { generated: number; usersProcessed: number }) => void;
    generateMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const first = runRecurringCatchUp();
    // Fires while `running` is still true — must be a no-op.
    const second = runRecurringCatchUp();

    expect(generateMock).toHaveBeenCalledTimes(1);

    release({ generated: 0, usersProcessed: 0 });
    await Promise.all([first, second]);

    // And the guard released, so a later run works.
    generateMock.mockResolvedValue({ generated: 0, usersProcessed: 0 });
    await runRecurringCatchUp();
    expect(generateMock).toHaveBeenCalledTimes(2);
  });
});

describe('startRecurringScheduler', () => {
  it('returns both handles and unrefs them so they cannot hold the process open', () => {
    vi.useFakeTimers();
    const { initial, recurring } = startRecurringScheduler();

    expect(initial).toBeDefined();
    expect(recurring).toBeDefined();
    // If these were still ref'd, an hourly interval would keep Node alive forever.
    expect((initial as any).hasRef?.()).toBe(false);
    expect((recurring as any).hasRef?.()).toBe(false);

    clearTimeout(initial);
    clearInterval(recurring);
  });

  it('runs the catch-up after the initial 2s delay', async () => {
    vi.useFakeTimers();
    const { initial, recurring } = startRecurringScheduler();

    expect(generateMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(generateMock).toHaveBeenCalledTimes(1);

    clearTimeout(initial);
    clearInterval(recurring);
  });

  it('runs again on each hourly interval tick', async () => {
    vi.useFakeTimers();
    const { initial, recurring } = startRecurringScheduler();

    await vi.advanceTimersByTimeAsync(2_000); // initial
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // first hourly tick
    expect(generateMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // second hourly tick
    expect(generateMock).toHaveBeenCalledTimes(3);

    clearTimeout(initial);
    clearInterval(recurring);
  });
});
