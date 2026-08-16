import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

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
        // Dead code: zero importers repo-wide (verified by grep). Excluded rather than
        // tested, because testing code nothing runs inflates the number dishonestly.
        // ErrorBoundary being unused means the app has NO error boundary at all — the
        // fix is to wire it up in AppShell, not to test it here. Tracked in vision.md.
        'src/components/shared/PageHeader.tsx',
        'src/components/shared/ErrorBoundary.tsx',
      ],
      // Per-glob, NOT a single global number. A global figure lets 100% in lib/hooks/api
      // mask near-zero pages — which is exactly what the old 3/50/28/3 floor did: it was
      // measured against 183 branch points in a 15,914-statement app.
      //
      // NOTE the '**/' prefix on every glob. Vitest matches these against ABSOLUTE paths,
      // so 'src/pages/**' silently matches NOTHING, enforces nothing, and still exits 0.
      // Also: files matched by a glob are REMOVED from the global bucket, so the trailing
      // global numbers below apply only to whatever no glob claimed.
      thresholds: {
        '**/src/api/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        '**/src/lib/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        '**/src/hooks/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        '**/src/contexts/**': { statements: 95, branches: 85, functions: 95, lines: 95 },
        '**/src/components/**': { statements: 88, branches: 88, functions: 72, lines: 88 },
        // perFile so deleting one page's test file fails the gate. An aggregate floor
        // over 26 pages cannot express "don't delete a test" — 19 of 26 could be dropped
        // to zero with the aggregate still passing (verified by deleting two and watching
        // CI stay green, which would have silently removed the only regression guard for
        // the ChangePassword fix). The floor is low because Transactions legitimately
        // sits at ~37% with its modals unopened by design.
        '**/src/pages/**': {
          statements: 30, branches: 30, functions: 15, lines: 30, perFile: true,
        },
        // Residual bucket: currently ONLY src/App.tsx (every other file is claimed by a
        // glob above, and globbed files are removed from this bucket). Measured 97.65 /
        // 76.92 / 100. These are not a project-wide floor — the globs are.
        statements: 90,
        branches: 72,
        functions: 90,
        lines: 90,
      },
    },
  },
});
