# Task Progress

## Status: analyze
## Task: PDF bank statement import fails — "No transactions parsed" for a real ICICI PDF
## Started: 2026-09-08

## REVISED DIAGNOSIS (2026-09-08, after user supplied the real failing file)
Earlier diagnosis (multipart boundary / axios Content-Type) was WRONG — see errors.md,
disproven by the architect agent reading the actually-installed axios 1.13.6 (not the
1.6.7 range in package.json). User confirmed the real on-screen error is
"No transactions parsed. Errors: No transactions found in PDF..." (importService.ts:718)
— this is a PDF PARSING failure, not a transport failure. The request reaches the
backend and pdf-parse extracts text fine (>50 chars, so it's not the "no extractable
text"/scanned-PDF path either); zero lines match the transaction-row regexes.

Root cause, confirmed by running the REAL installed `pdf-parse` against the user's actual
file (`~/Downloads/OpTransactionHistory16-08-2026_july.pdf`, an ICICI Bank statement —
confirmed via footer "www.icici.bank.in"):
1. Dates are formatted `DD.MM.YYYY` (dot separator) — NOT in `PDF_DATE_PATTERNS`
   (importService.ts:487-493), which only covers `/`, `-`, ISO, and space/dash + 3-letter
   month. Zero patterns use `.` as a separator.
2. Every transaction line is prefixed with a serial number, e.g. `"8 01.07.2026 HEENAKOUR"`
   — `PDF_DATE_PATTERNS` are all anchored `^` at the literal start of the line, so even a
   correct date pattern would still fail to match because of the `"8 "` prefix.
3. Rows are wrapped across MULTIPLE lines by pdf-parse's text extraction: the date+payee
   name is on line 1, the UPI narration wraps across 2-4 continuation lines with NO date
   or amount, and the transaction amount + running balance appear together as a trailing
   two-number line with NO date. Confirmed structurally: 66 date-prefixed lines, 63
   trailing lines matching exactly 2 decimal numbers (amount, balance) — i.e. amounts are
   never on the same line as the date for this bank's export. The current per-line loop
   (`for (let i = 0; i < lines.length; i++)`, importService.ts:659) requires date AND
   amount on the SAME line, so every single row is skipped.

This is a real, generalizable parser gap (not this-user-only): the parser's one-line-per-
transaction assumption does not hold for at least this bank's PDF export layout, likely
others too (statement layout varies a lot bank-to-bank/product-to-product). Fixing
requires: (a) a `DD.MM.YYYY` date pattern, (b) tolerating a leading serial-number token
before the date, (c) accumulating a variable number of lines per transaction (from one
date-line to the line before the next date-line) before extracting description/amounts,
instead of requiring both on one line.

Sample structure (payee names/refs already synthetic-looking merchant strings, no PII of
concern, but keep any further examples in memory/logs generic — don't paste raw account
numbers or balances into shared files):
```
8 01.07.2026 HEENAKOUR
UPI/HEENAKOUR/9356398456-2@i/parking/BANK
OF
BA/654854995465/ICIe6faa46fb40b49f191871730
e745071e/
40.00 683783.52
```
(serial-no + date + payee) / (wrapped narration, 2-4 lines) / (amount + balance, no date)

## Plan (revised after plan-challenger — verdict NEEDS_WORK, all must_fix resolved below):

Architect's original 4 gaps (A: no DD.MM.YYYY pattern, B: `^`-anchored patterns break on
a leading serial-number token, C: multi-line rows — date/payee on one line, amount+balance
on a later line with no date, D: `extractAmounts`'s `\d{1,3}` can't match ungrouped 4+
digit rupee amounts, silently dropping/mis-extracting most real ICICI rows) are correct,
independently confirmed by plan-challenger. But challenger found the fix as drafted was
unsafe — findings and resolutions below.

MUST-FIX resolutions (from plan-challenger, all incorporated):
1. Amount regex is duplicated at importService.ts:683 (`firstAmtPos` computation) as well
   as :571 (`extractAmounts`) — factor into ONE shared regex source, use in both places.
2. The widened amount regex must NOT run unconditionally on every line/bank — challenger
   proved it creates false-positive amounts from reference-number tokens (e.g.
   "NEFT-N123456789-1234.00"), which for an unknown/GENERIC bank would silently persist a
   bogus transaction (no preview/undo exists — see #6). Resolution: widened regex is used
   ONLY as a fallback — inside the block accumulator (new code, unreachable by existing
   layouts) and, in `extractAmounts`, only invoked when the ORIGINAL narrow regex found
   zero matches on that line. Any line that already extracts fine today is byte-for-byte
   unaffected. This makes the "new path is unreachable by construction for existing
   layouts" risk justification actually true (it wasn't, in the original draft).
3. Balance-delta reconciliation needs a statement-ordering precondition and uniqueness
   check — challenger showed a descending-date statement with two consecutive equal
   amounts reconciles with an INVERTED sign. Resolution: (a) detect date ordering across
   already-matched rows before enabling delta inference — only apply when dates are
   non-decreasing; (b) require the reconciled match to be unique (exactly one candidate
   within 0.005) among that row's candidate amounts; (c) if delta and a keyword hit
   disagree, prefer the keyword and add a `warnings` entry rather than silently
   overriding — delta is a strong-but-not-absolute signal, not an oracle.
4. `prevBalance` lifecycle must be precise, not "reset on any skip" (which fires on every
   header/footer line and would make delta inert on real multi-page statements).
   Resolution: set `prevBalance` only when a row yielded >= 2 amounts (from the last, the
   balance); reset only when a DATE-MATCHED row is subsequently abandoned (no terminator
   found) — a plain non-date header/footer line does not touch `prevBalance` at all.
5. Terminator regex must reject: 3-column zero-balance renders (`"5000.00 0.00 bal"` —
   don't let a stray `0.00` become the "amount"), embedded reference numbers
   (`"REF12345.00 683783.52"`), and glossary/footer blocks (`"Legends: 1.00 2.00"`).
   Resolution: terminator must be a numeric-tail-only line (no alphabetic content after
   the last amount token, using the same guarded token regex as #1); bail out early on
   lines matching `/^(legends?|note|disclaimer|page \d)/i`; when 3+ trailing amount
   tokens are present, drop zero-valued candidates and pick the transaction amount by
   balance-delta reconciliation among what's left, last token is always balance.
6. No preview/bulk-undo exists for PDF import (`routes/import.ts` persists in the same
   request via `persistParsedStatement`, which mutates `bankAccount.currentBalance`
   atomically; only per-row `DELETE /:id` exists, no bulk reversal). Building a full
   dry-run/preview mode is real scope creep for this bugfix. Resolution: rely on #2's
   fallback-only gating to keep existing layouts provably untouched, and log the
   preview/bulk-undo gap to vision.md's tech-debt inventory as a follow-up — flagged to
   the user at APPROVE, not silently dropped.

SHOULD-FIX resolutions:
- Apply the optional serial-prefix group ONLY to the new DD.MM.YYYY pattern, not all 5
  existing patterns — avoids truncating a block-accumulator lookahead early on a
  narration continuation line shaped like "1234 05/07/26 desc".
- Serial prefix widened to `\d{1,6}\s+` (not `\d{1,4}`).
- Step 7 (real-file validation) also asserts: sum(INCOME) - sum(EXPENSE) reconciles with
  closing-minus-opening balance (one invariant catching both wrong amounts AND wrong
  signs), and zero descriptions contain a leftover `\d+\.\d{2}` token.
- Steps run strictly sequentially (1→2→3→4→5/6→7), not parallelized — step 3/4 depend on
  step 2's shared regex constant existing first.

## Steps:
1. [LOW] Widen PDF_DATE_PATTERNS: add DD.MM.YYYY with optional `\d{1,6}\s+` serial prefix
   (prefix ONLY on this new pattern); widen parsePDFDate's DD-MM-YYYY arm separator to
   `[-.]`. (importService.ts:487-530)
2. [MED] Factor amount-token regex into one shared constant; original narrow form stays
   the default; add a widened ungrouped-digit fallback variant
   (`(?<![\w.,\-\/])(\d+(?:,\d{2,3})*\.\d{2})(?![\w.,])`) used ONLY when the narrow form
   finds zero matches on a given line/description-split. Apply to both extractAmounts
   (:571) and the description-split search (:683). (importService.ts:569-578, 683)
3. [MED] Add multi-line block fallback in parsePDF's loop: when a date line matches but
   yields zero same-line amounts, look ahead up to 6 lines for a terminator (numeric-tail
   -only line via shared regex, no alphabetic content after last amount, bails out on
   legend/footer patterns, drops zero-valued candidates among 3+ trailing tokens), stops
   early at the next date-matching line; builds description from accumulated
   non-terminator lines; advances loop index past the terminator on success, `continue`
   unchanged on failure. (importService.ts:659-713)
4. [MED] Add reconciled balance-delta direction inference: date-ordering precondition,
   uniqueness requirement, keyword-disagreement deference with a warnings entry,
   precise prevBalance lifecycle per must-fix #4. Wired as the first check in
   inferTransactionType's call site, above keyword/positional. (importService.ts:542-560
   + parsePDF loop state)
5. [LOW] Add realistic multi-line ICICI fixture (serial prefix, dot-dates, wrapped
   narration, footer/glossary tail, a 3-column zero-balance row, a reference-number token
   shaped like a false-positive amount) + correctness tests in
   backend/src/__tests__/importService.test.ts (NOT importServicePdfApi.test.ts).
6. [LOW] Negative/branch-coverage tests: no terminator within 6 lines; non-reconciling
   delta; descending-date statement (delta must NOT engage); first row (no prevBalance);
   footer/legend-only tail; reference-number false-positive rejected by #2's gating.
7. [LOW] Validate against the user's real file
   (~/Downloads/OpTransactionHistory16-08-2026_july.pdf): assert transaction count, type
   distribution, INCOME-minus-EXPENSE reconciles with closing-minus-opening balance, zero
   descriptions with a leftover amount-shaped token. Counts/structure only, no
   account numbers or balances in any output.
8. [LOW] Log the "no PDF-import preview/bulk-undo" gap to vision.md's tech-debt inventory
   (per must-fix #6) — a follow-up, not blocking this fix.

## Verification Question Mapping:
VQ1 (real file parses correctly) -> step 7
VQ2 (HDFC/SBI/other layouts unregressed) -> step 2's fallback-only gating (byte-identical
  on any line the narrow regex already matches) + existing suite + step 5/6
VQ3 (debit/credit direction correct, incl. descending-date safety) -> steps 4, 6, 7
VQ4 (100% branch coverage maintained) -> steps 5, 6
VQ5 (glossary/footer/reference-number text excluded) -> steps 2, 3, 6

## Task Classification: risk_level MEDIUM (money-amount/direction extraction, but new
behavior is fallback-gated so existing layouts are provably byte-identical; bounded by
CI-enforced 100% coverage + real-file validation). task_type: bugfix.

## Steps Completed: analyze, plan

## Design Questions:
DQ1. What causes the upload to fail, and is it PDF-specific?
Evidence: `frontend/src/pages/Transactions.tsx:960-963` — `ImportModal`'s `importMutation`
posts a `FormData` to `/transactions/import` with `headers: { 'Content-Type':
'multipart/form-data' }` explicitly set, with NO `boundary` parameter. Reproduced against
the real `multer`/`express` stack (same versions as `backend/node_modules`): a request
with this exact header and a `FormData` body gets `400 {"error":"Multipart: Boundary not
found"}` from multer; the same request with NO Content-Type header set (letting the
browser auto-generate `multipart/form-data; boundary=...`) succeeds
(`gotFile: true`). The header override wraps BOTH CSV and PDF uploads unconditionally
(no `isPDF` branch around it) — this is not PDF-specific, CSV import is equally broken.
This is not new: `git log -S "multipart/form-data" -- frontend/src/pages/Transactions.tsx`
shows the line was present since the very first commit (`fa1a40f`), so import has never
actually worked from a real browser.

DQ2. Why wasn't the header simply omitted in the first place — is there a reason it's set?
Evidence: `frontend/src/lib/api.ts:37-39` — the shared `api` axios instance sets a
DEFAULT header `'Content-Type': 'application/json'` on every request. Axios's
`transformRequest` (`node_modules/axios/lib/defaults/index.js:42-54`): for a `FormData`
payload, if the effective Content-Type contains `application/json`
(`hasJSONContentType`), it calls `JSON.stringify(formDataToJSON(data))` instead of
sending the FormData — i.e. if the header were simply deleted from the per-call config,
the instance default `application/json` would still apply and axios would silently
JSON-stringify the FormData, losing the file entirely (worse than the current bug). So
the override is necessary in intent, just wrong in value.

DQ3. What is the correct fix?
Evidence: `AxiosHeaders.toJSON()` (`node_modules/axios/lib/core/AxiosHeaders.js:254-261`)
filters out any header whose value is `!= null` — so `headers: { 'Content-Type':
undefined }` in the per-call config never reaches `xhr.setRequestHeader()`
(`node_modules/axios/lib/adapters/xhr.js:155-158`), while still overriding (per
`AxiosHeaders.set()`, `AxiosHeaders.js:81-99`, rewrite semantics) the instance's
`application/json` default for this one call. Net effect: no Content-Type header is set
on the XHR at all, so the browser auto-generates the multipart boundary — exactly the
passing case in the repro. This is the standard, minimal fix: change
`'Content-Type': 'multipart/form-data'` to `'Content-Type': undefined` at
`Transactions.tsx:961`.

DQ4. Why did the test suite never catch this?
Evidence: `frontend/src/__tests__/pages/Transactions.test.tsx:858` — MSW's
`http.post(url('/transactions/import'), () => HttpResponse.json(...))` intercepts the
request by URL/method only; MSW never validates the Content-Type header or parses the
multipart body, so this entire bug class is invisible to the existing test. Backend
`import.routes.test.ts` / `importServicePdfApi.test.ts` test `parsePDF`/the route directly
with a correctly-formed multipart body (via supertest, which sets its own correct
boundary), so they never touch axios's client-side header logic either. No existing test
exercises the real frontend HTTP layer end-to-end.

## Verification Questions:
VQ1. Does the fix apply uniformly to CSV import too (not just PDF), since both share the
same `importMutation`? — maps to a manual/code check that the header change is not
PDF-gated.
VQ2. Does removing the explicit header break the `pdfPassword`/`bankAccountId`/`bank`
fields still being sent as regular FormData fields (unaffected by Content-Type, but worth
confirming no other code path depends on the exact header string)?
VQ3. Is there a regression test that would have caught this, and can one be added given
MSW's inability to inspect multipart bodies (i.e. a lower-level fetch/XHR-level test)?

## Steps Completed: analyze

## Baseline Failures: none — 66 files / 2452 tests passing, 100% coverage (backend), before any edits
## Steps Completed: analyze, plan, approve

## Regression Test Run: 66 files / 2472 tests passing (2452 baseline + 20 new), 100% coverage
## Real-file Validation: both OpTransactionHistory16-08-2026_july.pdf and _june.pdf parse
  to 66 transactions each, 0 errors, 0 balance-reconciliation mismatches across all
  transitions, 0 leftover-amount-in-description issues.
## Deviation from approved plan (evidence-based, found during IMPLEMENT):
  Flipped delta-vs-keyword disagreement precedence — plan said keyword wins, but the two
  actual disagreements in the real file (FD-narrated-as-"Deposit", salary NACH credit)
  both showed the reconciled delta was right and the keyword was wrong. Delta now wins,
  keyword-vs-delta disagreement still surfaced via a warning.
## Also fixed during IMPLEMENT (bugs in my own first-pass code, caught via real-file
  validation, not part of the original plan): (1) block-accumulator terminator scan was
  using narrow-first amount matching, silently dropping the balance column on lines that
  mix a narrow-fitting and a wide-only amount — fixed by scanning terminator lines with
  the wide regex directly. (2) redundant "drop zero-valued candidates" logic was dead
  code (scanAmountTokens already excludes val=0) — removed rather than faked for coverage.
## Steps Completed: analyze, plan, approve, implement

## Status: review

## REVIEW outcome (Tier 2: quality [strong] + adversarial [balanced], parallel; 1 targeted
## verification pass after fixes)
Round 1 (quality + adversarial in parallel): quality reviewer FAIL, adversarial DESTROYED.
Both stalled once and were relaunched successfully.
Co-Founder Filter — ACCEPTED and fixed: descending-statement same-date direction
inversion (A2); phantom transactions from dated summary/opening-balance lines (A3);
makeImportHash dedup-hash drift from zero-token description-boundary change (A4);
silent row drops with no user-visible signal (P8, both reviewers) — now an aggregate
warning; selectAmountForType inconsistency in the final default-EXPENSE branch; stale
extractAmounts/inferTransactionType comment references; misleading "unaffected by this
change" comments (resolveTransaction is actually global, not layout-gated); vision.md
eviction of open (not closed) cash-account debt items — restored.
ACCEPTED_DEFERRED (logged to vision.md, not fixed — real scope beyond this bugfix):
overdraft/negative and Cr-Dr-suffixed terminator amounts unsupported.
DECLINED: AMOUNT_RE_WIDE rejecting "Rs.1234.00"-style prefixed amounts (pre-existing
limitation, not a regression, out of format scope); resolveTransaction's param-count/
warnings-out-param style smell (functionally correct, not worth the churn this pass).

Round 2 (targeted verification of the round-1 fixes): verdict NEEDS_WORK — 3 of 5 fixes
had residual gaps, all with constructed counterexamples:
- A2 fix used first-vs-last date comparison — fooled by a single non-transaction dated
  header/footer line, and defaulted an all-same-day statement to "ascending" (re-enabling
  the exact inversion). FIXED: switched to a majority-vote over every consecutive dated
  pair, defaulting to disabled (fail-safe) on any tie.
- A3 fix's `<2`-amounts threshold still accepted a two-amount summary line (e.g. "TOTAL
  WITHDRAWALS X TOTAL DEPOSITS Y"), and its own test didn't actually exercise the guard
  it named (input had zero amounts, not one). FIXED: added SUMMARY_LINE_RE keyword guard
  (opening/closing balance, total, brought/carried forward) checked before amount
  scanning, skipped like a future-date artifact (no drop-count increment); fixed the
  vacuous test and added a dedicated two-amount-summary-line test.
- AMOUNT_RE_WIDE's guard character class omitted `/` (the dominant separator in Indian
  UPI/NEFT narration), so a reference-number fragment adjacent to `/` could still hijack
  the amount on tier-escalated lines. FIXED: widened the lookbehind/lookahead class to
  `[\w.,\-/:#|()*]`.
- P8's aggregate warning fired spuriously on every statement containing an opening-
  balance line (routed through the block accumulator by the A3 guard, which then
  correctly found no terminator and counted it as "dropped"). FIXED: the SUMMARY_LINE_RE
  pre-check above resolves this too — summary lines are skipped before reaching either
  the amount-routing or the drop-counting logic.
Residual, explicitly deferred (documented in vision.md, not fixed): on a single line
mixing a narrow-fitting decimal with a real ungrouped amount, tier escalation can still
pick the wrong token — requires column-position-aware parsing to close properly; no
evidence this shape occurs in either real ICICI export checked.

## Final validation after all fixes: 66 files / 2482 tests, 100% coverage. Real files:
July 66/66 txns, 0 errors, 0 balance mismatches, 0 leftover-amount descriptions.
June 66/71 (5 dropped rows now correctly surfaced via warning — pre-existing pdf.js
mid-digit line-split on large corporate-scale amounts, documented, deferred), 1 residual
balance mismatch (same root cause).

## Steps Completed: analyze, plan, approve, implement, review

## Status: idle
## Last Task: Fix ICICI multi-line PDF bank statement import
## Last Completed: 2026-09-09
## Steps Completed: all
