/**
 * Tests for auditService's OWN body, with isTest=false.
 *
 * Kept in its own file because vi.mock is hoisted to file scope: every other test
 * file needs the real `isTest === true` so recordAuditLog short-circuits at line 20
 * and never attempts a write. Mocking isTest=false here is what lets the rest of the
 * function (the auditLog?.create guard, toJsonValue, and the create call) execute.
 *
 * NOTE: this covers auditService's internal logic. The *payloads* routes send to
 * recordAuditLog are covered separately, at the route-test layer, by mocking this
 * module and asserting the call arguments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  prisma: { auditLog: undefined as any },
}));

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'production', PORT: 3000 },
  isDev: false,
  isProd: true,
  isTest: false,
}));

vi.mock('../config/prisma', () => ({
  default: hoisted.prisma,
  prisma: hoisted.prisma,
}));

const { recordAuditLog } = await import('../services/auditService');

const BASE_INPUT = {
  performedByUserId: 'u1',
  action: 'UPDATE' as const,
  entityType: 'Loan',
  entityId: 'loan-1',
};

let createMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  createMock = vi.fn().mockResolvedValue({ id: 'audit-1' });
  hoisted.prisma.auditLog = { create: createMock };
});

describe('recordAuditLog — availability guard', () => {
  it('returns null without throwing when prisma.auditLog is entirely absent', async () => {
    hoisted.prisma.auditLog = undefined;
    const result = await recordAuditLog(BASE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null when prisma.auditLog exists but has no create method', async () => {
    hoisted.prisma.auditLog = {};
    const result = await recordAuditLog(BASE_INPUT);
    expect(result).toBeNull();
  });

  it('writes and returns the created row when auditLog.create is available', async () => {
    const result = await recordAuditLog(BASE_INPUT);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'audit-1' });
  });
});

describe('recordAuditLog — persisted payload', () => {
  it('maps every input field onto the audit row', async () => {
    await recordAuditLog({
      performedByUserId: 'admin-1',
      action: 'DELETE',
      entityType: 'FixedDeposit',
      entityId: 'fd-9',
      oldValue: { principalAmount: 100 },
    });
    expect(createMock).toHaveBeenCalledWith({
      data: {
        performedByUserId: 'admin-1',
        action: 'DELETE',
        entityType: 'FixedDeposit',
        entityId: 'fd-9',
        oldValueJson: { principalAmount: 100 },
        newValueJson: undefined,
      },
    });
  });

  it('accepts a non-AuditAction action string (the `| string` half of the union)', async () => {
    await recordAuditLog({ ...BASE_INPUT, action: 'ARCHIVE' });
    expect(createMock.mock.calls[0][0].data.action).toBe('ARCHIVE');
  });
});

// toJsonValue is module-private — exercised through recordAuditLog's two JSON fields.
describe('recordAuditLog — toJsonValue serialization', () => {
  it('leaves undefined as undefined rather than serializing it to null', async () => {
    await recordAuditLog(BASE_INPUT); // neither oldValue nor newValue supplied
    const { data } = createMock.mock.calls[0][0];
    expect(data.oldValueJson).toBeUndefined();
    expect(data.newValueJson).toBeUndefined();
  });

  it('serializes an explicit null (distinct from undefined — a real CREATE has oldValue: null)', async () => {
    await recordAuditLog({ ...BASE_INPUT, action: 'CREATE', oldValue: null, newValue: { id: 'x' } });
    const { data } = createMock.mock.calls[0][0];
    expect(data.oldValueJson).toBeNull();
    expect(data.newValueJson).toEqual({ id: 'x' });
  });

  it('converts Date instances to ISO strings via the JSON round-trip', async () => {
    await recordAuditLog({ ...BASE_INPUT, newValue: { startDate: new Date('2025-04-01T00:00:00.000Z') } });
    const { data } = createMock.mock.calls[0][0];
    expect(data.newValueJson).toEqual({ startDate: '2025-04-01T00:00:00.000Z' });
  });

  it('drops undefined object properties (JSON.stringify semantics)', async () => {
    await recordAuditLog({ ...BASE_INPUT, newValue: { kept: 1, dropped: undefined } });
    const { data } = createMock.mock.calls[0][0];
    expect(data.newValueJson).toEqual({ kept: 1 });
    expect(data.newValueJson).not.toHaveProperty('dropped');
  });

  it('deep-clones so later mutation of the source object cannot alter the audit row', async () => {
    const source = { nested: { amount: 100 } };
    await recordAuditLog({ ...BASE_INPUT, oldValue: source });
    source.nested.amount = 999;
    expect(createMock.mock.calls[0][0].data.oldValueJson).toEqual({ nested: { amount: 100 } });
  });

  it('serializes arrays and primitives, not just plain objects', async () => {
    await recordAuditLog({ ...BASE_INPUT, oldValue: [1, 2, 3], newValue: 'a string' });
    const { data } = createMock.mock.calls[0][0];
    expect(data.oldValueJson).toEqual([1, 2, 3]);
    expect(data.newValueJson).toBe('a string');
  });
});
