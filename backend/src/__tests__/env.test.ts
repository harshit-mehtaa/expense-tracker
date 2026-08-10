/**
 * Basic smoke tests for the env config module.
 * Verifies the exported constants behave correctly in the test environment.
 * Note: the process.exit(1) branch in parseEnv() cannot be unit-tested
 * without resetting the module cache — it is excluded from coverage.
 */
import { describe, it, expect } from 'vitest';
import { env, isDev, isProd, isTest } from '../config/env';

describe('env config', () => {
  it('isTest is true in test environment', () => {
    expect(isTest).toBe(true);
  });

  it('isProd is false in test environment', () => {
    expect(isProd).toBe(false);
  });

  it('isDev is false in test environment', () => {
    expect(isDev).toBe(false);
  });

  it('env.NODE_ENV is "test"', () => {
    expect(env.NODE_ENV).toBe('test');
  });

  it('env.PORT is a number', () => {
    expect(typeof env.PORT).toBe('number');
  });

  it('env.DATABASE_URL is a non-empty string', () => {
    expect(typeof env.DATABASE_URL).toBe('string');
    expect(env.DATABASE_URL.length).toBeGreaterThan(0);
  });

  it('env.JWT_SECRET meets minimum length', () => {
    expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('env.JWT_REFRESH_SECRET meets minimum length', () => {
    expect(env.JWT_REFRESH_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});
