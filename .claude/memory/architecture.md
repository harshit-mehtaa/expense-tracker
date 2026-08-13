# Codebase Architecture

<!-- Cap: 150 lines. Evict oldest sections when at capacity. -->
<!-- Last scanned: 2026-08-10 -->

Self-hosted family finance manager for Indian households. Tracks income, expenses,
investments, taxes, insurance, loans, real estate, and foreign assets. Deployed via
Docker Compose on a home server.

## Tech Stack
- Language: TypeScript 5.3 (strict) — backend and frontend
- Backend: Node.js + Express 4.18, Prisma ORM 5.10
- Frontend: React 18.2 + Vite 5.1, React Router
- Database: PostgreSQL 16 (alpine)
- Test framework: Vitest 1.3 (both sides); Supertest for routes, React Testing Library + MSW for UI
- Package manager: npm (no workspaces — backend/ and frontend/ install separately)
- Auth: JWT access token (15m) + refresh token (7d) in HttpOnly cookie

## Directory Structure
- `backend/src/` — `index.ts` bootstrap, `routes/` (17), `services/` (18), `middleware/`,
  `config/`, `utils/`, `types/`, `__tests__/` (27 files)
- `backend/prisma/` — `schema.prisma`, `migrations/`, `seed.ts`
- `frontend/src/` — `pages/` (16), `components/`, `api/`, `contexts/`, `hooks/`, `lib/`, `types/`
- `shared/types/index.ts` — DTOs imported by both sides via `@shared/*` alias
- `nginx/` — production reverse proxy
- `.github/workflows/docker-publish.yml` — CI

## Build & Run
Root `Makefile` drives Docker Compose: `start`, `stop`, `restart`, `build`, `migrate`,
`seed`, `reset-db`, `backup-db`, `restore-db`, `logs`, `shell-backend`, `shell-db`,
`start-prod`, `build-prod`.

Per-package (run inside `backend/` or `frontend/`):
- Backend build: `npm run build` (tsc → `dist/`) · dev: `npm run dev` (ts-node-dev)
- Frontend build: `npm run build` (`tsc && vite build`) · dev: `npm run dev` (port 5173)
- Test: `npm run test` (`vitest run`) — both sides
- Coverage: `npm run test:coverage`
- Lint: **BROKEN.** `frontend/package.json` defines `npm run lint` (`eslint src --max-warnings 0`)
  and installs ESLint 8.57 + TS/react-hooks/react-refresh plugins, but **no ESLint config file
  exists** (no `.eslintrc*`, no flat `eslint.config.js`, not in `frontend/`, root, or `$HOME`).
  The script always fails with "couldn't find a configuration file". Backend has no lint at all.
  Verified 2026-08-10 by execution, not inspection.
- Format: none configured (no Prettier anywhere)
- Type check: `npx tsc --noEmit` — works, exit 0. This is the only working static gate.

## Key Modules
Backend services carry the business logic; routes are thin and delegate.
- `transactionService` (~46KB) — core income/expense/transfer engine
- `dashboardService` (~34KB) — net worth, cashflow, asset allocation, alerts
- `investmentService` (~32KB) — stocks (India + foreign), mutual funds, SIPs, XIRR
- `importService` (~28KB) — CSV/PDF bank statement parsing, bank auto-detect, dedup by import hash
- `taxService` — Indian income tax: 80C/80D, capital gains, ITR categories, advance tax
- `capitalGainsService`, `housePropertyService`, `foreignAssetService`, `otherIncomeService` — tax inputs
- `loanService` (amortization), `insuranceService`, `accountService`, `recurringService`
- `categoryRuleService` (auto-categorization), `auditService`, `authService`, `adminService`

Frontend pages mirror the domains: Dashboard, Transactions, Investments, Tax, Insurance,
Loans, Accounts, Settings.

## Data Model (prisma/schema.prisma)
- `User` (role: ADMIN | MEMBER), `BankAccount` (savings, current, credit card, NRE, PPF, DEMAT)
- `Transaction` — income/expense/transfer; links to loan, SIP, insurance policy, refund; `importHash` for dedup
- `Investment`, `FixedDeposit`, `RecurringDeposit`, `GoldHolding`, `RealEstate`, `ForeignAssetDisclosure`
- `InsurancePolicy` (11 types), `Loan`, `TaxEntry`, `Budget`, `RecurringRule`, `CategoryRule`
- `Category` — family-shared, hierarchical (INCOME/EXPENSE/ASSET/LIABILITY)
- `BankStatementImport`, `AuditLog`, `NetWorthSnapshot`
- Money: `Decimal(15,2)` INR. Rates/NAV: `Decimal(15,4)`. Soft delete via `deletedAt`.

## Dependencies
- `@prisma/client` — DB access (all queries go through it; no raw SQL layer)
- `zod` — request validation (backend) and form schemas (frontend)
- `@tanstack/react-query` — server state · `@tanstack/react-table` — data tables
- `react-hook-form` — forms · `radix-ui` + `tailwindcss` — UI · `recharts` — charts
- `axios` — API client with refresh-on-401 interceptor (`frontend/src/lib/api.ts`)
- `multer` + `papaparse` + `pdf-parse` — statement upload/parsing
- `pino` (structured logs), `morgan` (HTTP logs), `helmet`, `express-rate-limit` (500/15min; tighter on auth)

## Test Setup
- Framework: Vitest 1.3, `globals: true`
- Backend: `environment: node`, setup `src/__tests__/setup.ts` (sets NODE_ENV, DATABASE_URL, secrets); Prisma is mocked
- Frontend: `environment: jsdom`, MSW 2.13 for API mocking
- Location: `backend/src/__tests__/` (unit `*.test.ts` + `routes/*.routes.test.ts`), `frontend/src/__tests__/`
- Command: `npm run test` in the respective package
- **Backend coverage threshold is 100%** (statements/branches/functions/lines) — enforced in
  `backend/vitest.config.ts`. Excluded: `src/index.ts`, `src/config/prisma.ts`, `prisma/`, `__tests__/`.
  Frontend collects coverage but enforces no threshold.

## CI/CD
`.github/workflows/docker-publish.yml` on push to `main` or manual dispatch:
mirrors base images to GHCR → builds backend + frontend multi-platform (amd64/arm64) →
pushes to `ghcr.io/harshit-mehtaa/expense-tracker-{backend,frontend}` → sets packages public.
**No test or lint job in CI** — quality gates are local only.

## Domain Rules
- Indian financial year: Apr 1 – Mar 31 (encoded in tax/report logic)
- Indian number formatting (lakhs/crores: ₹1,23,456)
- Role-based scoping: ADMIN sees all family data, MEMBER sees only their own
