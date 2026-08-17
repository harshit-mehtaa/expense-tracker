import fs from 'fs';
import path from 'path';
import { PAYMENT_MODES, PAYMENT_MODE } from '../constants/paymentModes';

/**
 * The payment mode list exists three times by necessity: the Prisma enum (the database's
 * truth), the backend constant (runtime validation), and the frontend constant (the
 * dropdown). Prisma generates a TYPE but not a runtime array, so the duplication cannot
 * be removed — only guarded.
 *
 * It was previously duplicated eight times and drift was invisible until a user hit a 422
 * on a value the database accepts. These read the other two files and fail on divergence.
 */

const repoRoot = path.resolve(__dirname, '../../..');

function enumValuesFromPrismaSchema(): string[] {
  const schema = fs.readFileSync(
    path.join(repoRoot, 'backend/prisma/schema.prisma'),
    'utf8',
  );
  const block = schema.match(/enum PaymentMode \{([^}]*)\}/);
  if (!block) throw new Error('PaymentMode enum not found in schema.prisma');
  return block[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
}

function valuesFromFrontendConstant(): string[] {
  const src = fs.readFileSync(
    path.join(repoRoot, 'frontend/src/lib/paymentModes.ts'),
    'utf8',
  );
  const block = src.match(/export const PAYMENT_MODES = \[([^\]]*)\]/);
  if (!block) throw new Error('PAYMENT_MODES not found in the frontend constant');
  return [...block[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

describe('PaymentMode stays in step across the stack', () => {
  it('matches the Prisma enum exactly, including order', () => {
    // Order matters: it is the order of the dropdown, and the migration placed
    // NETBANKING after UPI deliberately.
    expect([...PAYMENT_MODES]).toEqual(enumValuesFromPrismaSchema());
  });

  it('matches the frontend list, so the UI cannot offer a value the API rejects', () => {
    expect(valuesFromFrontendConstant()).toEqual([...PAYMENT_MODES]);
  });

  it('includes NETBANKING, which Indian subscription mandates actually use', () => {
    expect(PAYMENT_MODES).toContain('NETBANKING');
    expect(PAYMENT_MODE.safeParse('NETBANKING').success).toBe(true);
  });

  it('rejects a value outside the enum rather than letting Prisma throw a 500', () => {
    expect(PAYMENT_MODE.safeParse('BITCOIN').success).toBe(false);
  });
});
