/**
 * Tests for FYContext / FYProvider / useFY.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { FYProvider, useFY } from '@/contexts/FYContext';
import { getCurrentFY, listFYOptions } from '@/lib/financialYear';

function wrapper({ children }: { children: React.ReactNode }) {
  return <FYProvider>{children}</FYProvider>;
}

describe('useFY — outside provider', () => {
  it('throws "useFY must be used within FYProvider" when used outside provider', () => {
    // Suppress React's error boundary output in test logs
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useFY())).toThrow('useFY must be used within FYProvider');
    spy.mockRestore();
  });
});

describe('useFY — inside FYProvider', () => {
  it('initializes selectedFY to the current FY', () => {
    const { result } = renderHook(() => useFY(), { wrapper });
    expect(result.current.selectedFY).toBe(getCurrentFY());
  });

  it('initializes fyOptions with 5 options by default', () => {
    const { result } = renderHook(() => useFY(), { wrapper });
    expect(result.current.fyOptions).toHaveLength(5);
  });

  it('fyOptions starts with the current FY', () => {
    const { result } = renderHook(() => useFY(), { wrapper });
    expect(result.current.fyOptions[0]).toBe(getCurrentFY());
  });

  it('fyOptions matches listFYOptions(5) from the lib', () => {
    const { result } = renderHook(() => useFY(), { wrapper });
    expect(result.current.fyOptions).toEqual(listFYOptions(5));
  });

  it('setSelectedFY updates selectedFY', () => {
    const { result } = renderHook(() => useFY(), { wrapper });
    act(() => result.current.setSelectedFY('2023-24'));
    expect(result.current.selectedFY).toBe('2023-24');
  });

  it('setSelectedFY can be called multiple times', () => {
    const { result } = renderHook(() => useFY(), { wrapper });
    act(() => result.current.setSelectedFY('2022-23'));
    act(() => result.current.setSelectedFY('2021-22'));
    expect(result.current.selectedFY).toBe('2021-22');
  });
});
