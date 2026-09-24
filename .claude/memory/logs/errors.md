# Error Journal

<!-- Cap: 30 entries. Evict oldest when at capacity. -->
<!-- Format: ### YYYY-MM-DD | Category | Frequency: N -->

### 2026-09-06 | architecture | Frequency: 2
Cash-account feature (per-user CASH BankAccount + auto-resolve on paymentMode=CASH)
deliberately does NOT extend to the bank-statement import path — bank-statement import
already infers `paymentMode: CASH` from remark text via `importService.ts` regex, but
writes rows through `statementImportService.persistParsedStatement`, which bypasses the
new cash-account balance logic entirely. User approved deferring this at the APPROVE
gate. CORRECTION (found during adversarial REVIEW, same day): the original deferral
rationale named `transactionService.bulkImportTransactions` as the blocker and assumed
fixing it required a `createMany` → chunked-transactions rewrite — but that function is
DEAD CODE (zero production callers). The actual live path, `persistParsedStatement`,
already writes per-row inside one `$transaction`, so the real fix is small, not an
architecture change. The equivalent gap in `recurringService.ts` (CASH-paymentMode
recurring rules) WAS caught and fixed in the same review pass. Tracked correctly in
vision.md now. Flag for /update-system: verify a "dead code" claim behind a scope
decision by grep for callers BEFORE presenting the decision to the user, not after.

### 2026-09-08 | tooling | Frequency: 2
Stated in a plan (dead-code deletion task) as a safety-net justification: "Vite
ssrTransform means a stale named import wouldn't even throw." FALSE — verified by
reading `vite/dist/node/chunks/dep-*.js`: Vite 5.4's SSR module runner explicitly
validates named bindings at import time and throws `SyntaxError` on a missing export,
failing the whole test file at collection. Caught independently by both REVIEW agents.
Outcome was safe (the claim made the task MORE cautious, not less, and grep confirmed
zero actual leftovers) — but the belief was still wrong and got written into a plan
before being checked. The real, narrower gap: only a TYPE-ONLY stale reference (e.g. an
`import type` or a bare type annotation) is invisible in backend tests, because esbuild
elides type-only imports and `backend/tsconfig.json` excludes `src/__tests__` from
`tsc` — and backend has no `typecheck:tests` equivalent to the frontend's. Flag for
/update-system: don't assert a toolchain behavior (throws vs. silently resolves) without
either reading the tool's source or citing a doc — "sounds plausible" isn't verification.
RECURRED same day, PDF-import debugging task: orchestrator diagnosed a "missing multipart
boundary" bug in `Transactions.tsx`'s import POST by reading `axios@1.6.7`'s source (the
`^1.6.7` range in `frontend/package.json`) and live-testing the *backend* multer behavior
— but never checked what axios version is actually LOCKED (`package-lock.json`/
`node_modules` resolve to `1.13.6`, which ships via `npm ci`). 1.13.6's
`resolveConfig.js:36-38` unconditionally strips any Content-Type the caller sets on a
FormData body in a browser env (`headers.setContentType(undefined)`), making the
"buggy" line behaviorally identical to the "fixed" one — a real repro against real multer,
built on an unverified premise about what the client actually sends, still produced a
false root cause. Caught by the architect agent during PLAN, which re-verified by
executing the actually-installed `resolveConfig.js`. Flag for /update-system (now at
frequency 2 — propose a hard rule): when diagnosing a dependency's behavior, always read
from `node_modules` (what's installed) never `package.json` (what's requested), and when
the dependency has multiple internal code paths gated on environment (browser vs Node,
adapter-specific), verify against the actual runtime target the bug report is about, not
whichever path is easiest to execute a repro against.

### 2026-09-24 | tooling | Frequency: 1
Pushed 7 commits whose local "full gate" was backend tsc + test:coverage and frontend lint +
`npx tsc --noEmit` + test:coverage — but CI's quality job ALSO runs `npm run typecheck:tests`
(frontend, `tsconfig.test.json`), which the app tsconfig excludes. Two type-only errors in a
new test file (an index into an optional param type; a fixture literal with extra props)
passed every local run and failed CI, so no images were built. Fix: the local gate is
exactly the CI step list — read `.github/workflows/docker-publish.yml` "Tests, types & lint"
and run every `run:` in it (backend: tsc, test:coverage; frontend: lint, tsc,
typecheck:tests, test:coverage) before any push.
