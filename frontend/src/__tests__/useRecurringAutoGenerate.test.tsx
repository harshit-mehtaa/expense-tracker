/**
 * Tests for useRecurringAutoGenerate hook.
 * Uses vi.mock for the API call and a localStorage stub (jsdom v1.3.0 does not
 * expose the full Storage API — we replace globalThis.localStorage directly).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/api/recurring', () => ({
  triggerGenerate: vi.fn().mockResolvedValue({ generated: 0 }),
}));

import { useRecurringAutoGenerate } from '@/hooks/useRecurringAutoGenerate';
import { triggerGenerate } from '@/api/recurring';

const triggerMock = triggerGenerate as ReturnType<typeof vi.fn>;
const STORAGE_KEY = 'last-recurring-generate';
const TODAY = new Date().toISOString().slice(0, 10);

// ── localStorage stub ─────────────────────────────────────────────────────────
// Vitest 1.3.0 + jsdom does not expose removeItem/clear on the built-in
// localStorage implementation (it uses --localstorage-file). Replace it.
let store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { store = {}; }),
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  store = {};
});

describe('useRecurringAutoGenerate', () => {
  it('calls triggerGenerate on first render (no localStorage entry)', async () => {
    renderHook(() => useRecurringAutoGenerate());
    await new Promise((r) => setTimeout(r, 10));
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it('sets localStorage to today after triggering', async () => {
    renderHook(() => useRecurringAutoGenerate());
    await new Promise((r) => setTimeout(r, 10));
    expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, TODAY);
  });

  it('does NOT call triggerGenerate if localStorage already has today', async () => {
    store[STORAGE_KEY] = TODAY;
    renderHook(() => useRecurringAutoGenerate());
    await new Promise((r) => setTimeout(r, 10));
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it('calls triggerGenerate if localStorage has a past date', async () => {
    store[STORAGE_KEY] = '2024-01-01';
    renderHook(() => useRecurringAutoGenerate());
    await new Promise((r) => setTimeout(r, 10));
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when triggerGenerate rejects', async () => {
    triggerMock.mockRejectedValue(new Error('Network error'));
    expect(() => renderHook(() => useRecurringAutoGenerate())).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(triggerMock).toHaveBeenCalled();
  });
});
