/**
 * Unit tests for subscriptionService.ts.
 *
 * Focus: the ownership chain (subscription -> rule -> template) is created and destroyed
 * atomically, cancellation actually stops the money, and price changes append to history
 * rather than overwriting it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mockPrisma = {
    subscription: {
      findMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    subscriptionPrice: { create: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    recurringRule: { create: vi.fn(), update: vi.fn() },
    transaction: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    bankAccount: { findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import prisma from '../config/prisma';
import {
  listSubscriptions, getSubscription, createSubscription, updateSubscription,
  recordPriceChange, cancelSubscription, resumeSubscription, deleteSubscription,
  getSubscriptionForAudit,
} from '../services/subscriptionService';

const subMock = (prisma as any).subscription;
const priceMock = (prisma as any).subscriptionPrice;
const ruleMock = (prisma as any).recurringRule;
const txnMock = (prisma as any).transaction;

const MOCK_SUB = {
  id: 'sub-1',
  userId: 'u1',
  name: 'Netflix',
  vendor: null,
  status: 'ACTIVE',
  cancellationUrl: 'https://netflix.com/cancel',
  startDate: new Date('2025-01-01'),
  trialEndDate: null,
  cancelledAt: null,
  cancelReason: null,
  notes: null,
  prices: [
    { id: 'p-2', amount: 649, effectiveFrom: new Date('2026-07-01'), note: null },
    { id: 'p-1', amount: 499, effectiveFrom: new Date('2025-01-01'), note: null },
  ],
  recurringRule: {
    id: 'rule-1', frequency: 'MONTHLY', nextRunDate: new Date('2026-09-01'), isActive: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma as any).$transaction.mockImplementation(async (fn: any) => fn(prisma));
  txnMock.findMany.mockResolvedValue([]);
  (prisma as any).bankAccount.findFirst.mockResolvedValue({ id: 'acct-1' });
  (prisma as any).category.findFirst.mockResolvedValue({ id: 'cat-1' });
});

describe('createSubscription', () => {
  beforeEach(() => {
    subMock.create.mockResolvedValue({ id: 'sub-1' });
    txnMock.create.mockResolvedValue({ id: 'tmpl-1' });
    ruleMock.create.mockResolvedValue({ id: 'rule-1' });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);
  });

  it('creates subscription, opening price and rule in ONE transaction', async () => {
    // A partial chain is worse than nothing: an orphaned rule keeps charging with
    // nothing on screen to explain why.
    await createSubscription('u1', {
      name: 'Netflix', amount: 499, frequency: 'MONTHLY', startDate: '2025-01-01',
    } as never);

    expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
    expect(subMock.create).toHaveBeenCalled();
    expect(priceMock.create).toHaveBeenCalled();
    expect(ruleMock.create).toHaveBeenCalled();
    // No template Transaction: a subscription no longer puts a charge that never
    // happened into the ledger.
    expect(txnMock.create).not.toHaveBeenCalled();
  });

  it('links the rule to the subscription so the guard can see it', async () => {
    await createSubscription('u1', {
      name: 'Netflix', amount: 499, frequency: 'MONTHLY', startDate: '2025-01-01',
    } as never);

    expect(ruleMock.create.mock.calls[0][0].data.subscriptionId).toBe('sub-1');
  });

  it('dates the opening price from the start date so day-one charges resolve', async () => {
    await createSubscription('u1', {
      name: 'Netflix', amount: 499, frequency: 'MONTHLY', startDate: '2025-01-01',
    } as never);

    const price = priceMock.create.mock.calls[0][0].data;
    expect(price.effectiveFrom).toEqual(new Date('2025-01-01'));
    expect(Number(price.amount)).toBe(499);
  });

  it('a trial starts TRIALING and first bills at trial end, not at signup', async () => {
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    await createSubscription('u1', {
      name: 'Disney+', amount: 299, frequency: 'MONTHLY',
      startDate: new Date().toISOString(), trialEndDate: future,
    } as never);

    expect(subMock.create.mock.calls[0][0].data.status).toBe('TRIALING');
    // The engine needs no trial special-case: nothing is due until the trial ends.
    expect(ruleMock.create.mock.calls[0][0].data.nextRunDate).toEqual(new Date(future));
  });

  it('an already-expired trial date does not leave it stuck TRIALING', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await createSubscription('u1', {
      name: 'Old', amount: 100, frequency: 'MONTHLY',
      startDate: '2025-01-01', trialEndDate: past,
    } as never);

    expect(subMock.create.mock.calls[0][0].data.status).toBe('ACTIVE');
  });

  it('refuses a bank account belonging to someone else', async () => {
    (prisma as any).bankAccount.findFirst.mockResolvedValue(null);

    await expect(createSubscription('u1', {
      name: 'X', amount: 100, frequency: 'MONTHLY',
      startDate: '2025-01-01', bankAccountId: 'acct-of-u2',
    } as never)).rejects.toThrow(/bank account/i);

    expect(subMock.create).not.toHaveBeenCalled();
  });
});

describe('cancelSubscription', () => {
  it('sets status AND deactivates the rule in one transaction', async () => {
    // Pre-mortem #3: a cancelled subscription that kept billing. Status and isActive
    // must never be able to disagree.
    subMock.findFirst.mockResolvedValue({ ...MOCK_SUB, recurringRule: { id: 'rule-1' } });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);

    await cancelSubscription('u1', 'sub-1', 'too expensive');

    expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
    expect(subMock.update.mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED', cancelReason: 'too expensive',
    });
    expect(ruleMock.update.mock.calls[0][0].data).toEqual({ isActive: false });
  });

  it('refuses to cancel twice', async () => {
    subMock.findFirst.mockResolvedValue({ ...MOCK_SUB, status: 'CANCELLED' });

    await expect(cancelSubscription('u1', 'sub-1')).rejects.toThrow(/already cancelled/i);
    expect(subMock.update).not.toHaveBeenCalled();
  });

  it('404s for someone else\'s subscription', async () => {
    subMock.findFirst.mockResolvedValue(null);
    await expect(cancelSubscription('u2', 'sub-1')).rejects.toThrow(/not found/i);
  });
});

describe('resumeSubscription', () => {
  it('reactivates forward from the given date, never backfilling', async () => {
    // Resuming must not generate charges for the months it was cancelled.
    subMock.findFirst.mockResolvedValue({
      ...MOCK_SUB, status: 'CANCELLED', recurringRule: { id: 'rule-1' },
    });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);

    await resumeSubscription('u1', 'sub-1', '2026-10-01');

    expect(ruleMock.update.mock.calls[0][0].data).toEqual({
      isActive: true, nextRunDate: new Date('2026-10-01'),
    });
  });

  it('404s a resume on someone else\'s subscription', async () => {
    subMock.findFirst.mockResolvedValue(null);
    await expect(resumeSubscription('u2', 'sub-1', '2026-10-01')).rejects.toThrow(/not found/i);
  });

  it('refuses to resume one that is already active', async () => {
    subMock.findFirst.mockResolvedValue(MOCK_SUB);
    await expect(resumeSubscription('u1', 'sub-1', '2026-10-01')).rejects.toThrow(/already active/i);
  });
});

describe('recordPriceChange', () => {
  beforeEach(() => {
    subMock.findFirst.mockResolvedValue({
      ...MOCK_SUB,
      recurringRule: { id: 'rule-1', templateTransactionId: 'tmpl-1' },
    });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);
  });

  it('appends to history rather than editing the existing row', async () => {
    // Past charges were billed at the old price; the history is what proves it.
    await recordPriceChange('u1', 'sub-1', 799, '2027-01-01');

    const call = priceMock.upsert.mock.calls[0][0];
    expect(call.where.subscriptionId_effectiveFrom).toEqual({
      subscriptionId: 'sub-1', effectiveFrom: new Date('2027-01-01'),
    });
    expect(Number(call.create.amount)).toBe(799);
  });

  it('mirrors the new price onto the rule', async () => {
    await recordPriceChange('u1', 'sub-1', 799, '2027-01-01');

    expect(ruleMock.update.mock.calls[0][0].where).toEqual({ id: 'rule-1' });
    expect(Number(ruleMock.update.mock.calls[0][0].data.amount)).toBe(799);
  });
});

describe('deleteSubscription', () => {
  it('SOFT deletes, so the price history survives', async () => {
    // vision.md forbids new hard deletes on financial records. SubscriptionPrice is the
    // proof of what past charges were billed at; cascading it away would leave the
    // surviving transactions unexplainable.
    subMock.findFirst.mockResolvedValue({
      ...MOCK_SUB, recurringRule: { id: 'rule-1', templateTransactionId: 'tmpl-1' },
    });

    await deleteSubscription('u1', 'sub-1');

    expect(subMock.delete).not.toHaveBeenCalled();
    expect(subMock.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('stops the money, so a deleted subscription cannot keep charging', async () => {
    subMock.findFirst.mockResolvedValue({
      ...MOCK_SUB, recurringRule: { id: 'rule-1', templateTransactionId: 'tmpl-1' },
    });

    await deleteSubscription('u1', 'sub-1');

    expect(ruleMock.update.mock.calls[0][0].data).toEqual({ isActive: false });
    // Nothing else to retire — the rule holds its own spec.
    expect(txnMock.update).not.toHaveBeenCalled();
  });

  it('a soft-deleted subscription is invisible to reads', async () => {
    subMock.findMany.mockResolvedValue([]);
    txnMock.findMany.mockResolvedValue([]);

    await listSubscriptions('u1');

    expect(subMock.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null });
  });

  it('404s for someone else\'s subscription', async () => {
    subMock.findFirst.mockResolvedValue(null);
    await expect(deleteSubscription('u2', 'sub-1')).rejects.toThrow(/not found/i);
    expect(subMock.delete).not.toHaveBeenCalled();
  });
});

describe('derived spend metrics', () => {
  it('reports totals and flags a charge that does not match the recorded price', async () => {
    // The honest use of transaction data: it cannot tell you whether you watched
    // Netflix, but it can tell you the vendor charged more than you have on record.
    subMock.findMany.mockResolvedValue([MOCK_SUB]);
    txnMock.findMany.mockResolvedValue([
      { subscriptionId: 'sub-1', amount: 499, date: new Date('2026-05-01') },
      { subscriptionId: 'sub-1', amount: 649, date: new Date('2026-07-01') },
      { subscriptionId: 'sub-1', amount: 799, date: new Date('2026-08-01') },
    ]);

    const [sub] = await listSubscriptions('u1');

    expect(sub.usage.chargeCount).toBe(3);
    expect(sub.usage.totalPaid).toBe(1947);
    expect(sub.usage.priceMismatch).toMatchObject({ charged: 799, expected: 649 });
  });

  it('reports no mismatch when every charge matches', async () => {
    subMock.findMany.mockResolvedValue([MOCK_SUB]);
    txnMock.findMany.mockResolvedValue([
      { subscriptionId: 'sub-1', amount: 499, date: new Date('2026-05-01') },
      { subscriptionId: 'sub-1', amount: 649, date: new Date('2026-08-01') },
    ]);

    const [sub] = await listSubscriptions('u1');
    expect(sub.usage.priceMismatch).toBeNull();
  });

  it('tolerates a sub-paisa rounding difference', async () => {
    subMock.findMany.mockResolvedValue([MOCK_SUB]);
    txnMock.findMany.mockResolvedValue([
      { subscriptionId: 'sub-1', amount: 649.004, date: new Date('2026-08-01') },
    ]);

    const [sub] = await listSubscriptions('u1');
    expect(sub.usage.priceMismatch).toBeNull();
  });

  it('handles a subscription with no charges yet', async () => {
    subMock.findMany.mockResolvedValue([MOCK_SUB]);
    txnMock.findMany.mockResolvedValue([]);

    const [sub] = await listSubscriptions('u1');
    expect(sub.usage).toMatchObject({ chargeCount: 0, totalPaid: 0, priceMismatch: null });
  });

  it('counts every real charge, with no template to exclude', async () => {
    // The template is scaffolding for the rule, not money that ever moved. Counting it
    // inflated every total by one and — because recordPriceChange mirrors the current
    // price onto a template that keeps its original date — produced a false
    // "charged more than expected" on every subscription that had changed price.
    subMock.findMany.mockResolvedValue([MOCK_SUB]);
    txnMock.findMany.mockResolvedValue([]);

    await listSubscriptions('u1');

    // The old `isRecurring: false` filter was a proxy for "not a template" — and a wrong
    // one, since routes/transactions.ts lets a user set that flag on a real transaction.
    expect(txnMock.findMany.mock.calls[0][0].where.isRecurring).toBeUndefined();
  });

  it('counts every real charge on the single-subscription path too', async () => {
    subMock.findFirst.mockResolvedValue(MOCK_SUB);
    txnMock.findMany.mockResolvedValue([]);

    await getSubscription('u1', 'sub-1');

    // The old `isRecurring: false` filter was a proxy for "not a template" — and a wrong
    // one, since routes/transactions.ts lets a user set that flag on a real transaction.
    expect(txnMock.findMany.mock.calls[0][0].where.isRecurring).toBeUndefined();
  });

  it('does not query charges at all when there are no subscriptions', async () => {
    subMock.findMany.mockResolvedValue([]);

    expect(await listSubscriptions('u1')).toEqual([]);
    expect(txnMock.findMany).not.toHaveBeenCalled();
  });

  it('fetches charges for the whole list in one query, not per subscription', async () => {
    // N+1 guard: the list is unbounded and grows with history.
    subMock.findMany.mockResolvedValue([MOCK_SUB, { ...MOCK_SUB, id: 'sub-2' }]);
    txnMock.findMany.mockResolvedValue([]);

    await listSubscriptions('u1');

    expect(txnMock.findMany).toHaveBeenCalledTimes(1);
    expect(txnMock.findMany.mock.calls[0][0].where.subscriptionId.in).toEqual(['sub-1', 'sub-2']);
  });

  it('exposes current price, annualised cost and next renewal', async () => {
    subMock.findMany.mockResolvedValue([MOCK_SUB]);
    txnMock.findMany.mockResolvedValue([]);

    const [sub] = await listSubscriptions('u1');

    expect(sub.currentPrice).toBe(649);
    expect(sub.annualisedCost).toBe(7788);
    expect(sub.nextRenewalDate).toEqual(new Date('2026-09-01'));
  });
});

describe('getSubscription / audit', () => {
  it('returns null when not visible, so the route can 404', async () => {
    subMock.findFirst.mockResolvedValue(null);
    expect(await getSubscription('u2', 'sub-1')).toBeNull();
  });

  it('decorates a single subscription with its own charges', async () => {
    subMock.findFirst.mockResolvedValue(MOCK_SUB);
    txnMock.findMany.mockResolvedValue([{ amount: 649, date: new Date('2026-08-01') }]);

    const sub = await getSubscription('u1', 'sub-1');
    expect(sub!.usage.chargeCount).toBe(1);
  });

  it('audit snapshot is a plain scoped read', async () => {
    subMock.findFirst.mockResolvedValue(MOCK_SUB);
    expect(await getSubscriptionForAudit('u1', 'sub-1')).toBe(MOCK_SUB);
  });
});

describe('updateSubscription', () => {
  beforeEach(() => {
    subMock.findFirst.mockResolvedValue({ ...MOCK_SUB, recurringRule: { id: 'rule-1' } });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);
    priceMock.findMany.mockResolvedValue([]);
  });

  it('touches the rule only when the schedule actually changed', async () => {
    await updateSubscription('u1', 'sub-1', { name: 'Netflix Premium' });
    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('pushes a frequency change through to the owned rule', async () => {
    await updateSubscription('u1', 'sub-1', { frequency: 'YEARLY' });
    expect(ruleMock.update.mock.calls[0][0].data).toMatchObject({ frequency: 'YEARLY' });
  });

  it('404s for someone else\'s subscription', async () => {
    subMock.findFirst.mockResolvedValue(null);
    await expect(updateSubscription('u2', 'sub-1', { name: 'x' })).rejects.toThrow(/not found/i);
  });

  // ── Editing the start date ──────────────────────────────────────────────────
  // startDate is metadata (never feeds billing — see createSubscription's own comment on
  // the incident this schema separation prevents), but it seeded the OPENING
  // SubscriptionPrice row's effectiveFrom at creation. Left behind on an edit, the two
  // disagree and priceAsOf() returns null for the gap — early charges look unexplained.

  it('VQ1: moves the opening price row\'s effectiveFrom, leaving amount and note untouched', async () => {
    const opening = { id: 'p-1', amount: 499, effectiveFrom: new Date('2025-01-01'), note: 'Launch price' };
    priceMock.findMany.mockResolvedValue([opening]);

    await updateSubscription('u1', 'sub-1', { startDate: '2024-12-15' });

    expect(priceMock.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { effectiveFrom: new Date('2024-12-15') },
    });
    // amount/note are simply absent from the update payload — proving they were never
    // touched, not merely unchanged by coincidence.
    const { data } = priceMock.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('amount');
    expect(data).not.toHaveProperty('note');
  });

  it('also updates Subscription.startDate itself', async () => {
    priceMock.findMany.mockResolvedValue([{ id: 'p-1', amount: 499, effectiveFrom: new Date('2025-01-01') }]);
    await updateSubscription('u1', 'sub-1', { startDate: '2024-12-15' });
    expect(subMock.update.mock.calls[0][0].data).toMatchObject({ startDate: new Date('2024-12-15') });
  });

  it('VQ2: a second, real price row is never moved or overwritten', async () => {
    const opening = { id: 'p-1', amount: 499, effectiveFrom: new Date('2025-01-01') };
    const priceRise = { id: 'p-2', amount: 649, effectiveFrom: new Date('2026-07-01') };
    priceMock.findMany.mockResolvedValue([opening, priceRise]);

    await updateSubscription('u1', 'sub-1', { startDate: '2024-12-15' });

    expect(priceMock.update).toHaveBeenCalledTimes(1);
    expect(priceMock.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { effectiveFrom: new Date('2024-12-15') },
    });
  });

  it('VQ3: refuses a start date on/after the next recorded price change, without touching anything', async () => {
    const opening = { id: 'p-1', amount: 499, effectiveFrom: new Date('2025-01-01') };
    const priceRise = { id: 'p-2', amount: 649, effectiveFrom: new Date('2026-07-01') };
    priceMock.findMany.mockResolvedValue([opening, priceRise]);

    await expect(
      updateSubscription('u1', 'sub-1', { startDate: '2026-07-01' }), // exactly on the boundary
    ).rejects.toThrow(/before the next recorded price change/i);
    expect(priceMock.update).not.toHaveBeenCalled();
    expect(subMock.update).not.toHaveBeenCalled();

    await expect(
      updateSubscription('u1', 'sub-1', { startDate: '2026-08-01' }), // past it
    ).rejects.toThrow(/before the next recorded price change/i);
  });

  it('VQ4: does not touch the recurring rule\'s schedule — the exact incident startDate handling exists to prevent', async () => {
    priceMock.findMany.mockResolvedValue([{ id: 'p-1', amount: 499, effectiveFrom: new Date('2025-01-01') }]);
    await updateSubscription('u1', 'sub-1', { startDate: '2020-01-01' });
    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('VQ6: a subscription with only one price row (the common case) updates cleanly', async () => {
    priceMock.findMany.mockResolvedValue([{ id: 'p-1', amount: 499, effectiveFrom: new Date('2025-01-01') }]);
    await expect(updateSubscription('u1', 'sub-1', { startDate: '2024-06-01' })).resolves.toBeDefined();
    expect(priceMock.update).toHaveBeenCalledTimes(1);
  });

  it('defensive: zero price rows updates startDate alone rather than crashing', async () => {
    priceMock.findMany.mockResolvedValue([]);
    await expect(updateSubscription('u1', 'sub-1', { startDate: '2024-06-01' })).resolves.toBeDefined();
    expect(priceMock.update).not.toHaveBeenCalled();
    expect(subMock.update.mock.calls[0][0].data).toMatchObject({ startDate: new Date('2024-06-01') });
  });

  it('leaves price rows alone entirely when startDate is not part of the update', async () => {
    await updateSubscription('u1', 'sub-1', { name: 'Renamed' });
    expect(priceMock.findMany).not.toHaveBeenCalled();
    expect(priceMock.update).not.toHaveBeenCalled();
  });

  // ── How it is paid ──────────────────────────────────────────────────────────
  // Settable at creation but not changeable, so moving a subscription to a new card
  // meant deleting and re-creating it — losing the price history that makes past
  // charges explainable.

  it('pushes a payment mode change through to the owned rule', async () => {
    await updateSubscription('u1', 'sub-1', { paymentMode: 'NETBANKING' });
    expect(ruleMock.update.mock.calls[0][0].data).toMatchObject({ paymentMode: 'NETBANKING' });
  });

  it('moves a subscription to a different card', async () => {
    await updateSubscription('u1', 'sub-1', { bankAccountId: 'acct-1' });
    expect(ruleMock.update.mock.calls[0][0].data).toMatchObject({ bankAccountId: 'acct-1' });
  });

  it('recategorises without touching the schedule', async () => {
    await updateSubscription('u1', 'sub-1', { categoryId: 'cat-1' });
    const { data } = ruleMock.update.mock.calls[0][0];
    expect(data).toMatchObject({ categoryId: 'cat-1' });
    expect(data.frequency).toBeUndefined();
    expect(data.nextRunDate).toBeUndefined();
  });

  it('clears a payment field on explicit null, but leaves it alone when absent', async () => {
    // `null` means "clear it"; `undefined` means the form did not send the field. Getting
    // this backwards would wipe the card every time someone renamed a subscription.
    await updateSubscription('u1', 'sub-1', { paymentMode: null });
    expect(ruleMock.update.mock.calls[0][0].data).toMatchObject({ paymentMode: null });

    ruleMock.update.mockClear();
    await updateSubscription('u1', 'sub-1', { name: 'Renamed' });
    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('refuses an account belonging to somebody else', async () => {
    // Without the ownership check a requester could point their subscription at another
    // member's account by id and generate charges against it.
    (prisma as any).bankAccount.findFirst.mockResolvedValue(null);
    await expect(
      updateSubscription('u1', 'sub-1', { bankAccountId: 'someone-elses' }),
    ).rejects.toThrow();
    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('refuses a category belonging to somebody else', async () => {
    (prisma as any).category.findFirst.mockResolvedValue(null);
    await expect(
      updateSubscription('u1', 'sub-1', { categoryId: 'someone-elses' }),
    ).rejects.toThrow();
    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('extending a trial moves the first charge with it', async () => {
    // Creation couples trialEndDate and nextRunDate; update did not, so a trial extended
    // to 01/10 still billed on 01/09 while the card said the trial was live.
    subMock.findFirst.mockResolvedValue({
      ...MOCK_SUB, status: 'TRIALING', recurringRule: { id: 'rule-1' },
    });

    await updateSubscription('u1', 'sub-1', { trialEndDate: '2026-10-01' });

    expect(ruleMock.update.mock.calls[0][0].data.nextRunDate).toEqual(new Date('2026-10-01'));
  });

  it('does not move the charge date for a trial change on an ACTIVE subscription', async () => {
    subMock.findFirst.mockResolvedValue({
      ...MOCK_SUB, status: 'ACTIVE', recurringRule: { id: 'rule-1' },
    });

    await updateSubscription('u1', 'sub-1', { trialEndDate: '2026-10-01' });

    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('an explicit nextRunDate wins over the trial-derived one', async () => {
    subMock.findFirst.mockResolvedValue({
      ...MOCK_SUB, status: 'TRIALING', recurringRule: { id: 'rule-1' },
    });

    await updateSubscription('u1', 'sub-1', {
      trialEndDate: '2026-10-01', nextRunDate: '2026-11-15',
    });

    expect(ruleMock.update.mock.calls[0][0].data.nextRunDate).toEqual(new Date('2026-11-15'));
  });

  it('never starts billing in the past, however old the start date', async () => {
    // The worst bug in the feature: the form's only date question is "Start date", so
    // answering it honestly ("Netflix, since 2020") set nextRunDate to 2020 and the
    // unattended hourly scheduler backfilled ~80 real transactions across six financial
    // years, with no warning and no undo.
    subMock.create.mockResolvedValue({ id: 'sub-1' });
    txnMock.create.mockResolvedValue({ id: 'tmpl-1' });
    ruleMock.create.mockResolvedValue({ id: 'rule-1' });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);

    await createSubscription('u1', {
      name: 'Netflix', amount: 649, frequency: 'MONTHLY', startDate: '2020-01-01',
    } as never);

    const firstRun: Date = ruleMock.create.mock.calls[0][0].data.nextRunDate;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    expect(firstRun.getTime()).toBeGreaterThanOrEqual(startOfToday.getTime());

    // startDate is still recorded — it is metadata, it just does not drive billing.
    expect(subMock.create.mock.calls[0][0].data.startDate).toEqual(new Date('2020-01-01'));
  });

  it('creates no template transaction at all', async () => {
    // Left at the schema default, soft-deleting the template would CREDIT the account
    // for an impact that was never applied.
    subMock.create.mockResolvedValue({ id: 'sub-1' });
    txnMock.create.mockResolvedValue({ id: 'tmpl-1' });
    ruleMock.create.mockResolvedValue({ id: 'rule-1' });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);

    await createSubscription('u1', {
      name: 'X', amount: 100, frequency: 'MONTHLY', startDate: '2025-01-01',
    } as never);

    expect(txnMock.create).not.toHaveBeenCalled();
  });

  it('clears the trial end date when explicitly set to null', async () => {
    await updateSubscription('u1', 'sub-1', { trialEndDate: null });
    expect(subMock.update.mock.calls[0][0].data.trialEndDate).toBeNull();
  });

  it('sets a trial end date when given one', async () => {
    await updateSubscription('u1', 'sub-1', { trialEndDate: '2026-12-01' });
    expect(subMock.update.mock.calls[0][0].data.trialEndDate).toEqual(new Date('2026-12-01'));
  });

  it('updates every descriptive field in one go', async () => {
    await updateSubscription('u1', 'sub-1', {
      name: 'N', vendor: 'V', cancellationUrl: 'https://x', notes: 'hello',
    });
    expect(subMock.update.mock.calls[0][0].data).toMatchObject({
      name: 'N', vendor: 'V', cancellationUrl: 'https://x', notes: 'hello',
    });
  });

  it('skips the rule update when the subscription has no rule', async () => {
    subMock.findFirst.mockResolvedValue({ ...MOCK_SUB, recurringRule: null });
    await updateSubscription('u1', 'sub-1', { frequency: 'YEARLY' });
    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('ignores a null nextRunDate rather than writing an invalid date', async () => {
    await updateSubscription('u1', 'sub-1', { nextRunDate: null });
    // The rule branch still runs (the schedule key was present) but must not set a date.
    expect(ruleMock.update.mock.calls[0][0].data.nextRunDate).toBeUndefined();
  });

  it('moves the next run date when given one', async () => {
    await updateSubscription('u1', 'sub-1', { nextRunDate: '2026-11-01' });
    expect(ruleMock.update.mock.calls[0][0].data.nextRunDate).toEqual(new Date('2026-11-01'));
  });
});

describe('subscriptions without an owned rule', () => {
  it('cancel still records the status when the rule is missing', async () => {
    subMock.findFirst.mockResolvedValue({ ...MOCK_SUB, recurringRule: null });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);

    await cancelSubscription('u1', 'sub-1');

    expect(subMock.update.mock.calls[0][0].data.status).toBe('CANCELLED');
    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('resume still records the status when the rule is missing', async () => {
    subMock.findFirst.mockResolvedValue({ ...MOCK_SUB, status: 'PAUSED', recurringRule: null });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);

    await resumeSubscription('u1', 'sub-1', '2026-10-01');

    expect(subMock.update.mock.calls[0][0].data.status).toBe('ACTIVE');
    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('price change skips the template mirror when there is no rule', async () => {
    subMock.findFirst.mockResolvedValue({ ...MOCK_SUB, recurringRule: null });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);

    await recordPriceChange('u1', 'sub-1', 799, '2027-01-01');

    expect(priceMock.upsert).toHaveBeenCalled();
    expect(txnMock.update).not.toHaveBeenCalled();
  });

  it('delete works when there is no rule to clean up', async () => {
    subMock.findFirst.mockResolvedValue({ ...MOCK_SUB, recurringRule: null });

    await deleteSubscription('u1', 'sub-1');

    expect(subMock.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    expect(txnMock.update).not.toHaveBeenCalled();
  });

  it('ignores a charge from before any price existed when checking for mismatches', async () => {
    // priceAsOf returns null there, and a charge we cannot price cannot be judged.
    subMock.findMany.mockResolvedValue([MOCK_SUB]);
    txnMock.findMany.mockResolvedValue([
      { subscriptionId: 'sub-1', amount: 999, date: new Date('2020-01-01') },
    ]);

    const [sub] = await listSubscriptions('u1');
    expect(sub.usage.priceMismatch).toBeNull();
    expect(sub.usage.chargeCount).toBe(1);
  });

  it('skips a charge row with no subscriptionId when grouping', async () => {
    subMock.findMany.mockResolvedValue([MOCK_SUB]);
    txnMock.findMany.mockResolvedValue([
      { subscriptionId: null, amount: 100, date: new Date('2026-08-01') },
      { subscriptionId: 'sub-1', amount: 649, date: new Date('2026-08-01') },
    ]);

    const [sub] = await listSubscriptions('u1');
    expect(sub.usage.chargeCount).toBe(1);
  });

  it('lists family-wide when no user is given', async () => {
    subMock.findMany.mockResolvedValue([MOCK_SUB]);
    txnMock.findMany.mockResolvedValue([]);

    await listSubscriptions();

    expect(subMock.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it('404s an audit snapshot fetch that is not visible', async () => {
    subMock.findFirst.mockResolvedValue(null);
    expect(await getSubscriptionForAudit('u2', 'sub-1')).toBeNull();
  });

  it('404s a delete on someone else\'s subscription', async () => {
    subMock.findFirst.mockResolvedValue(null);
    await expect(recordPriceChange('u2', 'sub-1', 1, '2027-01-01')).rejects.toThrow(/not found/i);
  });

  it('refuses a category belonging to someone else', async () => {
    (prisma as any).category.findFirst.mockResolvedValue(null);

    await expect(createSubscription('u1', {
      name: 'X', amount: 100, frequency: 'MONTHLY',
      startDate: '2025-01-01', categoryId: 'cat-of-u2',
    } as never)).rejects.toThrow(/category/i);
  });

  it('honours an explicit nextRunDate at creation', async () => {
    subMock.create.mockResolvedValue({ id: 'sub-1' });
    txnMock.create.mockResolvedValue({ id: 'tmpl-1' });
    ruleMock.create.mockResolvedValue({ id: 'rule-1' });
    subMock.findFirstOrThrow.mockResolvedValue(MOCK_SUB);

    await createSubscription('u1', {
      name: 'X', amount: 100, frequency: 'MONTHLY',
      startDate: '2025-01-01', nextRunDate: '2025-02-01',
    } as never);

    expect(ruleMock.create.mock.calls[0][0].data.nextRunDate).toEqual(new Date('2025-02-01'));
  });
});
