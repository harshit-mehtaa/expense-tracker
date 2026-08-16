import '@testing-library/jest-dom';
import { server } from './mswServer';
import { setAccessToken } from '@/lib/api';
// VITE_API_URL is set via vite.config.ts test.env so it's available at module
// transform time — more reliable than Object.defineProperty on import.meta.env.

// ── jsdom gaps ────────────────────────────────────────────────────────────────
// jsdom implements none of these, and they are not optional niceties: Header.tsx
// calls window.matchMedia(...).matches inside a useState initializer, so it runs on
// the FIRST render of every page that mounts the shell. Without these, a page mount
// throws TypeError before any assertion can run.
// Guarded on `typeof window`: this file is the shared setup for EVERY test, including
// any that opts into `// @vitest-environment node` to exercise an SSR branch. A bare
// `window` dereference here throws ReferenceError before such a file can even start.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},      // deprecated, still called by some libs
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  // recharts' ResponsiveContainer observes its parent. Returning no measurements is
  // fine — charts render at 0x0 under jsdom either way — but the constructor must exist.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element !== 'undefined' && !Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof URL !== 'undefined' && !URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock';
}
if (typeof URL !== 'undefined' && !URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {};
}

// Header.tsx:17 and Login.tsx:32 read 'theme' from localStorage during render, so it has
// to work or those components throw on mount.
//
// Not a jsdom gap — pristine jsdom round-trips fine. On Node >= 25 the runtime's OWN
// built-in localStorage shadows jsdom's and is a stub missing setItem/removeItem/clear,
// so calling it throws ("--localstorage-file was provided without a valid path"). That
// is version-specific: it does not appear on Node 20, which is what CI runs. Installing
// a real in-memory store makes behaviour identical across both.
// A factory, not one object spread twice: spreading would share the backing Map between
// local and session storage AND freeze `length` to its value at spread time, because the
// getter is evaluated during the spread rather than copied.
function makeMemoryStorage() {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    },
  };
}

if (typeof window !== 'undefined') {
  const local = makeMemoryStorage();
  const session = makeMemoryStorage();
  // configurable so a test can still vi.stubGlobal() over these if it needs to.
  Object.defineProperty(window, 'localStorage', { value: local.api, writable: true, configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: session.api, writable: true, configurable: true });
  afterEach(() => { local.store.clear(); session.store.clear(); });
}

// ── MSW ───────────────────────────────────────────────────────────────────────
// 'error', not 'warn'. With 'warn', a page test that forgets a handler gets a rejected
// query and renders its empty state — which on most pages is indistinguishable from
// success — so the test passes green while asserting nothing. 'error' is what makes
// every page test mean something.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  // lib/api.ts keeps the access token in module-level state; without this it leaks
  // into the next test file and a later test can pass for the wrong reason.
  setAccessToken(null);
});
afterAll(() => server.close());
