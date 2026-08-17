/**
 * The document language is load-bearing, not decoration.
 *
 * Every native `<input type="date">` in the product takes its display format from it:
 * Chromium reads the `lang` attribute, and with the ambiguous "en" it fell back to the
 * browser's UI language — rendering the Add Loan pickers as mm/dd/yyyy on a US-configured
 * browser while every other date in the app read dd/mm/yyyy.
 *
 * There is nothing near the date inputs themselves that hints at this, so a tidy-up that
 * "simplifies" the attribute back to "en" would silently reintroduce it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('document language', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');

  it('is en-IN, so native date pickers render dd/mm/yyyy', () => {
    expect(html).toMatch(/<html lang="en-IN">/);
  });

  it('is not the ambiguous "en", which defers to the browser UI language', () => {
    expect(html).not.toMatch(/<html lang="en">/);
  });
});
