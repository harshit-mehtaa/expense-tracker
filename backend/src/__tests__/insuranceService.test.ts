/**
 * Unit tests for insuranceService.ts.
 *
 * Key test focus:
 * - getPremiumCalendar: groups by day-of-month with null/invalid-day filtering
 * - get80DSummary: self vs parents bucket split, premium frequency multipliers,
 *   25K per-bucket cap, LIFE/TERM policy type exclusion
 *
 * insuranceService uses named import { prisma }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// insuranceService uses named import { prisma }
vi.mock('../config/prisma', () => {
  const mockPrisma = {
    insurancePolicy: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import { prisma } from '../config/prisma';
import {
  getInsurancePolicies,
  getPremiumCalendar,
  createInsurancePolicy,
  updateInsurancePolicy,
  deleteInsurancePolicy,
  get80DSummary,
} from '../services/insuranceService';

const policyMock = (prisma as any).insurancePolicy;

const MOCK_POLICY = {
  id: 'pol-1',
  userId: 'u1',
  policyName: 'Health Plan',
  policyType: 'HEALTH',
  insurer: 'LIC',
  premiumAmount: 2000,
  premiumFrequency: 'MONTHLY',
  premiumDueDate: 5,
  sumAssured: 500000,
  isActive: true,
  is80dEligible: true,
  is80cEligible: false,
  isForParents: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  policyMock.findMany.mockResolvedValue([MOCK_POLICY]);
  policyMock.findFirst.mockResolvedValue(MOCK_POLICY);
  policyMock.create.mockResolvedValue(MOCK_POLICY);
  policyMock.update.mockResolvedValue(MOCK_POLICY);
  policyMock.delete.mockResolvedValue(MOCK_POLICY);
});

// ─────────────────────────────────────────────────────────────────────────────
// getInsurancePolicies
// ─────────────────────────────────────────────────────────────────────────────

describe('getInsurancePolicies', () => {
  it('queries by userId ordered by premiumDueDate', async () => {
    const result = await getInsurancePolicies('u1');
    expect(policyMock.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { premiumDueDate: 'asc' },
    });
    expect(result).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createInsurancePolicy
// ─────────────────────────────────────────────────────────────────────────────

describe('createInsurancePolicy', () => {
  it('creates policy with userId merged', async () => {
    await createInsurancePolicy('u1', { policyName: 'Test' } as any);
    expect(policyMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ policyName: 'Test', userId: 'u1' }),
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateInsurancePolicy
// ─────────────────────────────────────────────────────────────────────────────

describe('updateInsurancePolicy', () => {
  it('updates policy when found', async () => {
    await updateInsurancePolicy('u1', 'pol-1', { premiumAmount: 2500 });
    expect(policyMock.update).toHaveBeenCalledWith({
      where: { id: 'pol-1' },
      data: { premiumAmount: 2500 },
    });
  });

  it('throws NotFound when policy does not exist', async () => {
    policyMock.findFirst.mockResolvedValue(null);
    await expect(updateInsurancePolicy('u1', 'pol-x', {})).rejects.toThrow(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteInsurancePolicy
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteInsurancePolicy', () => {
  it('deletes policy when found', async () => {
    await deleteInsurancePolicy('u1', 'pol-1');
    expect(policyMock.delete).toHaveBeenCalledWith({ where: { id: 'pol-1' } });
  });

  it('throws NotFound when policy does not exist', async () => {
    policyMock.findFirst.mockResolvedValue(null);
    await expect(deleteInsurancePolicy('u1', 'pol-x')).rejects.toThrow(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPremiumCalendar
// ─────────────────────────────────────────────────────────────────────────────

describe('getPremiumCalendar', () => {
  it('groups policies by day-of-month with zero-padded keys', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, id: 'p1', premiumDueDate: 5 },
      { ...MOCK_POLICY, id: 'p2', premiumDueDate: 15 },
      { ...MOCK_POLICY, id: 'p3', premiumDueDate: 5 }, // same day as p1
    ]);
    const result = await getPremiumCalendar('u1');
    expect(result['05']).toHaveLength(2);
    expect(result['15']).toHaveLength(1);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('single-digit day is zero-padded (day 3 → "03")', async () => {
    policyMock.findMany.mockResolvedValue([{ ...MOCK_POLICY, premiumDueDate: 3 }]);
    const result = await getPremiumCalendar('u1');
    expect(result['03']).toBeDefined();
    expect(result['3']).toBeUndefined();
  });

  it('skips entries with null premiumDueDate', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, id: 'p1', premiumDueDate: null },
      { ...MOCK_POLICY, id: 'p2', premiumDueDate: 10 },
    ]);
    const result = await getPremiumCalendar('u1');
    expect(Object.keys(result)).toHaveLength(1);
    expect(result['10']).toBeDefined();
  });

  it('skips entries with invalid day (< 1 or > 31)', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, id: 'p1', premiumDueDate: 0 },   // < 1: invalid
      { ...MOCK_POLICY, id: 'p2', premiumDueDate: 32 },  // > 31: invalid
      { ...MOCK_POLICY, id: 'p3', premiumDueDate: 1 },   // valid
    ]);
    const result = await getPremiumCalendar('u1');
    expect(Object.keys(result)).toHaveLength(1);
    expect(result['01']).toBeDefined();
  });

  it('returns empty object when no policies', async () => {
    policyMock.findMany.mockResolvedValue([]);
    const result = await getPremiumCalendar('u1');
    expect(result).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// get80DSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('get80DSummary', () => {
  it('only queries is80dEligible policies', async () => {
    policyMock.findMany.mockResolvedValue([]);
    await get80DSummary('u1');
    expect(policyMock.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', is80dEligible: true },
    });
  });

  it('MONTHLY frequency: multiplies premiumAmount by 12', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, premiumAmount: 1000, premiumFrequency: 'MONTHLY', isForParents: false },
    ]);
    const result = await get80DSummary('u1');
    expect(result.selfFamily.paid).toBe(12000);
  });

  it('QUARTERLY frequency: multiplies by 4', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, premiumAmount: 3000, premiumFrequency: 'QUARTERLY', isForParents: false },
    ]);
    const result = await get80DSummary('u1');
    expect(result.selfFamily.paid).toBe(12000);
  });

  it('HALF_YEARLY frequency: multiplies by 2', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, premiumAmount: 6000, premiumFrequency: 'HALF_YEARLY', isForParents: false },
    ]);
    const result = await get80DSummary('u1');
    expect(result.selfFamily.paid).toBe(12000);
  });

  it('YEARLY frequency: uses amount as-is', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, premiumAmount: 12000, premiumFrequency: 'YEARLY', isForParents: false },
    ]);
    const result = await get80DSummary('u1');
    expect(result.selfFamily.paid).toBe(12000);
  });

  it('splits self vs parents into separate buckets', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, id: 'p1', premiumAmount: 10000, premiumFrequency: 'YEARLY', isForParents: false },
      { ...MOCK_POLICY, id: 'p2', premiumAmount: 8000, premiumFrequency: 'YEARLY', isForParents: true },
    ]);
    const result = await get80DSummary('u1');
    expect(result.selfFamily.paid).toBe(10000);
    expect(result.parents.paid).toBe(8000);
    expect(result.total).toBe(18000);
  });

  it('caps self-family deductible at ₹25,000', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, premiumAmount: 30000, premiumFrequency: 'YEARLY', isForParents: false },
    ]);
    const result = await get80DSummary('u1');
    expect(result.selfFamily.paid).toBe(30000);
    expect(result.selfFamily.deductible).toBe(25000); // capped
    expect(result.total).toBe(25000);
  });

  it('caps parents deductible at ₹25,000', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, premiumAmount: 30000, premiumFrequency: 'YEARLY', isForParents: true },
    ]);
    const result = await get80DSummary('u1');
    expect(result.parents.deductible).toBe(25000); // capped
  });

  it('includes SUPER_TOP_UP and CRITICAL_ILLNESS policy types in deductible', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, policyType: 'SUPER_TOP_UP',      premiumAmount: 5000, premiumFrequency: 'YEARLY', isForParents: false },
      { ...MOCK_POLICY, policyType: 'CRITICAL_ILLNESS',  premiumAmount: 3000, premiumFrequency: 'YEARLY', isForParents: false },
    ]);
    const result = await get80DSummary('u1');
    expect(result.selfFamily.paid).toBe(8000);
    expect(result.total).toBe(8000);
  });

  it('excludes LIFE and TERM policy types from deductible calculation', async () => {
    policyMock.findMany.mockResolvedValue([
      { ...MOCK_POLICY, policyType: 'LIFE',  premiumAmount: 20000, premiumFrequency: 'YEARLY', isForParents: false },
      { ...MOCK_POLICY, policyType: 'TERM',  premiumAmount: 10000, premiumFrequency: 'YEARLY', isForParents: false },
      { ...MOCK_POLICY, policyType: 'HEALTH',premiumAmount: 5000,  premiumFrequency: 'YEARLY', isForParents: false },
    ]);
    const result = await get80DSummary('u1');
    // Only HEALTH counts
    expect(result.selfFamily.paid).toBe(5000);
    expect(result.total).toBe(5000);
  });

  it('returns zero totals when no eligible policies', async () => {
    policyMock.findMany.mockResolvedValue([]);
    const result = await get80DSummary('u1');
    expect(result.total).toBe(0);
    expect(result.selfFamily.paid).toBe(0);
    expect(result.parents.paid).toBe(0);
  });
});
