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
