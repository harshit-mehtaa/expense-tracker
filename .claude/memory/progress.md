# Task Progress

## Status: analyze
## Task: Fix cross-source (CSV vs PDF) import dedup failure that let 66 duplicate June
## transactions land in the DB; add a safety-net fuzzy dedup
## Started: 2026-09-09

## Incident summary (already resolved for the user's data):
User manually imported June CSV (71 txns, categorized/SIP-linked over time), then
re-imported the same June statement as PDF. `duplicatesSkipped: 0` — dedup completely
missed it. Root-caused and fixed the DATA: found and soft-deleted exactly the 66
duplicate, uncategorized transactions (all shared identical `createdAt` from the PDF
import's batch insert) via the app's own `softDeleteTransaction` service function (not
raw SQL) — verified 0 duplicates remain and the original 71 categorized transactions are
fully intact afterward. No BankAccount balance was affected (the PDF import was unlinked
to any account, so persistParsedStatement's balance-sync code never ran for it).

## Root cause (verified against real DB rows, both import batches):
1. Description mismatch: parsePDF's block accumulator (importService.ts) always
   prepends the date-line's remainder (a payee-name/type-label ICICI's PDF shows
   separately) to the wrapped narration — e.g. PDF: "Payout MMT/IMPS/616398334211/
   Payout/API Bankin" vs CSV: "MMT/IMPS/616398334211/Payout/API Bankin". Confirmed
   across 20+ real matched pairs: PDF description == "{label} " + CSV description,
   100% consistently. Some PDF narrations also have a stray space inserted mid-token
   where the source PDF visually line-wrapped (pdf.js artifact, not in CSV text).
2. Scope mismatch: makeImportHash includes `accountId ?? userId` as scopeId. The user's
   June CSV import was linked to their ICICI BankAccount; the June PDF import was
   unlinked (no account selected). Different scopeId => different hash regardless of
   description, so these two imports of the same real statement could never have
   matched via the existing exact-hash dedup even if descriptions were identical.

## Decision (established with user): do NOT change makeImportHash's formula (would
silently invalidate every existing transaction's stored importHash, causing the same
duplication bug at large scale on the next re-import of ANY previously-imported
statement, by anyone). Instead: ADD an additive, non-breaking secondary fuzzy-dedup
check in persistParsedStatement — before creating a row, in addition to the existing
exact-importHash check, also look for an existing non-deleted transaction for this
USER (deliberately not scoped by accountId, to catch the linked-vs-unlinked case that
just happened) with the same date+amount+type and a NORMALIZED description match
(strip a redundant leading label prefix via known narration-marker detection, lowercase,
strip all whitespace). Skip creating a duplicate if found; surface via an aggregate
warning, same pattern as the "N dated rows could not be parsed" warning added earlier
today.

## Steps Completed: analyze

## Plan (revised after plan-challenger — verdict NEEDS_WORK, all must_fix resolved):

Architect's approach confirmed sound (suffix-containment matcher, additive fuzzy query
outside the $transaction, fold into duplicatesSkipped + warning) — 4 must-fix defects
found and resolved below, plus 6 should-fix items incorporated.

MUST-FIX resolutions:
1. Date query bug: `date: { in: uniqueDates } }` as exact-instant equality would silently
   never match, because month-name date formats (`new Date("15 Jun 2025")`) parse to
   LOCAL midnight while numeric formats (`new Date("2025-06-15")`) parse to UTC midnight
   — different instants for the "same" calendar day. Resolution: query via UTC day
   RANGES (`OR: days.map(d => ({ date: { gte: d, lt: nextDay(d) } }))`), bucket key =
   UTC ISO date string (`toISOString().slice(0,10)`), matching makeImportHash's own
   existing convention exactly (self-consistent with the exact-hash path; does not fix
   the deeper local/UTC parsing inconsistency itself — that's pre-existing, orthogonal,
   logged as tech debt, out of scope here since the incident's actual dates don't hit it).
2. No forensic trail for suppressed rows: add `console.info('[import] fuzzy duplicate
   skipped', {...matched transaction id, both descriptions, date, amount})` for every
   fuzzy skip, and name the first 2-3 skipped rows' dates/amounts in the warning text
   (not just a bare count) so a future report is diagnosable, not a silent mystery.
3. Route change breaks 4 existing test mocks (`persistParsedStatement` mocked without a
   `warnings` field in route/app tests): use `warnings: [...result.warnings,
   ...(persistResult.warnings ?? [])]` (defensive) AND update all 4 mock sites
   (`import.routes.test.ts` x3, `app.test.ts` x1) to include `warnings: []`.
4. Synthetic cash-leg rows (opposite-type phantom legs from linked-CASH import rows,
   `statementImportService.ts:175-189`) are non-null-importHash, non-deleted, and could
   pollute the fuzzy candidate pool — a phantom EXPENSE leg could wrongly suppress a
   genuine INCOME row. Resolution: exclude `transferPairId: { not: null }` rows from
   fuzzy candidates (synthetic legs always carry one; ordinary imported/manual rows
   essentially never do) — conservative, small recall cost, no false-positive risk.

SHOULD-FIX resolutions:
5. Guard (b) (`dropped-prefix <= shorter.length`) is too permissive for long narrations
   — add an absolute cap (`droppedPrefixLength <= 60`, generous vs. observed 3-8 char
   real labels) in addition to the proportional guard.
6. Fuzzy path is deliberately userId-scoped, not accountId-scoped (that's the whole
   point — it's what catches the incident) — document as an explicit accepted risk in
   a code comment, add a matrix case for cross-account collision.
7. Compare amounts via `Prisma.Decimal.toFixed(2)` string equality (not `round2(Number(
   ...))`) — matches vision.md's "no float for money" rule and matches makeImportHash's
   own `amount.toFixed(2)` convention exactly; round the incoming parsed amount the same
   way before building the query's amount list.
8. Add a bounded `take` (e.g. 2000) on the candidate query — `date IN (...) AND amount
   IN (...)` is a cartesian filter, not paired; guards a heavy user's worst case.
9. Document (code comment only, no schema change) that persisted `BankStatementImport.
   duplicatesSkipped` now includes fuzzy skips, a silent semantic widening for historical
   comparison — not worth a migration for a count column.
10. Add a matrix case + clearer warning wording for "second import all-fuzzy-skips,
    linked account gets nothing attached, balance correctly stays unchanged" (correct
    behavior, but confusing without an actionable warning).
11. Document/test: two new-batch rows fuzzy-matching the same one existing candidate are
    both skipped (consistent with existing exact-path behavior, accepted limitation).

Nice-to-fix (cheap, included): restate the "CSV is a suffix of PDF" invariant precisely
(only holds when the terminator line contributes no trailing text); document that a
restored soft-deleted row is permanently invisible to fuzzy matching (importHash nulled
on delete); update vision.md's "deduplicated via importHash" invariant to mention the
fuzzy layer; use `String(t.type)` at the bucket key to avoid relying on implicit enum
coercion.

## Steps:
1. [LOW] Add `normalizeForFuzzyMatch`/`isFuzzyDuplicate` pure helpers in
   statementImportService.ts: full-whitespace-strip + lowercase; duplicate iff equal OR
   shorter is a suffix of longer, gated by shorter.length >= 12 AND droppedPrefixLength
   <= min(shorter.length, 60).
2. [MED] Add batched fuzzy-candidate query (UTC day-range OR, per must-fix #1), amount
   list built via `.toFixed(2)`, `transferPairId: null` (must-fix #4), `importHash: {
   not: null }`, bounded `take`; bucket by `date|amount.toFixed(2)|String(type)`.
3. [MED] Extend `toCreate` filter: after exact-hash/seenInBatch check, consult the
   bucket via isFuzzyDuplicate; skip + increment fuzzyDuplicatesSkipped + console.info
   (must-fix #2) if matched. Intra-batch stays exact-hash-only (unchanged reasoning).
4. [LOW] Aggregate warning naming first 2-3 skipped rows' date/amount; widen return
   shape with fuzzyDuplicatesSkipped + warnings.
5. [MED] Merge persist warnings into routes/import.ts's response (defensive `?? []`);
   update all 4 existing test mocks.
6. [LOW] Unit tests for the matcher helpers: the 3 real matched pairs, each guard
   (min-length, prefix-cap, non-suffix), a long-narration false-positive probe.
7. [MED] Integration tests for persistParsedStatement per the (now-extended) Cases
   Matrix, fixing the blanket `findMany` mock seam (two call sites now).
8. [LOW] End-to-end incident-reproduction test: CSV-linked batch then PDF-unlinked
   batch with real label-prefixed pairs; assert it now dedupes where it previously
   wouldn't have (this test must fail against the pre-fix code).
9. [LOW] Update vision.md's dedup invariant; add the local/UTC date-parsing
   inconsistency as a new deferred tech-debt entry (found here, pre-existing, out of
   scope).

## Cases Matrix (extended per plan-challenger):
Happy: same-source re-import (exact path only), incident case (CSV-linked→PDF-unlinked),
reverse order, wrap-artifact-only, label-is-itself-a-marker-word.
Sad: genuinely different txn same date/amount/type (must NOT dedupe), manually-edited
description (graceful degradation, no crash), soft-deleted candidate excluded, manual
(importHash:null) transaction excluded, empty transaction list, fuzzy query throws
(propagates before $transaction opens, nothing written).
Edge: Decimal-string amount comparison, day-range bucketing incl. local-vs-UTC-midnight
stored dates, row that's both exact AND fuzzy duplicate (counts once via exact path),
synthetic cash leg excluded from candidates (must-fix #4), fuzzy-skipped CASH row (no
synthetic leg/balance impact), linked-after-unlinked all-fuzzy-skip (balance correctly
unchanged, warning must be actionable), cross-account collision (documented accepted
risk), two new rows matching one existing candidate (both skipped, documented).

## Task Classification: risk_level MEDIUM (additive, no schema/migration, exact-hash
path untouched — but can silently suppress a genuine transaction if the matcher is
wrong, which is a money-correctness bug per vision.md; touches API response contract
and an existing test mock seam).

## Steps Completed: analyze, plan

## Status: implement
## Steps Completed: analyze, plan, approve

## Implementation complete. 66 files / 2503 tests, 100% coverage. tsc clean both sides
(frontend untouched this task). Precision audit against real live DB: 0 false positives
across 256 candidate rows. Incident-reproduction simulation against the real June PDF +
real DB: 48/66 correctly caught as duplicates by the fuzzy net; the 18 misses are ALL
confirmed (spot-checked directly in DB) to be transactions the user had manually renamed
after original import ("Snacks", "Medicine", "Bajaj Finance", "Saving account interest")
— the documented, unavoidable graceful-degradation limitation, not a bug.

## Status: review

## Round 2 (quality + adversarial in parallel): quality FAIL, adversarial DESTROYED.
Co-Founder Filter:
ACCEPTED and fixed:
- Quality's "High": UTC day-range doesn't sidestep the local-vs-UTC date-parsing bug —
  CHALLENGED the severity (verified the actual backend only ever runs in a UTC Docker
  container, no TZ override anywhere; my own incident-reproduction test had already
  empirically shown 48/66 correct matches against real production-equivalent logic,
  directly contradicting "silently defeats the fix") but AGREED the underlying code
  fragility was real and worth fixing properly rather than relying on a deployment
  assumption. Fixed the root cause: parseBankDate/parsePDFDate's month-name branches now
  build UTC midnight explicitly (parseUTCDateFromDayMonthYear), not process-local
  midnight. Verified by re-running the FULL backend suite under TZ=Asia/Kolkata (the
  exact adversarial condition both reviewers used) — 2514/2514 pass.
- Adversarial's critical #1: `transferPairId: null` excluded REAL linked-CASH statement
  rows, not just synthetic legs (verified directly in code — the real row gets the same
  pairId). Fixed: look up the user's cash-account id once, exclude candidates by
  bankAccountId instead.
- Adversarial's critical #3: FUZZY_MIN_MATCH_LENGTH was bypassed on the exact-equality
  path (`normA === normB` returned true regardless of length). Fixed: guard applies on
  both paths now.
- Quality medium: many-to-one match (one existing row could absorb multiple new rows) —
  fixed via a consumed-candidate-id set.
- Quality medium: unbounded query truncation with no signal — fixed via orderBy +
  truncation warning.
- Quality medium: unbounded/PII-bearing forensic logging — capped at 20, description
  truncated to 40 chars in logs (matchedId is enough to look up the full row).
- Adversarial medium (blast radius): 3 stale route/app test mocks — updated all 3,
  removed the now-unnecessary `?? []` defensive fallback, added a route-level test
  proving persist warnings actually reach the HTTP response (previously untested despite
  100% coverage — coverage was measuring the fallback path, not the real merge).
- Quality low: two weak tests (max-prefix-cap not actually exercised; "different day"
  test was tautological, asserting a stubbed mock not real query behavior) — rewrote
  both to be genuinely discriminating.
Declined: none — every must/high finding from both reviewers was either fixed or its
severity was directly challenged with executable counter-evidence, not just asserted.

## Final state: 66 files / 2514 tests, 100% coverage, verified under both default TZ
and TZ=Asia/Kolkata. Precision audit against real live DB (260 candidates, cash-account
rows excluded): 0 false positives, confirming the transferPairId fix didn't introduce any
regression. tsc clean.

## Steps Completed: analyze, plan, approve, implement, review
