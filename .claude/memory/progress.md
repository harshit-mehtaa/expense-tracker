# Task Progress

## Status: review
## Task: Tax summary — tax profile should be editable
## Started: 2026-09-06

## Approach: Bugfix (edit capability already existed). Root cause: raw `values: profile
?? {}` hydration + cityType schema rejecting legitimate server null + zero error
surfacing. Fixed: hydration mapper (compile-enforced exhaustive via
Record<keyof ProfileForm,unknown>), cityType preprocess, blank option + superRefine,
form-level error banner (role=alert), onSuccess reset. NOT resetOptions:
{keepDirtyValues:true} — tried, found to cause a real cross-member data leak (see below),
reverted.

## Review: quality FAIL (1 HIGH), adversarial RESILIENT (conflicting verdicts on the
same finding). Resolved via my OWN fresh reproduction, not by trusting either reviewer:
wrote a real test with a production-matching QueryClient (staleTime 5min/gcTime 10min,
matching lib/queryClient.ts) and CONFIRMED the HIGH finding — with both members' profiles
pre-warmed in cache, an edited-but-unsaved field for self was shown as AND posted to a
different member after a selector switch. The standard test harness's gcTime:0 masks
this (adversarial reviewer's refutation used that harness, hence missed it). Fixed by
removing keepDirtyValues entirely rather than trying to scope it correctly (attempted a
targeted reset-on-identity-change effect first; it did NOT fully close the leak on
retest — dropping the option outright did). Added a permanent regression test; extended
renderPage() with optional gcTime/staleTime overrides to make it testable. Verified the
fix by reverting and confirming red, then restoring.

Also fixed: architecture.md documented the bug as still present (quoted deleted code) —
corrected; also restored concrete symbol names an earlier same-session compression had
dropped (npm run prisma:backfill-cash, authService.createUser, balanceImpactApplied,
etc.) per adversarial's drive-by finding. Mapper exhaustiveness gap (P3 bug-pattern class)
closed via Record<keyof ProfileForm,unknown> typing — verified a missing field now fails
tsc. Added the missing positive-path test (cityType round-trips correctly — no prior test
would have caught it being silently dropped). Added role="alert" to the banner.

Declined (documented, not blocking): per-field label prefixes in banner messages, dup
inline+banner cityType error, htmlFor on the other 10 unlabeled fields, backend
route.tax.ts hardening (adversarial's own reasoning: current strictness is correct).

1028/1028 tests pass post-fix (was 1021 baseline + 7 new), tsc/lint/build clean, coverage
94.09/76.15/55.55/94.09 well above floor.

## Steps Completed: analyze, plan, approve, implement, review
