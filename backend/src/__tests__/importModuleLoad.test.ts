/**
 * Covers the module-load side effect in routes/import.ts:
 *   if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
 *
 * That runs exactly once per module import, so only ONE arm can be observed per test
 * file. The main suite imports the router after setup.ts has already created the shared
 * uploads dir, covering the "exists" arm; this file points env.UPLOADS_DIR at a path
 * that does not exist yet, covering the "create it" arm.
 *
 * Same pattern as documentsModuleLoad.test.ts.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A path guaranteed not to exist when the router module is first evaluated.
const FRESH_DIR = path.join(os.tmpdir(), `expense-tracker-import-moduleload-${process.pid}`);
fs.rmSync(FRESH_DIR, { recursive: true, force: true });

vi.mock('../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/env')>();
  return { ...actual, env: { ...actual.env, UPLOADS_DIR: FRESH_DIR } };
});

afterAll(() => {
  fs.rmSync(FRESH_DIR, { recursive: true, force: true });
});

describe('routes/import.ts module-load side effect', () => {
  it('creates the uploads directory when it does not already exist', async () => {
    expect(fs.existsSync(FRESH_DIR)).toBe(false);

    // Importing the router evaluates the mkdirSync guard.
    const mod = await import('../routes/import');

    expect(fs.existsSync(FRESH_DIR)).toBe(true);
    expect(mod.default).toBeDefined();
  });
});
