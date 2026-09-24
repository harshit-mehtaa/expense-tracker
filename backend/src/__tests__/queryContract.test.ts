/**
 * The single-value query contract: every req.query value a route reads is one plain
 * string. Repeated keys (?a=1&a=2), bracket syntax (?a[b]=1, ?a[]=1) and NUL bytes are
 * rejected with 400 before any route code runs, so `req.query.x as string` is true.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rejectAmbiguousQuery, useSimpleQueryParser } from '../middleware/queryContract';
import { errorHandler } from '../middleware/errorHandler';

function makeQueryApp() {
  const app = express();
  useSimpleQueryParser(app);
  app.use(rejectAmbiguousQuery);
  app.get('/echo', (req, res) => { res.json({ query: req.query }); });
  app.use(errorHandler);
  return app;
}

describe('rejectAmbiguousQuery', () => {
  it('passes single string values through untouched', async () => {
    const res = await request(makeQueryApp()).get('/echo?fy=2025-26&type=EXPENSE,INCOME&search=');
    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({ fy: '2025-26', type: 'EXPENSE,INCOME', search: '' });
  });

  it('passes a request with no query string', async () => {
    const res = await request(makeQueryApp()).get('/echo');
    expect(res.status).toBe(200);
  });

  it('rejects a repeated key with 400 INVALID_QUERY naming the key', async () => {
    const res = await request(makeQueryApp()).get('/echo?fy=2025-26&fy=2024-25');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Query parameter "fy" must appear only once',
      code: 'INVALID_QUERY',
    });
  });

  it.each([
    ['type[]=EXPENSE', 'type[]'],
    ['search[a]=1', 'search[a]'],
    ['fy[x]=1', 'fy[x]'],
  ])('rejects bracket syntax ?%s', async (qs, key) => {
    const res = await request(makeQueryApp()).get(`/echo?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_QUERY');
    expect(res.body.message).toBe(`Query parameter "${key}" uses unsupported bracket syntax`);
  });

  it('rejects a NUL byte in a value (Postgres rejects 0x00 in text)', async () => {
    const res = await request(makeQueryApp()).get('/echo?search=%00');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Query parameter "search" contains an invalid character');
  });

  it('truncates a very long key in the message', async () => {
    const key = 'k'.repeat(500);
    const res = await request(makeQueryApp()).get(`/echo?${key}=1&${key}=2`);
    expect(res.status).toBe(400);
    expect(res.body.message.length).toBeLessThan(120);
    expect(res.body.message).toContain('…');
  });

  it('rejects a NUL byte in a key', async () => {
    const res = await request(makeQueryApp()).get('/echo?a%00=1');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_QUERY');
  });
});

describe('useSimpleQueryParser', () => {
  it('throws if the router already exists — a late app.set would silently do nothing', () => {
    const app = express();
    app.use((_req, _res, next) => next());
    expect(() => useSimpleQueryParser(app)).toThrow(/before the first app\.use/);
  });
});
