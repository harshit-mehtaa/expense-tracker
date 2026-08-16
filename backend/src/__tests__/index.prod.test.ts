/**
 * Bootstrap tests for index.ts under production conditions (isTest === false).
 *
 * Separate file from indexBootstrap.test.ts: vi.mock is hoisted to file scope, so the
 * isTest=false mock of ./config/env cannot coexist with the isTest=true case.
 *
 * ./app and ./services/recurringScheduler are mocked so nothing real is constructed —
 * see indexBootstrap.test.ts for the full rationale. listen() invokes its callback so
 * the startup log arrow function actually executes (otherwise it is an uncovered
 * function even though the surrounding lines run).
 */
import { describe, it, expect, vi } from 'vitest';

const listenMock = vi.fn((_port: number, cb?: () => void) => cb?.());
const startSchedulerMock = vi.fn();

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'production', PORT: 4567 },
  isDev: false,
  isProd: true,
  isTest: false,
}));

vi.mock('../app', () => ({
  createApp: vi.fn(() => ({ listen: listenMock })),
}));

vi.mock('../services/recurringScheduler', () => ({
  startRecurringScheduler: startSchedulerMock,
}));

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

// Import AFTER the mocks are in place.
await import('../index');

describe('index.ts bootstrap in production (isTest = false)', () => {
  it('binds the configured port exactly once', () => {
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith(4567, expect.any(Function));
  });

  it('runs the startup log callback', () => {
    expect(logSpy).toHaveBeenCalledWith(
      '🚀 Family Finance API running on port 4567 [production]',
    );
  });

  it('starts the recurring scheduler', () => {
    expect(startSchedulerMock).toHaveBeenCalledTimes(1);
  });

  it('builds the app once', async () => {
    const { createApp } = await import('../app');
    expect(createApp).toHaveBeenCalledTimes(1);
  });
});
