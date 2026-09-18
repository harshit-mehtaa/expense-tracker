# Task Progress

## Status: plan
## Task: Audit + unify chip/badge colors across the product (consistent, distinct-per-
## category scheme, applied everywhere applicable)
## Started: 2026-09-18

## Research findings (researcher agent, full inventory retained in conversation):
- No shared Badge/Chip component exists anywhere (src/components/ui/ has no badge.tsx).
  Every chip in 15+ files is hand-rolled `<span className="rounded-full ...">`.
- Already color-coded (keep, don't reinvent): ACCOUNT_TYPE_COLORS (Accounts.tsx:19-26),
  PAYMENT_MODE_COLORS (Transactions.tsx:258-267), STATUS_STYLE (Subscriptions.tsx:48-52),
  policyColor() (Insurance.tsx:73-79), statusClasses() (Investments.tsx:501-516 — FD/RD/
  SIP lifecycle status, the most reusable "status" convention), TYPE_STYLES
  (Categories.tsx:764-769 — canonical INCOME/EXPENSE/ASSET/LIABILITY palette),
  badgeColors (TaxCalendarTab.tsx:81-85), MemberBadge/BankAccountBadge (Transactions.tsx).
- Category.color is a separate, already-complete, DB-backed per-category system
  (backend/src/utils/categoryStyle.ts) — hex-based inline style, NOT a Tailwind chip map.
  Leave alone; don't touch.
- NOT color-coded (every value same flat color — the actual bug): Loans.tsx loan type
  (L401, flat orange), Assets.tsx asset/vehicle/fuel type (L260/264/269, flat slate),
  RealEstate.tsx property type (L257, flat blue), Gold.tsx gold type (L169, flat yellow),
  Investments.tsx investment type (L635, flat muted), Transactions.tsx MOBILE card's
  category chip (L2878, flat gray — ignores category.color that the SAME page already
  uses correctly elsewhere).
- Real semantic CONFLICT found (not just missing color): tax regime (OLD/NEW) colored
  differently in FYHistoryTab.tsx:105 (OLD=blue, NEW=purple) vs ITR2Summary.tsx:58
  (OLD=blue, NEW=amber). Same value, two different colors on two pages.
- No theme-level semantic palette exists (tailwind.config.ts has only shadcn tokens +
  3 decorative brand colors). CHART_PALETTE (chartUtils.tsx) is hex/inline-style for
  charts, not Tailwind classes for chips — different consumption pattern.
- Transactions.tsx desktop has 4 more hardcoded single-purpose flat chips (Refund=amber,
  Policy=cyan, Transfer=blue, Refunded=amber-50) duplicated separately in a mobile block.

## Design Questions:
DQ1. Build a new shared Badge/Chip component (src/components/ui/badge.tsx) as the
single implementation point, or keep each page's hand-rolled span but centralize just
the COLOR MAPS in a shared module? Evidence: zero existing Badge primitive
(researcher confirmed exhaustive grep of components/ui/); 15+ files each duplicate the
same `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium` boilerplate,
with inconsistent dark-mode coverage (ACCOUNT_TYPE_COLORS has none, PAYMENT_MODE_COLORS
does) — a real second inconsistency beyond color itself.

DQ2. For each of the 6 "not yet color-coded" locations, what's the actual palette —
brand-new per-file maps, or extend/reuse an existing convention? Evidence: TYPE_STYLES
(Categories.tsx) is the only palette keyed on values (INCOME/EXPENSE/ASSET/LIABILITY)
that recur verbatim elsewhere (Investments.tsx type badges are a DIFFERENT enum -
InvestmentType: STOCKS_INDIA/MUTUAL_FUND/etc - not literally INCOME/EXPENSE, so may need
its own new map, not reuse). statusClasses() (Investments.tsx) is a reusable STATUS-shape
template (ACTIVE/PAUSED/CLOSED-family/BROKEN) that Loans.tsx's flat "Closed" text badge
could inform, but Loans doesn't currently have a multi-value STATUS enum chip - it has a
LOAN TYPE enum chip (HOME/CAR/PERSONAL/etc), a different axis.

DQ3. How to resolve the tax-regime color conflict (FYHistoryTab vs ITR2Summary)? Evidence:
two independent inline ternaries, no shared source — evidence above (frontend/src/pages/
tax/FYHistoryTab.tsx:105, ITR2Summary.tsx:58). Must pick ONE and apply to both.

DQ4. Should Transactions.tsx's 4 duplicated hardcoded chips (Refund/Policy/Transfer/
Refunded, desktop L2741-2767 + mobile L2861-2878) be extracted into one shared render
path as part of this task, or left alone (out of stated scope, since "flat gray
inconsistency" complaint is about TYPE chips, not these correctly-colored-but-duplicated
ones)? Evidence: these ARE already individually colored (not the "flat gray" bug), just
duplicated — a different, adjacent problem (DRY, not color consistency).

## Verification Questions:
VQ1. Does every one of the 6 newly-color-coded locations actually render distinct colors
per value (not all values collapsing to the same color by an off-by-one map bug)?
VQ2. Do both tax-regime chips (FYHistoryTab, ITR2Summary) now show identical colors for
OLD and for NEW?
VQ3. Does dark-mode class coverage become consistent across every touched map (no map
left with only light-mode classes while siblings have dark: variants)?
VQ4. Are all touched pages' existing tests (Accounts, Transactions, Loans, Assets,
RealEstate, Gold, Investments, Insurance, Subscriptions, Categories, FYHistoryTab,
ITR2Summary) still green — className changes shouldn't break text-content assertions,
but some tests may assert exact className strings and need updating.

## Steps Completed: analyze

## Plan (architect, risk=MEDIUM, type=refactor): centralize only 7 NEW color maps +
## unified REGIME_COLORS into frontend/src/lib/chipColors.ts (NOT a new Badge component —
## smaller diff, matches the literal "color consistency" ask). Verified against actual
## schema.prisma enums (corrected researcher: InvestmentType has 12 values incl CRYPTO/
## OTHER, not 10; also corrected: Transactions.tsx desktop does NOT render a colored
## category chip at all — mobile gap is a genuine new feature, not a mobile/desktop
## mismatch). 10 steps: chipColors.ts module (w/ hand-assigned disjoint hues per
## co-occurring page, documented) -> Loans/RealEstate/Gold/Investments single-map swaps
## -> Assets.tsx 3-map collision-sensitive swap -> ITR2Summary regime unification onto
## FYHistoryTab's (more complete, dark-mode-covered) convention -> Transactions.tsx mobile
## category chip via categoryId->color useMemo + inline style (matches Categories.tsx's
## existing ${color}22 translucent pattern) -> test updates -> lint+coverage+manual
## visual spot-check gate. Explicitly OUT OF SCOPE (Co-Founder judgment, needs sign-off):
## Transactions.tsx Refund/Policy/Transfer/Refunded chip DRY duplication (already colored
## correctly, just duplicated - different problem class). No backend changes needed.
## Steps Completed: analyze, plan (pre-challenge)

## Plan-challenger verdict: NEEDS_WORK (2 must_fix, 3 should_fix) — resolved:
- MUST FIX 1 (ACCEPTED): Transactions.tsx "Refunded" indicator is plain unstyled amber
  text on desktop (~2775) but a proper dark-mode chip on mobile (~2871) — exactly the bug
  this task fixes, was about to be wrongly excluded under the "already correct, DRY-only"
  Q4 umbrella. NEW narrow step 4b added: give desktop's Refunded indicator the same chip
  treatment as mobile (reuse identical amber tokens) — does NOT touch Refund/Policy/
  Transfer blocks, stays narrowly scoped.
- MUST FIX 2 (ACCEPTED): step 8's dynamic per-category hex chip had no defined foreground
  color or dark-mode plan. RESOLVED: background stays `${color}22` (13% opacity, matches
  Categories.tsx precedent), foreground uses theme-aware `text-foreground` (CSS variable,
  already adapts light/dark) instead of a computed-luminance text color — avoids both the
  contrast risk AND a new luminance-calculation dependency for a minor chip.
- SHOULD FIX (all ACCEPTED): step 9 reworded to explicitly split "update" (6 pages with
  existing tests) vs "create new" (ITR2Summary.test.tsx, FYHistoryTab.test.tsx don't exist
  yet); ACCOUNT_TYPE_COLORS' missing dark-mode classes folded into the plan as a new LOW
  step now (not deferred); Q3's grep citation corrected to case-insensitive with the two
  card-border (non-chip) regime files noted explicitly, not silently omitted.
- NICE TO FIX (flag only, not fixing): pre-existing unreachable dead-code ternary branch
  in Transactions.tsx desktop Transfer rendering (~2765) — will flag in commit message.

## Final plan: 12 steps — chipColors.ts (7 new maps + REGIME_COLORS + hue-collision doc)
## -> Loans/RealEstate/Gold/Investments single-map swaps -> Assets.tsx 3-map swap ->
## ITR2Summary regime unification -> Transactions.tsx mobile category chip (bg ${color}22
## + text-foreground) -> Transactions.tsx desktop Refunded chip parity fix -> 
## ACCOUNT_TYPE_COLORS dark-mode classes -> test updates (update existing 6 + create 2
## new + extend Transactions.test.tsx for both new chips) -> lint+coverage+visual gate.
## Steps Completed: analyze, plan

## REVIEW: quality reviewer verdict PASS_WITH_NOTES. Co-Founder Filter: (1) ACCEPTED —
## 4 tests only checked "different colors" not exact hue, strengthened to match the
## stronger pattern already used in FYHistoryTab/ITR2Summary tests. (2) DECLINED — flagged
## ACCOUNT_TYPE_COLORS not centralized into chipColors.ts; this was an explicit, already-
## approved plan decision (leave existing maps in place), not an oversight. (3) ACCEPTED_
## NO_ACTION — inline-style CSS from Category.color mirrors an existing shipped pattern
## with server-side hex validation, not a new risk. (4) IMPORTANT: reviewer's "scope
## creep" flag on Assets.tsx (3-section grouping, tab rename) is NOT from this task — it's
## LEFTOVER UNCOMMITTED WORK from 2 EARLIER tasks this session (git diff conflated
## everything in the working tree). Must commit as SEPARATE commits at COMMIT phase, not
## bundled into the chip-color commit.
## Final: 1083/1083 tests, 100% coverage on new chipColors.ts, tsc/lint clean.
## Steps Completed: analyze, plan, approve, implement, review
## Current Step: none — entering COMMIT phase (multi-task uncommitted state — split by task)
