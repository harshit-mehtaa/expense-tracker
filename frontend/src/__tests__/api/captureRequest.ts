import { http, HttpResponse, type HttpHandler } from 'msw';
import { server } from '../mswServer';

const API = 'http://localhost:3000';

export const url = (path: string) => `${API}${path}`;

export type Captured = {
  /** Full request URL including query string. */
  url: string;
  /** Parsed query params, for exact key/value assertions. */
  params: URLSearchParams;
  /** Parsed JSON body, when the request had one. */
  body: unknown;
  method: string;
};

/**
 * Register a handler that records the actual outgoing request, then responds.
 *
 * The whole point of the api-layer tests: these modules are thin wrappers, so the risk
 * is not logic but URL and query-param construction. Asserting only the resolved value
 * would pass even if the request asked for the WRONG USER'S data — which is precisely
 * the family-data-leak shape worth guarding against. So every test asserts what went
 * out on the wire, not just what came back.
 */
export function capture(
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  response: unknown = { data: {} },
): { seen: Captured | undefined } & { handler: HttpHandler } {
  const box: { seen: Captured | undefined } = { seen: undefined };

  const handler = http[method](url(path), async ({ request }) => {
    let body: unknown;
    try {
      const text = await request.clone().text();
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    const parsed = new URL(request.url);
    box.seen = {
      url: request.url,
      params: parsed.searchParams,
      body,
      method: request.method,
    };
    return HttpResponse.json(response as Record<string, unknown>);
  });

  server.use(handler);
  return Object.assign(box, { handler });
}
