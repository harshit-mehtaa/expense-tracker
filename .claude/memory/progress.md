# Task Progress

## Status: review_complete (awaiting user COMMIT approval)
## Task: 100% backend test coverage (frontend deferred to its own future pipeline)
## Started: 2026-08-16
## Steps Completed: analyze, plan, approve, implement, review

## OUTCOME — all 13 steps done, all gates green
- `npm run test:coverage` **exits 0**; 100% statements/branches/functions/lines
- 48 test files / 1720 tests passing (baseline was 39 files / 1226 tests, 93.66/89.41)
- `tsc --noEmit` clean; `vitest.config.ts` untouched (thresholds 100, exclude list unchanged)
- CI now gates on coverage (`docker-publish.yml` "Test backend" → `npm run test:coverage`)

## Production changes made (everything else was tests)
- **Step 3 refactor, 28 sites**: `isTest ? null : await prisma.X.findFirst(...)` in route
  handlers → service-owned `*ForAudit` getters, in `routes/{loans,insurance,admin,tax,
  investments}.ts`. `safeUserSelect` (PII allow-list, excludes passwordHash) moved into
  `adminService.ts`. `getRealEstateForAudit` left intentionally UNSCOPED to match prior
  behavior; `getExchangeRateForAudit` is 1-arg (rates are global).
- **`routes/budgets.ts`** (unplanned, from a review finding): narrowed
  `compareBudgetCategoryNames`'s `userName` to `string`, deleting two provably-dead
  `?? ''` fallbacks.
- **`services/importService.ts`**: added a documented `/* c8 ignore next */` on the
  `if (transaction.paymentMode)` guard. Takes repo count 27 → 28.

## !! Step 11 LANDMINE — do NOT re-attempt !!
The plan claimed the catch block in `importService.ts` (~:592) was provably dead and must
be DELETED. **That premise is false.** It was deleted once and **21 tests failed**: under
Vitest's ESM mock a namespace object is a Proxy that THROWS on undefined exports, so the
guard is load-bearing in tests even though it looks dead against the real package. It was
reverted; only an explanatory comment was added. Do not delete it again.

## Review outcome (quality + compliance + adversarial, all 3 run)
Fixes applied from findings:
- **HIGH (adversarial)**: `vision.md` had disclosed "excludes src/index.ts"; my rewrite
  dropped it while asserting a bare "100%". Caveat RESTORED + the false
  "no testable business logic" comment in `vitest.config.ts` corrected. `index.ts` (287
  lines) holds `sanitizeFilename`, the multer `fileFilter`, and the ~130-line import
  handler at 0%. Untestable only because `app.listen()` runs at module scope.
- **HIGH (quality)**: 9 new test files were UNTRACKED — would have shipped the CI coverage
  gate on a tree missing them. Must be `git add`ed.
- **MED (adversarial)**: `dashboardService.ts`'s `c8 ignore` was provably FALSE (reachable
  Jan-31 + dueDate-31, verified numerically). Removed, replaced with a real test.
- **MED (adversarial)**: `getRealEstateForAudit` now owner-scoped like its 9 siblings.
- **MED (compliance)**: `architecture.md`/`progress.md`/`vision.md` reconciled.
- **LOW**: false "2-arg callers" rationale fixed; `vision.md`'s "never hard-deleted"
  invariant corrected (8 financial entities ARE hard-deleted).
**`c8 ignore` net 27 → 27** — added 1 justified, removed 1 false. Gate HONOURED.
Verified on Node 20 (CI pin) + Node 25, TZ=UTC: exit 0, 100%, 1722 tests.

## Follow-ups logged as debt (see vision.md)
43 raw prisma calls still in route handlers; 3 hand-rolled `resolveTargetUserId` dupes;
declined `auditService.ts:20` guard removal; the 10 `*ForAudit` getters duplicate their
mutation's `where` clause and could collapse into `updateX` returning `{before, after}`.

## Frontend coverage: OUT OF SCOPE. Separate future ANALYZE→...→COMMIT pipeline.
## Standing instruction: every commit includes pending .claude/ + AGENTS.md changes, pushed.
