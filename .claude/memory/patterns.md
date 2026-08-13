# Coding Patterns & Conventions

<!-- Cap: 100 lines. Evict oldest entries when at capacity. -->
<!-- Last scanned: 2026-08-10 -->

## Naming
- Variables / functions: camelCase
- Classes / types / interfaces / React components: PascalCase
- Enums and enum members: PascalCase type, UPPER_SNAKE_CASE members (matches Prisma enums)
- Backend files: camelCase (`transactionService.ts`, `errorHandler.ts`)
- Frontend components/pages: PascalCase (`Dashboard.tsx`)
- Tests: `<subject>.test.ts`, `<subject>.unit.test.ts`, `routes/<name>.routes.test.ts`

## Error Handling
- Style: throw typed `AppError` (`backend/src/utils/AppError.ts`); never return error objects
- Factories: `AppError.badRequest()`, `.unauthorized()`, `.forbidden()`, `.notFound()`, `.conflict()`
- `isOperational` flag: true (4xx) → message safe to return to client; false (5xx) → log full detail only
- Routes wrap async handlers in `asyncHandler()` so rejections reach the error middleware
- Central `errorHandler` middleware formats every response; routes never build error payloads themselves
- Services throw; routes do not try/catch

## API Contract
- Success: `{ success: true, data: T, message?: string }`
- Paginated: adds `pagination: { total, page, limit, hasMore }`
- Failure: `{ success: false, message: string, errors?: Record<string, string[]> }`
- Response shapes live in `shared/types/index.ts` and are imported by both sides

## Module Organization
- Backend: strict layering — `routes/` (HTTP + validation) → `services/` (business logic) → Prisma
  - Route handlers stay thin; no Prisma calls in routes
  - No raw SQL; all DB access via `@prisma/client`
- Frontend: feature-based `pages/` + shared `components/` + per-domain `api/` client modules
- Imports: `@shared/*` for cross-package DTOs, `@/*` for `frontend/src/*`, relative within a layer

## Validation
- Backend: Zod schemas at the route boundary, before service calls
- Frontend: React Hook Form + Zod resolver on every form
- Shared DTO types keep the two in sync

## Code Style
- Indentation: 2 spaces
- Quotes: single
- Semicolons: yes
- TypeScript: `strict: true` both packages; frontend adds `noUnusedLocals`,
  `noUnusedParameters`, `noFallthroughCasesInSwitch`
- Async: `async/await` throughout — no callbacks, no raw `.then()` chains
- No Prettier — formatting is by convention, enforced only by ESLint on the frontend

## Testing
- Pattern: `describe` / `it` (Vitest globals, no imports needed)
- Backend services: unit tests with Prisma mocked
- Backend routes: Supertest against the Express app
- Frontend: React Testing Library + MSW for network mocking
- **Backend must stay at 100% coverage** — a new branch without a test fails `test:coverage`.
  Write the test alongside the code, not after.
- Financial calculations use `Decimal`; assert on exact values, not floating-point approximations

## Data Conventions
- Money stored as `Decimal(15,2)`, rates/NAV as `Decimal(15,4)` — never JS `number` for currency
- Soft delete via `deletedAt`; queries must filter it out
- Indian FY (Apr 1 – Mar 31) for all tax and reporting period logic
- Imports deduplicated by `importHash` — re-importing a statement must be idempotent
