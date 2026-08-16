/**
 * Unit tests for sanitizeFilename — a stored-XSS mitigation, not a cosmetic tidy-up.
 *
 * The result is persisted to document.fileName / bankStatementImport.filename and
 * rendered back in the UI, so each of the three jobs (metacharacter replacement,
 * control-char stripping, length cap) is tested independently.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../utils/sanitizeFilename';

describe('sanitizeFilename — metacharacter replacement', () => {
  it('neutralizes an XSS-shaped filename so no tag survives', () => {
    const result = sanitizeFilename('<img src=x onerror=alert(1)>.csv');
    expect(result).toBe('_img src=x onerror=alert(1)_.csv');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('replaces a script tag payload', () => {
    expect(sanitizeFilename('<script>alert(1)</script>.csv'))
      .toBe('_script_alert(1)__script_.csv');
  });

  it.each([
    ['<', 'a<b', 'a_b'],
    ['>', 'a>b', 'a_b'],
    ['"', 'a"b', 'a_b'],
    ["'", "a'b", 'a_b'],
    ['/', 'a/b', 'a_b'],
    ['\\', 'a\\b', 'a_b'],
  ])('replaces %s with an underscore', (_label, input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('kills path traversal by replacing the separators, leaving the dots', () => {
    // Dots are legal in filenames; traversal dies once / and \ are gone.
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('.._.._windows_system32');
  });

  it('replaces every occurrence, not just the first (global regex)', () => {
    expect(sanitizeFilename('a/b/c/d')).toBe('a_b_c_d');
  });

  it('leaves a clean filename untouched', () => {
    expect(sanitizeFilename('hdfc-statement-2025-04.csv')).toBe('hdfc-statement-2025-04.csv');
  });
});

describe('sanitizeFilename — control character stripping', () => {
  it('strips a NUL byte, which could truncate a path in a C-based syscall', () => {
    expect(sanitizeFilename('safe\x00.csv')).toBe('safe.csv');
  });

  it('strips newline, carriage return and tab', () => {
    expect(sanitizeFilename('a\nb\rc\td')).toBe('abcd');
  });

  it('strips the full C0 range (0x00-0x1f) but keeps 0x20 space and 0x7f', () => {
    expect(sanitizeFilename('\x01\x1fname')).toBe('name');
    expect(sanitizeFilename('my name.csv')).toBe('my name.csv'); // 0x20 kept
    expect(sanitizeFilename('a\x7fb')).toBe('a\x7fb'); // DEL is outside C0, kept
  });

  it('removes control chars rather than replacing them with underscores', () => {
    // Distinguishes the strip step from the replace step.
    expect(sanitizeFilename('a\x00b')).toBe('ab');
    expect(sanitizeFilename('a<b')).toBe('a_b');
  });
});

describe('sanitizeFilename — length cap', () => {
  it('truncates to 200 characters', () => {
    expect(sanitizeFilename('a'.repeat(500))).toHaveLength(200);
  });

  it('leaves a 200-char name exactly as-is (boundary)', () => {
    const exact = 'b'.repeat(200);
    expect(sanitizeFilename(exact)).toBe(exact);
  });

  it('leaves a 199-char name untouched (just under the boundary)', () => {
    expect(sanitizeFilename('c'.repeat(199))).toHaveLength(199);
  });

  it('applies the cap AFTER stripping, so stripped chars do not consume budget', () => {
    // 100 control chars + 250 real chars -> strip leaves 250 -> cap to 200.
    const input = '\x00'.repeat(100) + 'd'.repeat(250);
    const result = sanitizeFilename(input);
    expect(result).toBe('d'.repeat(200));
  });
});

describe('sanitizeFilename — edge cases', () => {
  it('returns an empty string unchanged', () => {
    expect(sanitizeFilename('')).toBe('');
  });

  it('returns an empty string when the input is entirely control characters', () => {
    expect(sanitizeFilename('\x00\x01\x02')).toBe('');
  });

  it('preserves unicode', () => {
    expect(sanitizeFilename('स्टेटमेंट-2025.csv')).toBe('स्टेटमेंट-2025.csv');
  });
});
