/**
 * Unit tests for utils/safeRegex.ts.
 *
 * Key test focus:
 * - compileUserPattern: case-insensitive compile, invalid syntax → 400, `/…/flags`
 *   literal form → 400 (but a bare `/…/` is a legitimate slash-matching pattern),
 *   empty-text matches → 400
 * - compileStoredPattern: never throws — a pattern that no longer compiles → null
 * - testAllWithTimeout: real catastrophic backtracking is interrupted (not mocked —
 *   the vm watchdog is the thing under test) and reported distinctly from other
 *   failures; context reusable after a timeout
 */
import { describe, it, expect } from 'vitest';
import { compileUserPattern, compileStoredPattern, testAllWithTimeout } from '../utils/safeRegex';

describe('compileUserPattern', () => {
  it('compiles a valid pattern case-insensitively', () => {
    const re = compileUserPattern('^upi/.*swiggy');
    expect(re.flags).toBe('i');
    expect(re.test('UPI/P2M/1234/SWIGGY')).toBe(true);
  });

  it('keeps the pattern exactly as typed (no lowercasing of escapes)', () => {
    const re = compileUserPattern('\\D{3}');
    expect(re.source).toBe('\\D{3}');
    expect(re.test('123')).toBe(false);
  });

  it('allows a bare slash-delimited pattern, since UPI narrations contain slashes', () => {
    expect(compileUserPattern('/swiggy/').test('UPI/SWIGGY/123')).toBe(true);
  });

  it('allows a slash pattern whose tail merely looks like flags (/…/gym is a UPI segment)', () => {
    expect(compileUserPattern('/upi/.*/gym').test('/UPI/P2M/99/GYM')).toBe(true);
  });

  it('rejects the /pattern/flags literal form with a 400', () => {
    expect(() => compileUserPattern('/swiggy/i')).toThrow(
      expect.objectContaining({ statusCode: 400, message: expect.stringContaining('slashes') }),
    );
  });

  it('rejects invalid syntax with a 400 naming the problem', () => {
    expect(() => compileUserPattern('(a+')).toThrow(
      expect.objectContaining({
        statusCode: 400,
        // Exactly one prefix — V8's own message already carries it
        message: expect.stringMatching(/^Invalid regular expression: \/\(a\+\/i: Unterminated group$/),
      }),
    );
  });

  it.each(['.*', 'a*', '^', 'x?'])('rejects %s, which matches empty text', (pattern) => {
    expect(() => compileUserPattern(pattern)).toThrow(
      expect.objectContaining({ statusCode: 400, message: expect.stringContaining('empty text') }),
    );
  });
});

describe('compileStoredPattern', () => {
  it('returns a case-insensitive RegExp for a valid pattern', () => {
    expect(compileStoredPattern('amazon')?.test('AMAZON PAY')).toBe(true);
  });

  it('returns null instead of throwing for a pattern that no longer compiles', () => {
    expect(compileStoredPattern('(')).toBeNull();
  });
});

describe('testAllWithTimeout', () => {
  it('tests every text and returns a main-realm boolean array', () => {
    const results = testAllWithTimeout(/swiggy/i, ['Swiggy order', 'Rent', 'SWIGGY'], 250);
    expect(results).toEqual([true, false, true]);
    expect(Array.isArray(results)).toBe(true);
  });

  it("returns 'timeout' when a catastrophic pattern exceeds the timeout", () => {
    const start = Date.now();
    const results = testAllWithTimeout(/^(a|aa)+$/i, [`${'a'.repeat(60)}!`], 20);
    expect(results).toBe('timeout');
    // Bounded by the watchdog, not by the (astronomical) backtracking cost
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("returns 'error' (not 'timeout') for any other failure inside the vm", () => {
    const hostile = { test: () => { throw new RangeError('boom'); } } as unknown as RegExp;
    expect(testAllWithTimeout(hostile, ['x'], 250)).toBe('error');
  });

  it('remains usable after a timeout', () => {
    testAllWithTimeout(/^(a|aa)+$/i, [`${'a'.repeat(60)}!`], 20);
    expect(testAllWithTimeout(/rent/i, ['House rent'], 250)).toEqual([true]);
  });
});
