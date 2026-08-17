/**
 * Every chart must sit in a container that can shrink.
 *
 * `ResponsiveContainer` renders an SVG with an explicit pixel width. If its enclosing
 * element can be held open by that SVG, shrinking the window never propagates — the
 * container re-measures the old width and the chart keeps its size. `main` has
 * `overflow-x-hidden`, so the result is a chart clipped out of view rather than one that
 * scrolls, which is how this surfaced: the Reports monthly-trend chart chopping off on
 * resize.
 *
 * `min-w-0` lets the container shrink below its content; `overflow-hidden` stops the
 * oversized SVG holding it open while that happens.
 *
 * Asserted by reading the source because layout has no meaning in jsdom — nothing is
 * measured, so a rendering test could not tell a shrinkable container from a rigid one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Walks src/pages rather than globbing, so this works on any Node version. */
function chartFiles(dir = join(__dirname, '..', 'pages')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : chartFiles(full);
    if (!entry.name.endsWith('.tsx')) return [];
    return readFileSync(full, 'utf-8').includes('<ResponsiveContainer') ? [full] : [];
  });
}

/** The element that actually encloses each chart, by brace-matching rather than proximity. */
function enclosingClassOf(source: string): { line: number; className: string | null }[] {
  const lines = source.split('\n');
  const out: { line: number; className: string | null }[] = [];

  lines.forEach((line, i) => {
    if (!line.includes('<ResponsiveContainer')) return;
    let depth = 0;
    for (let j = i - 1; j >= 0; j--) {
      const closes = (lines[j].match(/<\/div>/g) ?? []).length;
      const opens = (lines[j].match(/<div(?![^>]*\/>)/g) ?? []).length;
      depth += closes - opens;
      if (depth < 0) {
        out.push({ line: i + 1, className: /className="([^"]*)"/.exec(lines[j])?.[1] ?? null });
        return;
      }
    }
    out.push({ line: i + 1, className: null });
  });

  return out;
}

describe('every chart can shrink with its container', () => {
  const files = chartFiles();

  it('finds the chart pages at all, so an empty pass is impossible', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.split('/pages/')[1], f]))('%s', (_name, file) => {
    const offenders = enclosingClassOf(readFileSync(file, 'utf-8'))
      .filter((c) => !c.className?.includes('min-w-0'))
      .map((c) => `line ${c.line}`);

    expect(offenders).toEqual([]);
  });
});
