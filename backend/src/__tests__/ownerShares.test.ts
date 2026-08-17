/**
 * The ownership-share invariant, tested once for every domain that uses it.
 *
 * This module exists because loanService and investmentService each carried a copy of
 * these rules and the copies drifted: the rounding bug below was fixed in the loan copy
 * and left exploitable in the property one for weeks.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeOwnerShares, assertPrimaryOwnerRetained, ownerShareMultiplier,
} from '../utils/ownerShares';

describe('normalizeOwnerShares', () => {
  it('rejects a share that ROUNDS to zero, not merely one that is zero', () => {
    // 0.001 passes a raw `> 0` check and then stores as 0. Because the visibility
    // predicates key on owner membership alone, with no share threshold, that 0% row
    // still granted full view, edit and delete rights on the record.
    expect(() => normalizeOwnerShares('u1', [
      { userId: 'u1', sharePercent: 99.999 },
      { userId: 'u3', sharePercent: 0.001 },
    ], 'Property owner')).toThrow(/greater than 0/i);
  });

  it('accepts the smallest share that survives rounding', () => {
    const rows = normalizeOwnerShares('u1', [
      { userId: 'u1', sharePercent: 99.99 },
      { userId: 'u3', sharePercent: 0.01 },
    ], 'Property owner');
    expect(rows).toEqual([
      { userId: 'u1', sharePercent: 99.99 },
      { userId: 'u3', sharePercent: 0.01 },
    ]);
  });

  it('defaults to the record owner at 100% when no owners are given', () => {
    expect(normalizeOwnerShares('u1', undefined, 'Loan owner'))
      .toEqual([{ userId: 'u1', sharePercent: 100 }]);
    expect(normalizeOwnerShares('u1', [], 'Loan owner'))
      .toEqual([{ userId: 'u1', sharePercent: 100 }]);
  });

  it('refuses shares that do not add up to the whole', () => {
    expect(() => normalizeOwnerShares('u1', [
      { userId: 'u1', sharePercent: 50 }, { userId: 'u2', sharePercent: 30 },
    ], 'Loan owner')).toThrow(/add up to 100/i);
  });

  it('refuses a duplicate owner', () => {
    expect(() => normalizeOwnerShares('u1', [
      { userId: 'u1', sharePercent: 50 }, { userId: 'u1', sharePercent: 50 },
    ], 'Loan owner')).toThrow(/only be added once/i);
  });

  it('refuses a missing user, a non-number and an over-100 share', () => {
    expect(() => normalizeOwnerShares('u1', [{ userId: '', sharePercent: 100 }], 'Loan owner'))
      .toThrow(/required/i);
    expect(() => normalizeOwnerShares('u1', [{ userId: 'u1', sharePercent: Number.NaN }], 'Loan owner'))
      .toThrow(/greater than 0/i);
    expect(() => normalizeOwnerShares('u1', [{ userId: 'u1', sharePercent: 101 }], 'Loan owner'))
      .toThrow(/at most 100/i);
  });

  it('names the domain in the message, since these reach the user', () => {
    expect(() => normalizeOwnerShares('u1', [{ userId: 'u1', sharePercent: 50 }], 'Property owner'))
      .toThrow(/Property owner shares/);
  });
});

describe('assertPrimaryOwnerRetained', () => {
  const set = [{ userId: 'u2', sharePercent: 100 }];

  it('stops a co-owner removing the primary owner', () => {
    // The empty-array default protects the primary only when the array is EMPTY. A
    // non-empty array is written verbatim with deleteMany, so a 1% co-owner could send
    // [{self, 100}] and delete the primary from their own record.
    expect(() => assertPrimaryOwnerRetained(set, 'u1', 'u2', 'MEMBER', 'Property owner'))
      .toThrow(/only the property owner or an admin/i);
  });

  it('lets the primary owner restructure ownership away from themselves', () => {
    expect(() => assertPrimaryOwnerRetained(set, 'u1', 'u1', 'MEMBER', 'Loan owner')).not.toThrow();
  });

  it('lets an admin do it', () => {
    expect(() => assertPrimaryOwnerRetained(set, 'u1', 'admin', 'ADMIN', 'Loan owner')).not.toThrow();
  });

  it('allows any set that still contains the primary', () => {
    expect(() => assertPrimaryOwnerRetained(
      [{ userId: 'u1', sharePercent: 1 }, { userId: 'u2', sharePercent: 99 }],
      'u1', 'u2', 'MEMBER', 'Loan owner',
    )).not.toThrow();
  });

  it('ignores an empty set, which the normalizer defaults instead', () => {
    expect(() => assertPrimaryOwnerRetained([], 'u1', 'u2', 'MEMBER', 'Loan owner')).not.toThrow();
  });
});

describe('ownerShareMultiplier', () => {
  const owners = [{ userId: 'u2', sharePercent: 60 }, { userId: 'u3', sharePercent: 40 }];

  it('gives a non-owner nothing, even the record owner', () => {
    // The `record.userId === scopedUserId` fallback that used to be here reported the
    // primary at 100% while both co-owners also reported their shares — the same asset
    // counted at 200% of its value across the family.
    expect(ownerShareMultiplier(owners, 'u1')).toBe(0);
  });

  it('never lets the shares of every viewer exceed the whole', () => {
    const total = ['u1', 'u2', 'u3'].reduce((sum, u) => sum + ownerShareMultiplier(owners, u), 0);
    expect(total).toBeLessThanOrEqual(1);
  });

  it('gives each owner exactly their share', () => {
    expect(ownerShareMultiplier(owners, 'u2')).toBe(0.6);
    expect(ownerShareMultiplier(owners, 'u3')).toBe(0.4);
  });

  it('falls back to the whole ONLY when there are no owner rows', () => {
    // How records created before co-ownership existed are represented.
    expect(ownerShareMultiplier([], 'u1')).toBe(1);
    expect(ownerShareMultiplier(null, 'u1')).toBe(1);
    expect(ownerShareMultiplier(undefined, 'u1')).toBe(1);
  });

  it('is the whole for an unscoped (family-wide) read', () => {
    expect(ownerShareMultiplier(owners, undefined)).toBe(1);
  });

  it('handles a Prisma Decimal without a cast at the call site', () => {
    const decimalish = { toString: () => '60', valueOf: () => 60 };
    expect(ownerShareMultiplier([{ userId: 'u2', sharePercent: decimalish }], 'u2')).toBe(0.6);
  });
});
