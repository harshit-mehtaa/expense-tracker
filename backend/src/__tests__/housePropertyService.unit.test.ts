/**
 * Unit tests for housePropertyService.ts
 *
 * Covers: CRUD (listHouseProperties, getHouseProperty, createHouseProperty,
 * updateHouseProperty, deleteHouseProperty) and calcHousePropertyIncome
 * across all usage × regime combinations.
 *
 * Uses named import { prisma } — dual-export mock required.
 * NOTE: updateHouseProperty re-fetches via findUnique (not findFirst).
 *
 * Tax rules tested:
 * - SELF_OCCUPIED OLD regime: GAV=0, interest capped at ₹2L
 * - SELF_OCCUPIED NEW regime: GAV=0, interest=0 (no deduction)
 * - LET_OUT OLD regime: GAV=rent, stdDed=30%, full interest
 * - LET_OUT NEW regime: GAV=rent, stdDed=30%, interest=0
 * - HP loss set-off: OLD regime only, capped at ₹2L
 * - Multiple properties: totalHPIncome is sum; taxableHPIncome = max(total, 0)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mock = {
    housePropertyDetail: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { default: mock, prisma: mock };
});

import { prisma } from '../config/prisma';
import {
  listHouseProperties,
  getHouseProperty,
  createHouseProperty,
  updateHouseProperty,
  deleteHouseProperty,
  calcHousePropertyIncome,
} from '../services/housePropertyService';

const hpMock = (prisma as any).housePropertyDetail;

const MOCK_PROPERTY = {
  id: 'hp-1',
  userId: 'u1',
  fyYear: '2025-26',
  propertyName: 'Home',
  usage: 'SELF_OCCUPIED',
  grossAnnualRent: 0,
  municipalTaxesPaid: 0,
  homeLoanInterest: 150000,
  deletedAt: null,
  createdAt: new Date('2025-04-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
  hpMock.findMany.mockResolvedValue([MOCK_PROPERTY]);
  hpMock.findFirst.mockResolvedValue(MOCK_PROPERTY);
  hpMock.findUnique.mockResolvedValue(MOCK_PROPERTY);
  hpMock.create.mockResolvedValue(MOCK_PROPERTY);
  hpMock.updateMany.mockResolvedValue({ count: 1 });
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

describe('listHouseProperties', () => {
  it('queries by userId, fyYear, deletedAt: null', async () => {
    const result = await listHouseProperties('u1', '2025-26');
    expect(hpMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', fyYear: '2025-26', deletedAt: null } }),
    );
    expect(result).toHaveLength(1);
  });
});

describe('getHouseProperty', () => {
  it('returns property when found', async () => {
    const result = await getHouseProperty('u1', 'hp-1');
    expect(hpMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'hp-1', userId: 'u1', deletedAt: null },
    });
    expect(result).toBeDefined();
  });

  it('returns null when not found', async () => {
    hpMock.findFirst.mockResolvedValue(null);
    const result = await getHouseProperty('u1', 'hp-x');
    expect(result).toBeNull();
  });
});

describe('createHouseProperty', () => {
  it('merges userId and calls create', async () => {
    const data = { fyYear: '2025-26', propertyName: 'Flat', usage: 'LET_OUT' as const };
    await createHouseProperty('u1', data as any);
    expect(hpMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', propertyName: 'Flat' }),
    });
  });
});

describe('updateHouseProperty', () => {
  it('happy path: count=1 → re-fetches via findUnique and returns updated record', async () => {
    const updated = { ...MOCK_PROPERTY, homeLoanInterest: 180000 };
    hpMock.findUnique.mockResolvedValue(updated);
    const result = await updateHouseProperty('u1', 'hp-1', { homeLoanInterest: 180000 });
    expect(hpMock.updateMany).toHaveBeenCalledWith({
      where: { id: 'hp-1', userId: 'u1', deletedAt: null },
      data: { homeLoanInterest: 180000 },
    });
    expect(hpMock.findUnique).toHaveBeenCalledWith({ where: { id: 'hp-1' } });
    expect(result).toEqual(updated);
  });

  it('not-found path: count=0 → returns null, findUnique not called', async () => {
    hpMock.updateMany.mockResolvedValue({ count: 0 });
    const result = await updateHouseProperty('u1', 'hp-x', { homeLoanInterest: 180000 });
    expect(result).toBeNull();
    expect(hpMock.findUnique).not.toHaveBeenCalled();
  });
});

describe('deleteHouseProperty', () => {
  it('soft-deletes → returns { deleted: true }', async () => {
    const result = await deleteHouseProperty('u1', 'hp-1');
    expect(hpMock.updateMany).toHaveBeenCalledWith({
      where: { id: 'hp-1', userId: 'u1', deletedAt: null },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });
    expect(result).toEqual({ deleted: true });
  });

  it('not-found path: count=0 → returns null', async () => {
    hpMock.updateMany.mockResolvedValue({ count: 0 });
    const result = await deleteHouseProperty('u1', 'hp-x');
    expect(result).toBeNull();
  });
});

// ─── calcHousePropertyIncome ──────────────────────────────────────────────────

function makeSelfOccupied(homeLoanInterest: number) {
  return {
    ...MOCK_PROPERTY,
    usage: 'SELF_OCCUPIED',
    grossAnnualRent: 0,
    municipalTaxesPaid: 0,
    homeLoanInterest,
  };
}

function makeLetOut(grossAnnualRent: number, municipalTaxesPaid: number, homeLoanInterest: number) {
  return {
    ...MOCK_PROPERTY,
    usage: 'LET_OUT',
    grossAnnualRent,
    municipalTaxesPaid,
    homeLoanInterest,
  };
}

describe('calcHousePropertyIncome — SELF_OCCUPIED', () => {
  it('OLD regime: GAV=0, interest deducted up to ₹2L cap', async () => {
    hpMock.findMany.mockResolvedValue([makeSelfOccupied(150000)]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'OLD');
    expect(r.properties[0].grossAnnualValue).toBe(0);
    expect(r.properties[0].netAnnualValue).toBe(0);
    expect(r.properties[0].standardDeduction30Pct).toBe(0);
    expect(r.properties[0].interestOnLoan).toBe(150000);
    expect(r.properties[0].incomeFromHP).toBe(-150000);
    expect(r.hpLossSetOff).toBe(150000); // min(150000, 200000)
    expect(r.taxableHPIncome).toBe(0);
  });

  it('OLD regime: interest over ₹2L capped at 200000', async () => {
    hpMock.findMany.mockResolvedValue([makeSelfOccupied(300000)]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'OLD');
    expect(r.properties[0].interestOnLoan).toBe(200000); // capped
    expect(r.properties[0].incomeFromHP).toBe(-200000);
    expect(r.hpLossSetOff).toBe(200000);
  });

  it('NEW regime: effectiveInterest = 0 (no Sec 24(b) deduction)', async () => {
    hpMock.findMany.mockResolvedValue([makeSelfOccupied(300000)]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'NEW');
    expect(r.properties[0].interestOnLoan).toBe(0);
    expect(r.properties[0].incomeFromHP).toBe(0);
    expect(r.hpLossSetOff).toBe(0);
    expect(r.taxableHPIncome).toBe(0);
  });
});

describe('calcHousePropertyIncome — LET_OUT', () => {
  it('OLD regime: GAV, NAV, 30% std deduction, full loan interest', async () => {
    // GAV=300000, municipal=30000 → NAV=270000, stdDed=81000 (30%), interest=50000
    // incomeFromHP = 270000 - 81000 - 50000 = 139000
    hpMock.findMany.mockResolvedValue([makeLetOut(300000, 30000, 50000)]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'OLD');
    expect(r.properties[0].grossAnnualValue).toBe(300000);
    expect(r.properties[0].netAnnualValue).toBe(270000);
    expect(r.properties[0].standardDeduction30Pct).toBe(81000);
    expect(r.properties[0].interestOnLoan).toBe(50000);
    expect(r.properties[0].incomeFromHP).toBe(139000);
    expect(r.taxableHPIncome).toBe(139000);
    expect(r.hpLossSetOff).toBe(0); // positive income
  });

  it('NEW regime: interest deduction not allowed (effectiveInterest = 0)', async () => {
    hpMock.findMany.mockResolvedValue([makeLetOut(300000, 30000, 50000)]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'NEW');
    expect(r.properties[0].interestOnLoan).toBe(0);
    // incomeFromHP = 270000 - 81000 - 0 = 189000
    expect(r.properties[0].incomeFromHP).toBe(189000);
    expect(r.hpLossSetOff).toBe(0);
  });

  it('OLD regime: LET_OUT resulting in loss → hpLossSetOff = |loss|', async () => {
    // GAV=100000, municipal=10000 → NAV=90000, stdDed=27000, interest=200000
    // incomeFromHP = 90000 - 27000 - 200000 = -137000
    hpMock.findMany.mockResolvedValue([makeLetOut(100000, 10000, 200000)]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'OLD');
    expect(r.properties[0].incomeFromHP).toBe(-137000);
    expect(r.hpLossSetOff).toBe(137000);
    expect(r.taxableHPIncome).toBe(0);
  });

  it('OLD regime: HP loss > ₹2L set-off cap → hpLossSetOff capped at 200000', async () => {
    // Large interest to force loss > ₹2L
    hpMock.findMany.mockResolvedValue([makeLetOut(100000, 10000, 500000)]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'OLD');
    // incomeFromHP = 90000 - 27000 - 500000 = -437000
    expect(r.totalHPIncome).toBe(-437000);
    expect(r.hpLossSetOff).toBe(200000); // capped
  });

  it('NEW regime: HP loss → hpLossSetOff = 0 (not permitted)', async () => {
    hpMock.findMany.mockResolvedValue([makeLetOut(100000, 10000, 200000)]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'NEW');
    // New regime: effectiveInterest=0, so no loss possible from interest
    expect(r.hpLossSetOff).toBe(0);
  });
});

describe('calcHousePropertyIncome — null field defaults', () => {
  it('treats null grossAnnualRent, municipalTaxesPaid, homeLoanInterest as 0', async () => {
    hpMock.findMany.mockResolvedValueOnce([
      {
        ...MOCK_PROPERTY,
        usage: 'LET_OUT',
        grossAnnualRent: null,
        municipalTaxesPaid: null,
        homeLoanInterest: null,
      },
    ]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'OLD');
    // gar=0, municipal=0 → GAV=0, NAV=0, stdDed=0, interest=0 → incomeFromHP=0
    expect(r.properties[0].grossAnnualValue).toBe(0);
    expect(r.properties[0].netAnnualValue).toBe(0);
    expect(r.properties[0].interestOnLoan).toBe(0);
    expect(r.properties[0].incomeFromHP).toBe(0);
  });
});

describe('calcHousePropertyIncome — multiple properties', () => {
  it('mixed: one self-occupied (loss) + one let-out (profit) — totalHPIncome is net', async () => {
    const selfOccupied = makeSelfOccupied(150000); // incomeFromHP = -150000
    const letOut = makeLetOut(600000, 60000, 0); // NAV=540000, stdDed=162000, income=378000
    hpMock.findMany.mockResolvedValue([selfOccupied, letOut]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'OLD');
    // total = -150000 + 378000 = 228000 (positive)
    expect(r.totalHPIncome).toBe(228000);
    expect(r.taxableHPIncome).toBe(228000);
    expect(r.hpLossSetOff).toBe(0); // positive overall
    expect(r.properties).toHaveLength(2);
  });

  it('empty properties list → all zeros', async () => {
    hpMock.findMany.mockResolvedValue([]);
    const r = await calcHousePropertyIncome('u1', '2025-26', 'OLD');
    expect(r.totalHPIncome).toBe(0);
    expect(r.taxableHPIncome).toBe(0);
    expect(r.hpLossSetOff).toBe(0);
    expect(r.properties).toHaveLength(0);
  });
});
