# Task Progress

## Status: review (adversarial pass outstanding) — awaiting COMMIT approval
## Task: Frontend test coverage — logic modules + page smoke tests, gated in CI

## RESULT
5.32 -> **69.31%** stmts | 56.83 -> 71.88 br | 28.24 -> 46.4 fn. 11 -> 41 files,
156 -> **651 tests**. `test:coverage` EXIT 0. Frontend CI now gates on coverage.
Beat both the ~52-57% projection and the original 55-65% target.
Backend unaffected: 100%, 56 files / 1823 tests, still green.

## PRODUCTION BUG FOUND + FIXED
`ChangePassword.tsx` called `navigate()` during the RENDER phase. On success `logout()`
cleared the user -> re-render -> re-entered the branch -> navigated during render ->
infinite loop that HUNG the vitest worker (exit 144). Fixed with `<Navigate>`, matching
App.tsx's 5 existing uses. **Quality review caught that the fix was UNGUARDED** — a stale
comment plus a never-settling `/auth/logout` handler meant reverting the fix still passed
all 9 tests. Proven, then fixed: reverting now fails 9 of 10.

## HARD-WON FACTS (do not re-derive)
- Threshold globs MUST be `'**/src/x/**'`. Vitest matches ABSOLUTE paths, so `'src/x/**'`
  matches nothing, enforces nothing, and exits 0. Proven all 6 enforce by setting each to
  100 and confirming its own named ERROR line.
- Globbed files are REMOVED from the global bucket, so the trailing global numbers govern
  only the residual — currently just `src/App.tsx`.
- MSW `onUnhandledRequest: 'error'` (was 'warn') is what stops page tests being theatre:
  with 'warn' a forgotten handler renders the empty state, which on most pages is
  identical to success, and the test passes asserting nothing.
- **Awaiting `<h1>` does NOT prove loading finished.** Only Reports, Transactions and
  Dashboard have a real loading early-return; the rest render the heading unconditionally
  ABOVE the loading switch. Use a per-page loaded sentinel + assert loading text is gone.
- jsdom lacks matchMedia/ResizeObserver/scrollIntoView/hasPointerCapture/createObjectURL,
  and its localStorage does NOT round-trip. All polyfilled in setup.ts, `typeof`-guarded
  so node-environment test files still work.
- `renderPage` must build a FRESH QueryClient — the lib singleton has staleTime 5min and
  retry<2, which leaks cache between tests and times out 500-path tests.
- The harness deliberately omits `<React.StrictMode>` (double-render breaks
  request-count assertions). Documented in the docblock; redirect tests cover the gap.

## OUTSTANDING
- Adversarial review still running; triage its findings before commit.
- Quality review: FAIL -> all 7 items fixed (unguarded fix, latent TestUser type error,
  2 slack thresholds ratcheted, StrictMode docblock, sessionStorage aliasing, URL guard,
  token reset moved to global teardown).
- Frontend test files are NOT typechecked (`tsconfig.json` excludes `src/__tests__`).
  A `tsconfig.test.json` + `typecheck:tests` CI step is worth its own task.

## Next candidates: wire up ErrorBoundary (app currently has none); delete dead
## bulkImportTransactions; 43 raw prisma calls in route handlers. See vision.md.
## Standing instruction: every commit includes pending .claude/ changes, and gets pushed.
