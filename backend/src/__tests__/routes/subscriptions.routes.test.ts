/**
 * Route integration tests for /api/subscriptions.
 *
 * These assert on what the SERVICE RECEIVES, because that is the boundary where the
 * loans feature's two HTTP 500s lived: a cleared form field arrives as `""`, and zod's
 * `.optional()` only skips `undefined`, so `""` reached Prisma as an Invalid Date and as
 * a foreign key matching no row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { AppError } from '../../utils/AppError';

const MEMBER_USER = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' as const };

const ADMIN_USER = { userId: 'admin-1', email: 'admin@b.com', role: 'ADMIN' as const };

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? MEMBER_USER;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/subscriptionService', () => ({
  listSubscriptions: vi.fn(),
  getSubscription: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  recordPriceChange: vi.fn(),
  cancelSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
  getSubscriptionForAudit: vi.fn(),
}));

vi.mock('../../services/auditService', () => ({ recordAuditLog: vi.fn() }));

vi.mock('../../config/prisma', () => {
  const prisma = { user: { findFirst: vi.fn() } };
  return { default: prisma, prisma };
});

import subscriptionsRouter from '../../routes/subscriptions';
import * as svc from '../../services/subscriptionService';
import { makeApp } from '../helpers/makeApp';
import express from 'express';
import { errorHandler } from '../../middleware/errorHandler';
import { prisma } from '../../config/prisma';

const app = makeApp(subscriptionsRouter, '/api/subscriptions');

/** App with an ADMIN injected, for the family-wide read path. */
function makeAdminApp() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res: any, next: any) => { req.__testUser = ADMIN_USER; next(); });
  a.use('/api/subscriptions', subscriptionsRouter);
  a.use(errorHandler);
  return a;
}

const createMock = svc.createSubscription as ReturnType<typeof vi.fn>;
const updateMock = svc.updateSubscription as ReturnType<typeof vi.fn>;
const listMock = svc.listSubscriptions as ReturnType<typeof vi.fn>;
const getMock = svc.getSubscription as ReturnType<typeof vi.fn>;
const priceMock = svc.recordPriceChange as ReturnType<typeof vi.fn>;
const cancelMock = svc.cancelSubscription as ReturnType<typeof vi.fn>;
const resumeMock = svc.resumeSubscription as ReturnType<typeof vi.fn>;
const deleteMock = svc.deleteSubscription as ReturnType<typeof vi.fn>;
const auditMock = svc.getSubscriptionForAudit as ReturnType<typeof vi.fn>;

const SUB = { id: 'sub-1', name: 'Netflix' };
const VALID_BODY = {
  name: 'Netflix',
  amount: 499,
  frequency: 'MONTHLY',
  startDate: '2025-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  createMock.mockResolvedValue(SUB);
  updateMock.mockResolvedValue(SUB);
  listMock.mockResolvedValue([SUB]);
  getMock.mockResolvedValue(SUB);
  priceMock.mockResolvedValue(SUB);
  cancelMock.mockResolvedValue(SUB);
  resumeMock.mockResolvedValue(SUB);
  deleteMock.mockResolvedValue(undefined);
  auditMock.mockResolvedValue(SUB);
});

describe('GET /api/subscriptions', () => {
  it('returns the list in the standard envelope', async () => {
    const res = await request(app).get('/api/subscriptions');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([SUB]);
  });

  it('404s a subscription that is not visible', async () => {
    getMock.mockResolvedValue(null);
    const res = await request(app).get('/api/subscriptions/sub-1');
    expect(res.status).toBe(404);
    // The central errorHandler formats it — never a hand-built shape.
    expect(res.body.success).toBe(false);
  });

  it('returns a single subscription', async () => {
    const res = await request(app).get('/api/subscriptions/sub-1');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(SUB);
  });
});

describe('POST /api/subscriptions', () => {
  it('creates and returns 201', async () => {
    const res = await request(app).post('/api/subscriptions').send(VALID_BODY);
    expect(res.status).toBe(201);
  });

  it('rejects a non-positive amount', async () => {
    const res = await request(app).post('/api/subscriptions').send({ ...VALID_BODY, amount: 0 });
    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown frequency', async () => {
    const res = await request(app).post('/api/subscriptions').send({ ...VALID_BODY, frequency: 'FORTNIGHTLY' });
    expect(res.status).toBe(422);
  });

  it('rejects a malformed start date', async () => {
    const res = await request(app).post('/api/subscriptions').send({ ...VALID_BODY, startDate: 'nonsense' });
    expect(res.status).toBe(422);
  });
});

/**
 * The regression class that made every pre-existing loan uneditable.
 */
describe('empty-string form fields are normalized at the API boundary', () => {
  it('turns an empty trialEndDate into null, not an Invalid Date', async () => {
    const res = await request(app).post('/api/subscriptions').send({ ...VALID_BODY, trialEndDate: '' });

    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][1].trialEndDate).toBeNull();
  });

  it('turns an empty bankAccountId into null so the FK is not violated', async () => {
    const res = await request(app).post('/api/subscriptions').send({ ...VALID_BODY, bankAccountId: '' });

    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][1].bankAccountId).toBeNull();
  });

  it('turns empty optional text into null', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .send({ ...VALID_BODY, vendor: '', cancellationUrl: '', notes: '' });

    expect(res.status).toBe(201);
    const received = createMock.mock.calls[0][1];
    expect(received.vendor).toBeNull();
    expect(received.cancellationUrl).toBeNull();
    expect(received.notes).toBeNull();
  });

  it('still rejects a genuinely malformed date', async () => {
    const res = await request(app).post('/api/subscriptions').send({ ...VALID_BODY, trialEndDate: 'not-a-date' });
    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('lets a subscription\'s start date be edited', async () => {
    const res = await request(app).put('/api/subscriptions/sub-1').send({ startDate: '2024-06-01' });

    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][2]).toMatchObject({ startDate: '2024-06-01' });
  });

  it('422s an unparseable start date rather than reaching the service', async () => {
    const res = await request(app).put('/api/subscriptions/sub-1').send({ startDate: 'nonsense' });
    expect(res.status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('leaves startDate undefined (absent) when the PUT does not mention it', async () => {
    await request(app).put('/api/subscriptions/sub-1').send({ name: 'Renamed' });
    expect(updateMock.mock.calls[0][2].startDate).toBeUndefined();
  });

  it('propagates the service\'s "before the next price change" rejection', async () => {
    updateMock.mockRejectedValue(AppError.badRequest('Start date must be before the next recorded price change on 2026-07-01'));
    const res = await request(app).put('/api/subscriptions/sub-1').send({ startDate: '2026-08-01' });
    expect(res.status).toBe(400);
  });

    it('a partial PUT leaves omitted fields ALONE rather than nulling them', async () => {
    // The mirror image of the empty-string bug: chaining .transform() after .optional()
    // ran the transform on an ABSENT key too, so PUT {name} arrived as an explicit null
    // for vendor/notes/cancellationUrl/trialEndDate and wiped all four. The field it
    // silently cleared — trialEndDate — is the one the trial-ending alert depends on,
    // so the user would then be charged with no warning.
    const res = await request(app).put('/api/subscriptions/sub-1').send({ name: 'Netflix Premium' });

    expect(res.status).toBe(200);
    const received = updateMock.mock.calls[0][2];
    expect(received.vendor).toBeUndefined();
    expect(received.notes).toBeUndefined();
    expect(received.cancellationUrl).toBeUndefined();
    expect(received.trialEndDate).toBeUndefined();
    expect(received.name).toBe('Netflix Premium');
  });

  it('rejects a cancellation link that is not http(s)', async () => {
    // Rendered as an href. React only WARNS on javascript: in dev, and an admin viewing
    // the family-wide list would execute it in their own session.
    const res = await request(app)
      .post('/api/subscriptions')
      .send({ ...VALID_BODY, cancellationUrl: 'javascript:fetch("/api/admin/users")' });

    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects an http(s)-prefixed string that is not a parseable URL', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .send({ ...VALID_BODY, cancellationUrl: 'https://' });

    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('accepts a normal https cancellation link', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .send({ ...VALID_BODY, cancellationUrl: 'https://netflix.com/cancelplan' });

    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][1].cancellationUrl).toBe('https://netflix.com/cancelplan');
  });

  it('rejects a bogus paymentMode with 422, not a 500 from Prisma', async () => {
    const res = await request(app).post('/api/subscriptions').send({ ...VALID_BODY, paymentMode: 'bogus' });

    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses to resume into the past, which would backfill the cancelled period', async () => {
    const res = await request(app)
      .post('/api/subscriptions/sub-1/resume')
      .send({ nextRunDate: '2020-01-01' });

    expect(res.status).toBe(422);
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it('updates a subscription whose optional fields are all empty', async () => {
    const res = await request(app)
      .put('/api/subscriptions/sub-1')
      .send({ name: 'Netflix Premium', trialEndDate: '', cancellationUrl: '' });

    expect(res.status).toBe(200);
    const received = updateMock.mock.calls[0][2];
    expect(received.trialEndDate).toBeNull();
    expect(received.cancellationUrl).toBeNull();
  });
});

describe('POST /api/subscriptions/:id/price', () => {
  it('records a price change', async () => {
    const res = await request(app)
      .post('/api/subscriptions/sub-1/price')
      .send({ amount: 649, effectiveFrom: '2026-07-01' });

    expect(res.status).toBe(200);
    // An ABSENT note stays undefined — only '' or an explicit null mean "clear it".
    // Coercing absent to null is what made partial updates destructive.
    expect(priceMock).toHaveBeenCalledWith('u1', 'sub-1', 649, '2026-07-01', undefined, 'MEMBER');
  });

  it('rejects a non-positive price', async () => {
    const res = await request(app)
      .post('/api/subscriptions/sub-1/price')
      .send({ amount: -1, effectiveFrom: '2026-07-01' });

    expect(res.status).toBe(422);
    expect(priceMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed effectiveFrom', async () => {
    const res = await request(app)
      .post('/api/subscriptions/sub-1/price')
      .send({ amount: 649, effectiveFrom: 'whenever' });

    expect(res.status).toBe(422);
  });
});

describe('cancel / resume / delete', () => {
  it('cancels with a reason', async () => {
    const res = await request(app).post('/api/subscriptions/sub-1/cancel').send({ reason: 'too pricey' });
    expect(res.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith('u1', 'sub-1', 'too pricey', 'MEMBER');
  });

  it('cancels without a body', async () => {
    const res = await request(app).post('/api/subscriptions/sub-1/cancel').send({});
    expect(res.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith('u1', 'sub-1', undefined, 'MEMBER');
  });

  it('resumes from a given date', async () => {
    const res = await request(app)
      .post('/api/subscriptions/sub-1/resume')
      .send({ nextRunDate: '2026-10-01' });

    expect(res.status).toBe(200);
    expect(resumeMock).toHaveBeenCalledWith('u1', 'sub-1', '2026-10-01', 'MEMBER');
  });

  it('refuses to resume without a date', async () => {
    const res = await request(app).post('/api/subscriptions/sub-1/resume').send({});
    expect(res.status).toBe(422);
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it('deletes and returns 204', async () => {
    const res = await request(app).delete('/api/subscriptions/sub-1');
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith('u1', 'sub-1', 'MEMBER');
  });
});

describe('admin scoping and explicit nulls', () => {
  it('an ADMIN can scope the list to a member', async () => {
    // resolveTargetUserId validates CUID shape before hitting the database.
    const TARGET = 'cmolbmzqo000181ftnpwotv1q';
    ((prisma as any).user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: TARGET });

    const res = await request(makeAdminApp()).get(`/api/subscriptions?targetUserId=${TARGET}`);

    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(TARGET);
  });

  it('a MEMBER is always scoped to themselves, whatever they ask for', async () => {
    const res = await request(app).get('/api/subscriptions?targetUserId=someone-else');

    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith('u1');
  });

  it('accepts explicit nulls as well as empty strings', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .send({ ...VALID_BODY, vendor: null, trialEndDate: null, bankAccountId: null });

    expect(res.status).toBe(201);
    const received = createMock.mock.calls[0][1];
    expect(received.vendor).toBeNull();
    expect(received.trialEndDate).toBeNull();
    expect(received.bankAccountId).toBeNull();
  });

  it('cancels with no body at all', async () => {
    const res = await request(app).post('/api/subscriptions/sub-1/cancel');

    expect(res.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith('u1', 'sub-1', undefined, 'MEMBER');
  });

  it('passes a real bankAccountId through untouched', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .send({ ...VALID_BODY, bankAccountId: 'acct-1', categoryId: 'cat-1' });

    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][1].bankAccountId).toBe('acct-1');
    expect(createMock.mock.calls[0][1].categoryId).toBe('cat-1');
  });

  it('accepts an explicit null cancel reason', async () => {
    const res = await request(app).post('/api/subscriptions/sub-1/cancel').send({ reason: null });
    expect(res.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith('u1', 'sub-1', null, 'MEMBER');
  });

  it('records a price change with an explicitly null note', async () => {
    const res = await request(app)
      .post('/api/subscriptions/sub-1/price')
      .send({ amount: 649, effectiveFrom: '2026-07-01', note: null });
    expect(res.status).toBe(200);
    expect(priceMock).toHaveBeenCalledWith('u1', 'sub-1', 649, '2026-07-01', null, 'MEMBER');
  });

  it('records a price change with a note', async () => {
    const res = await request(app)
      .post('/api/subscriptions/sub-1/price')
      .send({ amount: 649, effectiveFrom: '2026-07-01', note: 'annual rise' });

    expect(res.status).toBe(200);
    expect(priceMock).toHaveBeenCalledWith('u1', 'sub-1', 649, '2026-07-01', 'annual rise', 'MEMBER');
  });
});
