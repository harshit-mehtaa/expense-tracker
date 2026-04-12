import '@testing-library/jest-dom';
import { server } from './mswServer';
// VITE_API_URL is set via vite.config.ts test.env so it's available at module
// transform time — more reliable than Object.defineProperty on import.meta.env.

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
