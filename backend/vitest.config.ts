import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        'prisma/',
        'src/__tests__/',
        // NOT just bootstrap: also holds sanitizeFilename (stored-XSS mitigation), the
        // multer fileFilter upload boundary, and the ~130-line POST /api/transactions/import
        // handler — all at 0%. Untestable only because app.listen() runs at module scope,
        // so nothing can import it. Fix is to extract createApp() + routes/import.ts, then
        // drop this exclusion. Until then "100% coverage" excludes real business logic.
        'src/index.ts',
        'src/config/prisma.ts', // Prisma singleton — infrastructure, not business logic
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
