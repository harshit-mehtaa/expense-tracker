import fs from 'fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

type Thresholds = { statements: number; branches: number; functions: number; lines: number };

/**
 * One coverage-threshold entry PER page file. Vitest reads `perFile` only at the top
 * level of `thresholds` (where it would turn every glob per-file), so a glob like
 * '**\/src/pages/**' can only ever gate the pages in aggregate — and an aggregate lets
 * one page's tests be deleted with the gate still green. A key that names a single
 * file is its own group, so it gates exactly that file, and a failure names it.
 * Generated, so a new page is gated the moment it exists.
 */
function perFileThresholds(dir: string, floor: Thresholds): Record<string, Thresholds> {
  const root = path.resolve(__dirname, dir);
  const files = (fs.readdirSync(root, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => f.split(path.sep).join('/'));
  // A key that matches nothing passes silently — an empty list must be loud instead,
  // and so must a file name that would be read as a glob pattern (e.g. "[id].tsx").
  if (files.length === 0) throw new Error(`perFileThresholds: no source files found under ${dir}`);
  const globby = files.find((f) => /[[\]{}*?!()]/.test(f));
  if (globby) throw new Error(`perFileThresholds: "${globby}" contains glob characters and would match nothing`);
  return Object.fromEntries(files.map((f) => [`**/${dir}/${f}`, floor]));
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // In development, proxy /api requests to the backend via Nginx
    // (all traffic goes through Nginx even in dev — no direct proxy needed here)
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    env: {
      VITE_API_URL: 'http://localhost:3000',
      // NOTE: do NOT pin TZ here. test.env assigns process.env.TZ inside the worker
      // after ICU has resolved the zone, so it reads back correctly and has no effect
      // (verified: TZ=Pacific/Kiritimati still resolves to Kiritimati with this set).
      // The pin lives in the npm scripts, where it is process-level and actually works.
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/__tests__/**',
        'src/components/ui/**',            // shadcn primitives, vendored
        'src/types/**',                    // pure type declarations, emit no JS
        'src/main.tsx',                    // createRoot at module scope — unimportable
        'src/vite-env.d.ts',
      ],
      // Per-glob, NOT a single global number. A global figure lets 100% in lib/hooks/api
      // mask near-zero pages — which is exactly what the old 3/50/28/3 floor did: it was
      // measured against 183 branch points in a 15,914-statement app.
      //
      // NOTE the '**/' prefix on every glob. Vitest 1 matched these against ABSOLUTE paths,
      // where 'src/pages/**' silently matched NOTHING, enforced nothing, and still exited 0.
      // Vitest 3 matches root-relative paths, which '**/src/...' also matches — keep it.
      // Also (vitest 3): the trailing global numbers apply to EVERY file, globbed or not.
      thresholds: {
        '**/src/api/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        '**/src/lib/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        '**/src/hooks/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        '**/src/contexts/**': { statements: 95, branches: 85, functions: 95, lines: 95 },
        '**/src/components/**': { statements: 88, branches: 88, functions: 72, lines: 88 },
        // Pages: a floor on EACH page file, not the aggregate — see perFileThresholds.
        // Low because Transactions legitimately sits well below the other pages with its
        // modals unopened by design; the point is that no page can drop to zero unseen.
        ...perFileThresholds('src/pages', { statements: 30, branches: 30, functions: 15, lines: 30 }),
        // App.tsx is the one file no directory glob claims. Under vitest 1 the global
        // numbers below were its residual bucket; vitest 3 applies them project-wide,
        // so it gets its own entry with the floor it always had.
        '**/src/App.tsx': { statements: 90, branches: 72, functions: 90, lines: 90 },
        // Project-wide floor across all files, set just under the measured 81.78 / 81.03
        // / 66.25 / 81.78 at the vitest 3 upgrade. The per-directory globs are the real
        // gates; this one catches a broad regression none of them would flag alone. It is
        // deliberately tight, so a new untested file can trip it with a "global" error.
        statements: 81,
        branches: 80,
        functions: 65,
        lines: 81,
      },
    },
  },
});
