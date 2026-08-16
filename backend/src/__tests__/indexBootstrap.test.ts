/**
 * Bootstrap tests for index.ts under test conditions (isTest === true).
 *
 * Kept separate from index.prod.test.ts because vi.mock is hoisted to file scope —
 * one file cannot hold both isTest=true and isTest=false mocks of ./config/env.
 *
 * ./app and ./services/recurringScheduler MUST be mocked: importing index.ts for real
 * would build a full Express app, construct a real PrismaClient, bind a port and leak
 * an hourly interval into the test worker.
 */
import { describe, it, expect, vi } from 'vitest';

const listenMock = vi.fn((_port: number, cb?: () => void) => cb?.());
const startSchedulerMock = vi.fn();

vi.mock('../app', () => ({
  createApp: vi.fn(() => ({ listen: listenMock })),
}));

vi.mock('../services/recurringScheduler', () => ({
  startRecurringScheduler: startSchedulerMock,
}));

// NODE_ENV=test comes from setup.ts, so the real env module reports isTest === true.
await import('../index');

describe('index.ts bootstrap under test (isTest = true)', () => {
  it('does NOT bind a port', () => {
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('does NOT start the recurring scheduler', () => {
    expect(startSchedulerMock).not.toHaveBeenCalled();
  });

  it('still builds the app, so an import cannot silently skip wiring', async () => {
    const { createApp } = await import('../app');
    expect(createApp).toHaveBeenCalledTimes(1);
  });
});
