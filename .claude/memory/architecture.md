# Codebase Architecture

<!-- Cap: 150 lines. Evict oldest sections when at capacity. -->
<!-- Last scanned: 2026-09-06 -->

Self-hosted family finance manager for Indian households. Express + Prisma + PostgreSQL
backend, React + Vite frontend, TypeScript throughout, run via Docker Compose.

## Tech Stack
- Backend: TypeScript 5.3.3, Express 4.18.3, Prisma 5.10.0 (PostgreSQL), Zod 3.22.4
- Auth: jsonwebtoken 9.0.2 + bcryptjs 2.4.3, cookie-parser (JWT via HttpOnly cookies)
- Imports: multer + papaparse (CSV) + pdf-parse (PDF bank statements)
- Frontend: React 18.2.0, Vite 5.1.0, react-router-dom 6.22.1
- Data/forms: @tanstack/react-query 5.20.0, @tanstack/react-table 8.13.0, react-hook-form
  7.50.1 + zod resolvers. UI: Radix primitives, tailwindcss 3.4.1, lucide-react, recharts,
  cmdk. Package manager: npm (package-lock.json both sides; CI uses `npm ci`)

## Directory Structure
- `backend/src/index.ts` — Express bootstrap; exports `app` for supertest
- `backend/src/routes/` — 17 thin route files (Zod validation, no Prisma calls)
- `backend/src/services/` — business logic; all Prisma access lives here
- `backend/src/middleware/` — auth.ts (requireAuth, role check), errorHandler.ts
- `backend/src/utils/` — AppError, asyncHandler, response, financialYear, indianFormat
- `backend/prisma/` — schema.prisma, 18+ migrations, seed.ts
- `frontend/src/pages/` — route-level views (accounts/, admin/, budgets/, insurance/,
  investments/, loans/, tax/, transactions/, Dashboard.tsx, Login.tsx, Settings.tsx)
- `frontend/src/components/` — layout/, shared/, ui/ (shadcn-style primitives)
- `frontend/src/contexts/` — AuthContext, FYContext, ToastContext
- `shared/types/index.ts` — DTOs shared frontend/backend via `@shared/*` alias. No
  `controllers/` layer — routes call services directly

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
- Frontend: Vitest, `environment: jsdom`, RTL + MSW (`mswServer.ts`). Coverage is a
  REAL, CI-enforced gate — per-directory thresholds in `vite.config.ts` (api/lib/hooks
  ~95%, contexts ~95%, components 88%, pages 30% but `perFile: true` so every page's
  OWN test file must clear the bar, not just the aggregate). Globs must use `'**/src/x/**'`
  (Vitest matches absolute paths) or they silently match nothing and enforce nothing.

## Linting
- Frontend: `frontend/.eslintrc.cjs` — recommended + typescript-eslint + react-hooks.
  **Verified live: `npm run lint` runs clean.** `no-explicit-any` deliberately off
  (180 pre-existing sites). `react-hooks/rules-of-hooks` kept as `error` — it caught a
  real conditional-hook bug in `Transactions.tsx` that `tsc` and a green test suite
  both missed (component wasn't rendered by either check).
- Backend: **no ESLint config or lint script at all** — `tsc --noEmit` and tests only.
- No Prettier anywhere in the repo.

## CI/CD (.github/workflows/docker-publish.yml)
Triggers on push/PR to `main`. `quality` job (backend tsc + test:coverage @100%, frontend
lint+tsc+test) gates every other job. On PRs, only `quality` runs. On push to `main`:
additionally mirrors base images to GHCR, builds+pushes backend/frontend multi-arch
images, then flips GHCR package visibility to public.

## Coding Patterns
- **Error handling**: `AppError` (`backend/src/utils/AppError.ts`) with static factories
  (badRequest/unauthorized/forbidden/notFound/conflict/validationError/internal);
  `isOperational = statusCode < 500`. Central `errorHandler` middleware: ZodError → 422
  per-field, AppError → its own status, else generic 500 (stack hidden in prod). Async
  routes wrapped in `asyncHandler()`.
- **API envelope**: `{ success, data, message?, pagination? }` via `utils/response.ts`
  helpers (sendSuccess, sendPaginated, sendCreated, sendNoContent). **Validation**: Zod
  schemas inline per route file, reusable preprocess helpers for empty-string coercion.
- **Auth**: JWT + HttpOnly cookies, `requireAuth` middleware sets `req.user`, ADMIN role
  check where needed. Routes mount `router.use(requireAuth)`.
- **Naming**: route/service files share resource names (accounts.ts ↔ accountService.ts);
  route-level tests in `__tests__/routes/*.routes.test.ts`, separate from unit tests.

## Domain Rules
- Money is always `Decimal`, never float — `Decimal(15,2)` INR, `Decimal(15,4)`
  rates/NAV/unit prices
- Financial records are soft-deleted (`deletedAt`), never hard-deleted
- Indian financial year (Apr 1 – Mar 31) throughout tax/reporting
  (`utils/financialYear.ts`)
- Bank statement imports are idempotent via `importHash`

## Account/Transaction Model
- `BankAccount` (schema.prisma:334-365): per-user (`userId`), `accountType` enum incl.
  `CASH`, `currentBalance` is a STORED field (not derived), `isActive` soft toggle (no
  `deletedAt`). No unique constraint on (userId, accountType) in Prisma's schema — but a
  raw-SQL partial unique index (`BankAccount_userId_isCashAccount_key`, migration
  `20260906090100`) guarantees at most one row per user has `isCashAccount: true`.
- Every user has exactly one system-managed cash account (`isCashAccount: true`,
  `accountType: 'CASH'`), provisioned by idempotent `accountService.ensureCashAccount`
  (called from `authService.createUser`, `adminService.createUser`, `prisma/seed.ts`, and
  self-healingly from `createTransaction`); cannot be created manually, deactivated, or
  retyped (guards in `accountService.ts`). Pre-feature users need
  `npm run prisma:backfill-cash` (`prisma/backfill-cash-accounts.ts`).
- `Transaction` (schema.prisma:656-711): `type` INCOME/EXPENSE/TRANSFER, `paymentMode`
  incl. CASH (distinct from `AccountType.CASH`), `bankAccountId` optional and **immutable
  after creation** (only `convertTransactionToTransfer` retrofits TRANSFER legs).
- Balance mutation lives entirely in `transactionService.ts`: single-leg INCOME/EXPENSE
  updates one account only if `bankAccountId` is set (auto-resolved to the cash account
  for `paymentMode==='CASH'`); TRANSFER creates two `transferPairId`-linked rows,
  atomically debiting/crediting inside one `$transaction`. Update/soft-delete both
  reverse via shared `balanceDelta()`, cascading to the paired leg (`balanceImpactApplied`
  flag exists for admin-linked legs that shouldn't move money). Double-entry via
  `transferPairId` is the established idiom for money moving between a user's own
  accounts — a cash withdrawal/deposit is exactly this pattern (labeled "Cash
  Withdrawal"/"Cash Deposit" in `Transactions.tsx`'s `TransferCategoryInfo`).
- KNOWN GAP: `statementImportService.persistParsedStatement` (bank-statement import)
  doesn't route CASH the way `recurringService.ts` does — see vision.md tech debt.

## Investments/Assets Pages (frontend/src/pages/investments/)
- `/assets` hosts THREE URL-backed tabs (`TABS`/`TAB_META`/`isTab` in `Assets.tsx`,
  membership guard via `.includes` not object-lookup): default "Vehicles & Other",
  `?tab=gold` "Gold", `?tab=real-estate` "Real Estate". `GoldPage`/`RealEstatePage` render
  conditionally as unmodified children (no query `enabled` gate/reset effect needed —
  unmount discards their state for free; only `Assets.tsx`'s own modal state, which lives
  in the always-mounted parent, needs one). `/gold`/`/real-estate` are `Navigate`
  redirects inside `AppShell`. **Tab set is closed**: `realEstateId`/`goldHoldingId` on
  `Asset` are the only `@unique` identity FKs to a detail tracker (`insurancePolicyId` is
  a non-unique reference FK, doesn't qualify).
- `Asset` (schema.prisma:861-927) avoids net-worth double-counting via those FKs
  (`Assets.tsx:70` filters linked rows out of the Vehicles & Other grid). `AssetType.GOLD`
  stays in the shared `ASSET_TYPES` map (`Loans.tsx`'s inline collateral creator needs it)
  but is excluded from Assets' OWN creation form — an unlinked GOLD Asset from Loans can
  still appear on the grid, a documented gap. Gold/RealEstate APIs stay under
  `/investments`, untouched by the frontend moves. `Loans.tsx` queries `['gold',
  viewUserId]`, same key `Gold.tsx` uses.

## Tax Centre (frontend/src/pages/tax/TaxCentre.tsx, backend/src/routes/tax.ts)
- `TaxProfile` (schema.prisma:961-994, unique per user+fyYear) drives regime/HRA/
  deductions/tax-paid. Editable form on the default "Tax Summary" tab upserts via
  `POST /tax/profile` -> `taxService.upsertTaxProfile`. RHF hydrates through
  `toProfileFormValues()`, which null-coalesces every field — never feed a raw server
  row into `values` directly; a `Decimal?`/`String?` column returning `null` breaks
  zod's all-or-nothing object parsing (fixed 2026-09-06 for `cityType`, the one field
  with an enum-only, non-nullable zod type). `formState.errors` renders both inline and
  as a form-level banner (the banner is mandatory: a conditionally-unmounted field, e.g.
  `cityType` under NEW regime, has nowhere to show a per-field error). Do NOT add
  `resetOptions:{keepDirtyValues:true}` to this form's `useForm` — tried once, reverted:
  it preserves dirty state by field NAME across an identity change (switching
  selectedFY/viewUserId), so an unsaved edit for one member can be silently shown as and
  saved onto a DIFFERENT member's profile once both are cached. `values`'s default full
  reset on every change is what's actually correct here.
