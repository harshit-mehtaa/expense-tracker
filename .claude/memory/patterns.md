# Coding Patterns & Conventions

<!-- Cap: 100 lines. Evict oldest entries when at capacity. -->
<!-- Last scanned: 2026-08-16 -->

## Naming
- Variables/functions: camelCase · Types/classes/components: PascalCase
- Files: camelCase for backend modules, PascalCase for React components
- Route/service files share a resource name: `accounts.ts` ↔ `accountService.ts`
- Tests mirror source names with `.test.ts`/`.test.tsx`; route-level backend tests live
  separately under `__tests__/routes/*.routes.test.ts`

## Error Handling
- Backend: throw `AppError` via static factories (`AppError.badRequest()`, `.notFound()`,
  etc. — `backend/src/utils/AppError.ts`). `isOperational = statusCode < 500`.
- Central `errorHandler` middleware: `ZodError` → 422 with per-field messages,
  `AppError` → its own status/message/code, unknown → generic 500 (stack hidden outside
  dev). Every async route handler is wrapped in `asyncHandler()` so throws/rejections
  reach the handler — never a bare try/catch per route.
- Frontend: React Query surfaces request errors; toast via `ToastContext`.

## API Contract
- Envelope: `{ success: boolean, data, message?, pagination? }` — built with
  `sendSuccess` / `sendPaginated` / `sendCreated` / `sendNoContent` from
  `backend/src/utils/response.ts`. Never hand-construct a response object in a route.
- Errors: `{ success: false, message, code, errors? }`.

## Module Organization
- Backend: strict routes → services layering, **no controllers layer**. Routes parse and
  validate with an inline Zod schema, call one `services/*.ts` function, respond via
  `response.ts`. **No Prisma calls in route handlers** — all DB access lives in
  `services/`. No raw SQL.
- Frontend: feature-based `pages/`, shared `components/{layout,shared,ui}/`, `hooks/`,
  `contexts/`, `lib/`, `api/`.
- Shared DTOs live in `shared/types/index.ts`, aliased `@shared/*` on both sides, to
  prevent frontend/backend drift.

## Validation
- Zod schemas defined inline per route file, with reusable `preprocess` helpers for
  empty-string coercion (e.g. `optionalTrimmedString`, `optionalIfscCode` in
  `backend/src/routes/accounts.ts`).
- Frontend forms: react-hook-form + zod resolver.

## Auth
- JWT via HttpOnly cookies. `requireAuth` middleware (`backend/src/middleware/auth.ts`)
  sets `req.user`; routes mount `router.use(requireAuth)`. ADMIN role checked where
  family-wide access is required (vs a member's own data only).

## Testing
- Backend: Vitest, `environment: node`. Service unit tests mock Prisma; route tests use
  supertest against a `makeApp.ts` test harness. **Live-verified: 1720 tests, 48 files,
  all passing.**
- Frontend: Vitest, `environment: jsdom`, React Testing Library, MSW for API mocking.
- **Backend is at 100% statements/branches/functions/lines and CI gates on it** — the
  "Test backend" step runs `npm run test:coverage`, so any uncovered line fails the build.
  New backend code must ship with tests; there is no slack left in the threshold.
- `vi.mock` is hoisted and file-scoped — you cannot have two behaviours for one module in
  one file. When a case needs a different module-level mock (`isTest: false`, a missing
  export, a module-load side effect), add a SEPARATE file: see `errorHandler.prod.test.ts`,
  `auditService.prod.test.ts`, `documentsModuleLoad.test.ts`.
- Override mocks per-test, never by editing a shared `beforeEach` — that silently breaks
  sibling tests. A sort comparator showing 0% function coverage usually means the mock
  returns <2 rows, so `Array.sort` never calls it.
- Unreachable defensive code gets a `/* c8 ignore next -- reason */` with a real reason,
  not a deletion (28 in `backend/src`). But verify unreachability empirically first: under
  Vitest's ESM mock a namespace object is a Proxy that THROWS on undefined exports, so a
  guard that looks dead against the real package can be load-bearing in tests.
- Frontend coverage thresholds in `vite.config.ts` are a near-zero floor (3% statements)
  — not meaningful as a quality signal. Frontend coverage is tracked as separate work.

## Domain Rules (non-negotiable)
- Money is always `Decimal`, never a JS `number` — `Decimal(15,2)` for INR amounts,
  `Decimal(15,4)` for rates/NAV/unit prices. A rounding bug here is a real financial error.
- Financial records are soft-deleted via `deletedAt`, never hard-deleted.
- Indian financial year (Apr 1 – Mar 31) governs all tax/reporting period logic
  (`utils/financialYear.ts`).
- Bank statement imports must be idempotent via `importHash` — re-importing the same
  statement is a supported, safe user action.

## Lint & Types (verified live, not just from config)
- Frontend: `npm run lint` — ESLint, `no-explicit-any` deliberately off (180 pre-existing
  sites), `react-hooks/rules-of-hooks` kept as `error`. That rule has caught a real bug:
  a conditional hook in `Transactions.tsx` that both `tsc` and a green test suite missed,
  because neither actually renders the component. Treat frontend lint as load-bearing,
  not cosmetic.
- Backend: no lint config exists — `tsc --noEmit` and tests are the only gates.
- Both sides: `tsc --noEmit` must be clean before considering a change done.
