# Codebase Architecture

<!-- Cap: 150 lines. Evict oldest sections when at capacity. -->
<!-- Last scanned: 2026-08-16 -->

Self-hosted family finance manager for Indian households. Express + Prisma + PostgreSQL
backend, React + Vite frontend, TypeScript throughout, run via Docker Compose.

## Tech Stack
- Backend: TypeScript 5.3.3, Express 4.18.3, Prisma 5.10.0 (PostgreSQL), Zod 3.22.4
- Auth: jsonwebtoken 9.0.2 + bcryptjs 2.4.3, cookie-parser (JWT via HttpOnly cookies)
- Imports: multer + papaparse (CSV) + pdf-parse (PDF bank statements)
- Frontend: React 18.2.0, Vite 5.1.0, react-router-dom 6.22.1
- Data/forms: @tanstack/react-query 5.20.0, @tanstack/react-table 8.13.0,
  react-hook-form 7.50.1 + zod resolvers
- UI: Radix primitives, tailwindcss 3.4.1, lucide-react, recharts, cmdk
- Package manager: npm (package-lock.json both sides; CI uses `npm ci`)

## Directory Structure
- `backend/src/index.ts` — Express bootstrap; exports `app` for supertest
- `backend/src/routes/` — 17 thin route files (Zod validation, no Prisma calls)
- `backend/src/services/` — business logic; all Prisma access lives here
- `backend/src/middleware/` — auth.ts (requireAuth, role check), errorHandler.ts
- `backend/src/utils/` — AppError, asyncHandler, response, financialYear, indianFormat
- `backend/prisma/` — schema.prisma (1026 lines), 18 migrations, seed.ts
- `frontend/src/pages/` — route-level views (accounts/, admin/, budgets/, insurance/,
  investments/, loans/, tax/, transactions/, Dashboard.tsx, Login.tsx, Settings.tsx)
- `frontend/src/components/` — layout/, shared/, ui/ (shadcn-style primitives)
- `frontend/src/contexts/` — AuthContext, FYContext, ToastContext
- `shared/types/index.ts` — DTOs shared frontend/backend via `@shared/*` alias
- No `controllers/` layer — routes call services directly

## Build & Run
- Backend dev: `npm run dev` (ts-node-dev) · build: `npm run build` (tsc) · start: `npm start`
- Frontend dev: `npm run dev` (vite, :5173) · build: `tsc && vite build`
- Prisma: `npm run prisma:generate|migrate|deploy|seed|studio`
- `make start` — full stack via docker compose, http://localhost:8080
- `make generate` — regenerate Prisma client after a schema edit while running
- Full command list: root `Makefile` (start/stop/restart/build/reset-db/seed/migrate/
  backup-db/restore-db/logs/shell-backend/shell-db/start-prod/build-prod)

## Test Setup
- Backend: Vitest, `environment: node`, tests in `backend/src/__tests__/` (unit +
  `routes/*.routes.test.ts` via supertest against `makeApp.ts`, Prisma mocked).
  **Verified live: 1720 tests / 48 files passing.**
  **Coverage is 100% statements/branches/functions/lines, and CI enforces it** — the
  backend test step runs `npm run test:coverage`, so any uncovered line fails the build.
  New backend code must ship with tests; there is no slack in the threshold.
- Frontend: Vitest, `environment: jsdom`, RTL + MSW (`mswServer.ts`). Coverage
  thresholds in `vite.config.ts` are a near-zero floor (statements 3%, branches 50%,
  functions 28%, lines 3%) — not a real gate, don't treat frontend coverage % as
  meaningful.

## Linting
- Frontend: `frontend/.eslintrc.cjs` — recommended + typescript-eslint + react-hooks.
  **Verified live: `npm run lint` runs clean.** `no-explicit-any` deliberately off
  (180 pre-existing sites). `react-hooks/rules-of-hooks` kept as `error` — it caught a
  real conditional-hook bug in `Transactions.tsx` that `tsc` and a green test suite
  both missed (component wasn't rendered by either check).
- Backend: **no ESLint config or lint script at all.** Quality enforced only via
  `tsc --noEmit` and tests.
- No Prettier anywhere in the repo.

## CI/CD (.github/workflows/docker-publish.yml)
Triggers on push/PR to `main`. `quality` job (backend tsc + test:coverage @100%,
frontend lint+tsc+test)
gates every other job. On PRs, only `quality` runs. On push to `main`: additionally
mirrors base images to GHCR, builds+pushes backend/frontend multi-arch images, then
flips GHCR package visibility to public.

## Coding Patterns
- **Error handling**: `AppError` (`backend/src/utils/AppError.ts`) with static factories
  (badRequest/unauthorized/forbidden/notFound/conflict/validationError/internal);
  `isOperational = statusCode < 500`. Central `errorHandler` middleware: ZodError → 422
  per-field, AppError → its own status, else generic 500 (stack hidden in prod). Async
  routes wrapped in `asyncHandler()`.
- **API envelope**: `{ success, data, message?, pagination? }` via `utils/response.ts`
  helpers (sendSuccess, sendPaginated, sendCreated, sendNoContent).
- **Validation**: Zod schemas inline per route file, reusable preprocess helpers for
  empty-string coercion.
- **Auth**: JWT + HttpOnly cookies, `requireAuth` middleware sets `req.user`, ADMIN role
  check where needed. Routes mount `router.use(requireAuth)`.
- **Naming**: route/service files share resource names (accounts.ts ↔ accountService.ts).
  Route-level tests in `__tests__/routes/*.routes.test.ts`, separate from unit tests.

## Domain Rules
- Money is always `Decimal`, never float — `Decimal(15,2)` INR, `Decimal(15,4)`
  rates/NAV/unit prices
- Financial records are soft-deleted (`deletedAt`), never hard-deleted
- Indian financial year (Apr 1 – Mar 31) throughout tax/reporting
  (`utils/financialYear.ts`)
- Bank statement imports are idempotent via `importHash`
