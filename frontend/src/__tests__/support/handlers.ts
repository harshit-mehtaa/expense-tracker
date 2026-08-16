import { http, HttpResponse } from 'msw';
import { ADMIN_USER, MEMBERS, CATEGORIES, ACCOUNTS, type TestUser } from './fixtures';

const API = 'http://localhost:3000';

/** Match any path under the API base, ignoring query string. */
export const url = (path: string) => `${API}${path}`;

/**
 * Cross-cutting handlers every page needs: the two-request session restore that
 * AuthProvider fires on mount, plus the member selector / categories / accounts that
 * most pages pull in via shared hooks.
 *
 * Kept DELIBERATELY NARROW. With onUnhandledRequest:'error', anything not listed here
 * must be declared by the individual page test — which is the point: a forgotten
 * page endpoint fails loudly instead of silently rendering an empty state.
 *
 * A function, not a const array: each call builds fresh handlers so a test that
 * overrides one cannot mutate shared state for the next.
 */
export function baseHandlers(user: TestUser = ADMIN_USER) {
  return [
    http.post(url('/auth/refresh'), () =>
      HttpResponse.json({ data: { accessToken: 'test-token' } })),
    http.get(url('/auth/me'), () => HttpResponse.json({ data: user })),
    http.get(url('/admin/users'), () => HttpResponse.json({ data: MEMBERS })),
    http.get(url('/categories'), () => HttpResponse.json({ data: CATEGORIES })),
    http.get(url('/accounts'), () => HttpResponse.json({ data: ACCOUNTS })),
  ];
}

/** Session restore fails — AuthProvider settles with a null user. */
export function anonHandlers() {
  return [
    http.post(url('/auth/refresh'), () => new HttpResponse(null, { status: 401 })),
    http.get(url('/auth/me'), () => new HttpResponse(null, { status: 401 })),
  ];
}

/** Make every listed path return 500, for the sad-path leg of the smoke bar. */
export function failAll(paths: string[]) {
  return paths.map((p) =>
    http.get(url(p), () => HttpResponse.json({ message: 'Server exploded' }, { status: 500 })));
}
