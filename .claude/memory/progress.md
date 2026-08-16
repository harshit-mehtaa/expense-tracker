# Task Progress

## Status: implement (plan challenged -> RISKY -> revised -> user re-approved)
## Task: Make backend/src/index.ts testable and drop its coverage exclusion
## Started: 2026-08-16
## Risk: medium. Type: refactor + bugfix + security coverage.

## Previous task: DONE — backend 100% coverage, commit c3a49be, pushed, all 5 CI jobs green.
## Baseline now: 48 files / 1722 tests, 100% S/B/F/L, CI gates on `npm run test:coverage`.

## User decisions (locked in at APPROVE — do not re-litigate)
- Run plan-challenger BEFORE implementing.
- **P8 fix now, in this task**: import endpoint returns 201 after a TOTAL batch-insert
  failure; change to 500. Contract change, explicitly approved. Isolate as the LAST commit
  so it can be reverted alone.
- **bulkImportTransactions dead code: SEPARATE follow-up task.** Do NOT delete here.
- P9 (unbounded serial inserts in one $transaction) deferred. It fails SILENTLY today:
  Prisma's 5s $transaction timeout -> P2028 -> caught -> 201 "imported: 0". Fixing P8 makes
  it loud. That ordering is deliberate.

## Two findings that reshape the task (I verified both independently)
1. `__tests__/routes/import.routes.test.ts` does NOT test production code. `makeImportApp()`
   at :66 rebuilds the endpoint inline (own `app.post` at :86) and tests that. Already
   drifted: omits resolveWriteUserId, applyCategoryRules, the account-ownership check,
   empty-parse rejection, and the audit log. Line 139 passes `req.file.originalname` RAW
   while production calls sanitizeFilename — **the suite asserts the UNSANITIZED behaviour**,
   so it would stay green if the XSS mitigation were deleted. Delete all 244 lines, rewrite.
2. `transactionService.bulkImportTransactions` (:1133) + `buildImportHash` (:34) are dead
   (zero non-test callers) with an INCOMPATIBLE hash vs live `makeImportHash` (omits `type`,
   applies Math.abs). Part of today's 100% is coverage of dead code shadowing the live code
   the exclusion hides.

## CHALLENGER REFUTED 2 LOAD-BEARING PREMISES (I re-verified both empirically)
1. "Only app.listen blocks import" — FALSE. `multer({dest:'/app/uploads'})` calls mkdirp.sync
   AT CONSTRUCTION: `node -e "require('multer')({dest:'/app/uploads'})"` -> **EROFS**.
   `vi.mock('fs')` CANNOT fix it (multer is externalized CJS; its require('fs') is real).
   Killed the test strategy for steps 4/5/6/8. -> new Step 0.
2. "P8 shows 'Failed to save imported transactions'" — FALSE. AppError.ts:14 sets
   `isOperational = statusCode < 500`, and errorHandler.ts:32 only echoes the message when
   operational. A 500 renders generic 'An unexpected error occurred'. User's original
   approval was given on my inaccurate description; re-asked and re-approved.

## REVISED PLAN (11 steps) — ONE ATOMIC COMMIT
vitest include is `src/**/*.ts`, so every NEW file is under the 100% gate the moment it
lands. Steps are an authoring order, NOT landable increments. Partial landing = red main.
0 [MED] `env.UPLOADS_DIR` (default '/app/uploads'), used by BOTH routes/import.ts AND
  routes/documents.ts; setup.ts sets os.tmpdir(). Unlocks real multer + real .attach().
1 [LOW] unify sanitizeFilename -> utils/ (byte-identical dupe index.ts:18 + documents.ts:71)
2 [MED] services/statementImportService.ts — owns all 4 Prisma calls. SANITIZE INSIDE the
  service (write boundary). ROUND netDelta to 2dp before compare+increment (user-approved
  Decimal fix; a cancelling set can leave 1e-13 and write a bogus increment).
3 [LOW] unit-test it — use the FULL branch enumeration, not 4 cases
4 [MED] routes/import.ts using env.UPLOADS_DIR
5 [MED] DELETE the 244-line fake test; rewrite preserving its 7 real assertions as a FLOOR:
  csv->parseCSV only; pdf->parsePDF only; x-pdf accepted; pdfPassword fwd as 3rd arg w/ bank
  undefined; image/jpeg->400; no file->400; body has bank+total. Then add branch cases.
6 [MED] app.ts createApp(); mount /api/transactions/import BEFORE transactionsRouter
  (also removes today's double requireAuth: transactions.ts:23 + index.ts:122)
7 [LOW] recurringScheduler.ts — return/unref timer handles so vitest can't hang
8 [LOW] index.ts -> ~10 lines. Two test files. MUST mock ./app AND ./services/
  recurringScheduler, else: real port bind, leaked 1h setInterval, real PrismaClient.
  Mock as `listen: vi.fn((_p, cb) => cb())` or the listen callback fails FUNCTION coverage.
9 [MED] P8: add explicit isOperational override to AppError; throw curated 500
  "Import failed — no transactions were saved." + console.error the ORIGINAL prisma error
  (else it's destroyed; today it at least reaches the client in errors[]).
10 [LOW] drop 'src/index.ts' from vitest.config.ts exclude — THIS IS THE ACCEPTANCE TEST.
  Update vision.md/patterns.md + makeApp.ts:1-5 docstring (soften, don't delete: index.ts
  still calls listen when !isTest).

## Branch enumeration that WILL be needed for 100% once the exclusion drops
index.ts:78 isDev ternary (isDev always false under test -> likely c8 ignore w/ reason);
:82 existsSync both arms; fileFilter :87-97 needs CSV-by-EXTENSION-only and PDF-by-
EXTENSION-only (octet-stream + .csv/.pdf) — currently only mimetype paths are covered;
:132-134 isPDF extension-only; :141 unlink catch (make unlinkSync throw); :137-142
try/finally (readFileSync throws, unlink still runs); ?? at :165,177,192,195,197,199,227
need BOTH sides (one tx with remark/paymentMode/categoryId and one without; with and
without accountId); :207 accountId && toCreate.length>0 (accountId set + all-duplicates);
:209 netDelta !== 0 (net-zero set); :262 listen callback must execute for FUNCTION metric.

## Key precedents to copy (do not reinvent)
- documents.routes.test.ts:29-33,54-56 — vi.hoisted() multer-opts capture (may become
  unnecessary after Step 0 lets real multer run)
- documentsModuleLoad.test.ts — separate file for a module-load branch
- errorHandler.prod.test.ts:13-20 — mock ./config/env then `await import()` the subject

## Gotchas
- Middleware order in createApp() is load-bearing: trust proxy BEFORE rate limiter,
  errorHandler strictly LAST.
- createApp() carries the global rateLimit (500/15min) that helpers/makeApp.ts lacks.
- Dockerfile:38 mkdir /app/uploads; CMD + package.json main/start still -> dist/index.js.

## Next after this: frontend coverage (~3%, no test mounts a page) — its own full pipeline.
## Standing instruction: every commit includes pending .claude/ + AGENTS.md changes, pushed.
