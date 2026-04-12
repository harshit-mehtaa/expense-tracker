import { describe, it, expect, vi } from 'vitest';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { buildPaginationArgs, processPaginationResult } from '../utils/pagination';
import { sendSuccess, sendPaginated, sendCreated, sendNoContent } from '../utils/response';

// ─────────────────────────────────────────────────────────────────────────────
// AppError
// ─────────────────────────────────────────────────────────────────────────────

describe('AppError', () => {
  it('is an instance of both Error and AppError', () => {
    const err = new AppError('test', 400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('sets message, statusCode, and code from constructor', () => {
    const err = new AppError('something went wrong', 422, 'MY_CODE');
    expect(err.message).toBe('something went wrong');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('MY_CODE');
  });

  it('isOperational is true for 4xx codes', () => {
    expect(new AppError('', 400).isOperational).toBe(true);
    expect(new AppError('', 401).isOperational).toBe(true);
    expect(new AppError('', 404).isOperational).toBe(true);
    expect(new AppError('', 422).isOperational).toBe(true);
    expect(new AppError('', 499).isOperational).toBe(true);
  });

  it('isOperational is false for 5xx codes', () => {
    expect(new AppError('', 500).isOperational).toBe(false);
    expect(new AppError('', 503).isOperational).toBe(false);
  });

  describe('static factories', () => {
    it('badRequest returns 400', () => {
      const err = AppError.badRequest('bad input', 'BAD_FIELD');
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('bad input');
      expect(err.code).toBe('BAD_FIELD');
    });

    it('unauthorized returns 401 with default message', () => {
      const err = AppError.unauthorized();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.message).toBe('Unauthorized');
    });

    it('unauthorized accepts custom message', () => {
      const err = AppError.unauthorized('Access token expired');
      expect(err.message).toBe('Access token expired');
    });

    it('forbidden returns 403', () => {
      const err = AppError.forbidden();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    });

    it('notFound returns 404 with resource name in message', () => {
      const err = AppError.notFound('Transaction');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Transaction not found');
      expect(err.code).toBe('NOT_FOUND');
    });

    it('conflict returns 409', () => {
      const err = AppError.conflict('Duplicate entry', 'DUPLICATE');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('DUPLICATE');
    });

    it('validationError returns 422', () => {
      const err = AppError.validationError('Schema invalid');
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('internal returns 500 with default message', () => {
      const err = AppError.internal();
      expect(err.statusCode).toBe(500);
      expect(err.isOperational).toBe(false);
      expect(err.message).toBe('Internal server error');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// asyncHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('asyncHandler', () => {
  const mockReq = {} as any;
  const mockRes = {} as any;

  it('calls next() with error when the handler rejects', async () => {
    const error = new Error('boom');
    const handler = asyncHandler(async () => { throw error; });
    const next = vi.fn();
    handler(mockReq, mockRes, next);
    // asyncHandler is async under the hood — wait a tick
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(next).toHaveBeenCalledWith(error);
  });

  it('does NOT call next(error) when the handler resolves successfully', async () => {
    const handler = asyncHandler(async (_req, res: any) => { res.sent = true; });
    const next = vi.fn();
    const res = { sent: false } as any;
    handler(mockReq, res, next);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(next).not.toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildPaginationArgs
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPaginationArgs', () => {
  it('defaults to limit 20, date:desc sort', () => {
    const args = buildPaginationArgs({});
    expect(args.take).toBe(21); // limit+1
    expect(args.orderBy[0]).toEqual({ date: 'desc' });
    expect(args.orderBy[1]).toEqual({ id: 'desc' });
    expect(args.cursor).toBeUndefined();
    expect(args.skip).toBeUndefined();
  });

  it('respects explicit limit', () => {
    const args = buildPaginationArgs({ limit: 50 });
    expect(args.take).toBe(51);
  });

  it('clamps limit to MAX_LIMIT (100)', () => {
    const args = buildPaginationArgs({ limit: 200 });
    expect(args.take).toBe(101); // capped at 100, +1 for hasMore
  });

  it('parses sort field and direction', () => {
    const args = buildPaginationArgs({ sort: 'amount:asc' });
    expect(args.orderBy[0]).toEqual({ amount: 'asc' });
    expect(args.orderBy[1]).toEqual({ id: 'desc' }); // stable secondary sort
  });

  it('sets cursor and skip when cursor is provided', () => {
    const args = buildPaginationArgs({ cursor: 'abc123', limit: 10 });
    expect(args.cursor).toEqual({ id: 'abc123' });
    expect(args.skip).toBe(1);
  });

  it('does not set cursor or skip when no cursor', () => {
    const args = buildPaginationArgs({ limit: 10 });
    expect(args.cursor).toBeUndefined();
    expect(args.skip).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processPaginationResult
// ─────────────────────────────────────────────────────────────────────────────

describe('processPaginationResult', () => {
  const makeItems = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `id-${i + 1}`, name: `item-${i + 1}` }));

  it('returns hasMore=false when items.length <= limit', () => {
    const items = makeItems(5);
    const { items: result, meta } = processPaginationResult(items, 10, 5);
    expect(result).toHaveLength(5);
    expect(meta.hasMore).toBe(false);
    expect(meta.nextCursor).toBeUndefined();
  });

  it('returns hasMore=true and trims to limit when items.length > limit', () => {
    const items = makeItems(11); // limit+1
    const { items: result, meta } = processPaginationResult(items, 10, 100);
    expect(result).toHaveLength(10);
    expect(meta.hasMore).toBe(true);
    expect(meta.nextCursor).toBe('id-10'); // last trimmed item's id
  });

  it('exposes total and limit in meta', () => {
    const { meta } = processPaginationResult(makeItems(5), 20, 42);
    expect(meta.total).toBe(42);
    expect(meta.limit).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('response helpers', () => {
  const makeRes = () => {
    const res = {
      _status: 0,
      _body: null as any,
      _ended: false,
      status(code: number) { this._status = code; return this; },
      json(body: any) { this._body = body; return this; },
      send() { this._ended = true; return this; },
    };
    return res;
  };

  it('sendSuccess sends 200 with success envelope', () => {
    const res = makeRes();
    sendSuccess(res as any, { id: '1' }, 'Done');
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true, data: { id: '1' }, message: 'Done' });
  });

  it('sendSuccess accepts custom status code', () => {
    const res = makeRes();
    sendSuccess(res as any, {}, undefined, 202);
    expect(res._status).toBe(202);
  });

  it('sendCreated sends 201', () => {
    const res = makeRes();
    sendCreated(res as any, { id: '2' }, 'Created');
    expect(res._status).toBe(201);
    expect(res._body.success).toBe(true);
  });

  it('sendNoContent sends 204 with no body', () => {
    const res = makeRes();
    sendNoContent(res as any);
    expect(res._status).toBe(204);
    expect(res._ended).toBe(true);
  });

  it('sendPaginated includes pagination envelope', () => {
    const res = makeRes();
    const meta = { total: 100, limit: 10, hasMore: true, nextCursor: 'abc' };
    sendPaginated(res as any, [{ id: '1' }], meta);
    expect(res._status).toBe(200);
    expect(res._body.pagination).toEqual(meta);
    expect(res._body.data).toHaveLength(1);
  });
});
