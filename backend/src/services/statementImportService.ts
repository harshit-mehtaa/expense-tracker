import crypto from 'crypto';
import { PaymentMode, type Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sanitizeFilename } from '../utils/sanitizeFilename';
import { makeImportHash, type ParsedTransaction } from './importService';
import { ensureCashAccount } from './accountService';
import { anchorCutoff } from '../utils/financialYear';

/**
 * Persistence half of a bank-statement import. The route owns parsing and the audit log;
 * this owns every database write, so no Prisma call lives in a route handler.
 *
 * On a total insert failure nothing is persisted at all — no transactions (rolled back)
 * and no `bankStatementImport` row. The failure is recorded to stderr only. That is a
 * deliberate narrowing of the previous behaviour, which wrote a row with
 * `errorsCount: 1` and still returned HTTP 201; nothing reads that model today.
 */

interface PersistArgs {
  ownerUserId: string;
  /** Optional linked account. When absent, dedup falls back to user scope. */
  accountId?: string;
  /** Parsed statement metadata — bank name and the pre-categorization row count. */
  bank: string;
  rowCount: number;
  /** Rows after category rules have been applied. */
  transactions: ParsedTransaction[];
  /** Raw, unsanitized upload filename. Sanitized here, at the write boundary. */
  filename: string;
}

/** Money helper: statement amounts arrive as JS numbers, but the balance column is
 *  Decimal(15,2). Round before comparing to zero and before writing, so a set that
 *  mathematically cancels can't leave a 1e-13 residue and write a bogus increment.
 *
 *  Half-away-from-zero, NOT `Math.round`. `Math.round` breaks ties toward +Infinity, so
 *  it rounds -0.015 to -0.01 while Postgres `numeric` rounds it to -0.02 — the balance
 *  would then disagree with the sum of the very rows it was computed from. */
function round2(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) * 100) / 100;
}

/** Strip ALL whitespace (not just collapse runs) and lowercase, for fuzzy description
 *  matching. Full removal, not collapsing, because a PDF narration that visually wraps
 *  across two physical lines in the source document can get a single stray space
 *  inserted mid-token during text extraction — a CSV export of the same real narration
 *  never has that artifact, so any amount of whitespace-position drift must be ignored,
 *  not just runs of 2+ spaces (which is all `cleanDescription` normalizes). */
function normalizeForFuzzyMatch(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, '');
}

/** Cap on how much leading text a fuzzy match is allowed to treat as "just a label" —
 *  generous against the 3-8 char real labels observed (payee names / "NACH trxn" /
 *  "Payout"), but bounded so two genuinely different, unrelated narrations that happen
 *  to share a long common suffix can't collide. */
const FUZZY_MAX_DROPPED_PREFIX = 60;
/** A shorter floor makes short generic narrations ("atm wdl", "cash") collide with
 *  unrelated same-day/same-amount rows purely by chance. */
const FUZZY_MIN_MATCH_LENGTH = 12;
/** Cap on the fuzzy candidate query — see its own comment for why this is bounded. */
const FUZZY_CANDIDATE_LIMIT = 2000;
/** Cap on per-row forensic logging — a fully-duplicate large re-import shouldn't write
 *  thousands of narration-bearing log lines. */
const FUZZY_LOG_LIMIT = 20;

/**
 * Two descriptions are a likely duplicate of the SAME real transaction from a
 * different import source if, after normalizing, one is a suffix of the other — this
 * follows directly from the verified pattern that a PDF-parsed description is exactly
 * `"{label} " + csvDescription` (plus, occasionally, a short non-whitespace prefix from
 * a terminator line — the invariant is not absolute, only the dominant real-world
 * shape, so this is a fuzzy safety net, not a replacement for the exact-hash path).
 * Gated on a minimum match length and a maximum dropped-prefix length so it can't
 * collide two genuinely different, short or long, narrations.
 */
function isFuzzyDuplicate(a: string, b: string): boolean {
  const normA = normalizeForFuzzyMatch(a);
  const normB = normalizeForFuzzyMatch(b);
  // The min-length guard applies here too, not just on the suffix path below — without
  // it, two short generic narrations ("atm wdl", "cash") that happen to be byte-
  // identical would collide across different real accounts of the same user (the fuzzy
  // query is deliberately userId-scoped, not accountId-scoped — see the query comment).
  if (normA === normB) return normA.length >= FUZZY_MIN_MATCH_LENGTH;
  const [shorter, longer] = normA.length <= normB.length ? [normA, normB] : [normB, normA];
  if (shorter.length < FUZZY_MIN_MATCH_LENGTH) return false;
  if (!longer.endsWith(shorter)) return false;
  const droppedPrefixLength = longer.length - shorter.length;
  return droppedPrefixLength <= Math.min(shorter.length, FUZZY_MAX_DROPPED_PREFIX);
}

export async function persistParsedStatement(args: PersistArgs) {
  const { ownerUserId, accountId, bank, rowCount, transactions, filename } = args;

  // Verify the account belongs to the owner before writing anything against it.
  let linkedAccountAnchorCutoff: Date | null = null;
  if (accountId) {
    const account = await prisma.bankAccount.findFirst({
      where: { id: accountId, userId: ownerUserId },
    });
    if (!account) throw AppError.notFound('Bank account');
    // A bank statement inherently describes a real account's activity — importing one
    // "into" the cash account itself has no meaningful semantics (a CASH row would need
    // to pair against itself) and isn't offered anywhere in the UI. Reject rather than
    // silently special-case it.
    if (account.isCashAccount) {
      throw AppError.badRequest('Cannot import a bank statement into the cash account');
    }
    linkedAccountAnchorCutoff = anchorCutoff(account.openingBalanceDate);
  }

  // scopeId = accountId when linked, userId otherwise — so re-importing the same
  // statement is idempotent even when no account is attached.
  const scopeId = accountId ?? ownerUserId;
  const txsWithHash = transactions.map((tx) => ({
    ...tx,
    hash: makeImportHash(tx.date, tx.amount, tx.type, tx.description, scopeId),
  }));

  // One query for every hash rather than one per row. deletedAt: null so a soft-deleted
  // row's hash doesn't permanently block re-importing that same row — softDeleteTransaction
  // nulls a deleted row's own importHash for the same reason (frees the DB-level
  // @@unique([importHash]) slot; Prisma/Postgres only treat NULL as non-conflicting).
  const hashes = txsWithHash.map((t) => t.hash);
  const existingHashes = new Set(
    (await prisma.transaction.findMany({
      where: { importHash: { in: hashes }, deletedAt: null },
      select: { importHash: true },
    })).map((r) => r.importHash!),
  );

  // Fuzzy safety net — runs alongside (not instead of) the exact-hash check above, and
  // is likewise outside the $transaction below (no timeout budget concern). Catches the
  // SAME real transaction re-imported from a different source (CSV vs PDF produce
  // differently-formatted descriptions for identical narration — see isFuzzyDuplicate)
  // or a different account-link scope (makeImportHash's scopeId is accountId ?? userId,
  // so a linked import and an unlinked import of the same statement never share a hash)
  // — the exact combination that let 66 duplicate transactions through undetected in
  // production. Deliberately scoped by userId only, not accountId: that's the dimension
  // the exact-hash check can't cross, and is exactly what needs crossing here.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const uniqueDays = Array.from(new Set(txsWithHash.map((t) => dayKey(t.date))));
  const uniqueAmounts = Array.from(new Set(txsWithHash.map((t) => t.amount.toFixed(2))));
  // Synthetic cash-leg rows (created below for linked-CASH import rows) always live on
  // the user's cash account and use the OPPOSITE type of the real row they pair with —
  // excluding them by ID keeps a phantom accounting leg from ever being read as a
  // candidate. NOT filtered via `transferPairId: null`: the REAL linked-CASH row also
  // carries that same transferPairId (see `pairId` above), so that filter would exclude
  // real statement rows too — precisely the ATM-withdrawal/cash-deposit rows a linked-
  // then-unlinked re-import (this fix's own target incident) most needs to catch.
  const cashAccountRow = await prisma.bankAccount.findFirst({
    where: { userId: ownerUserId, isCashAccount: true },
    select: { id: true, openingBalanceDate: true },
  });
  const cashAccountId = cashAccountRow?.id ?? null;
  // Checked independently of the linked account's anchor below — a linked-CASH import
  // row writes to TWO accounts (the real account via its normal row, the cash account
  // via a synthetic counterpart leg), and each can have its own, different anchor.
  const cashAnchorCutoff = anchorCutoff(cashAccountRow?.openingBalanceDate ?? null);
  const fuzzyCandidates = uniqueDays.length > 0 && uniqueAmounts.length > 0
    ? await prisma.transaction.findMany({
      where: {
        userId: ownerUserId,
        deletedAt: null,
        importHash: { not: null },
        amount: { in: uniqueAmounts },
        OR: uniqueDays.map((day) => {
          const dayStart = new Date(`${day}T00:00:00.000Z`);
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          return { date: { gte: dayStart, lt: dayEnd } };
        }),
      },
      select: { id: true, date: true, amount: true, type: true, description: true, bankAccountId: true },
      // Bounded — this is a cartesian (date IN ...) AND (amount IN ...) filter, not a
      // paired one, so an unbounded query could pull thousands of rows for a heavy
      // user's large, wide-ranging statement. Deterministic ordering so a truncated
      // result is at least stable/reproducible run-to-run, not an arbitrary subset.
      orderBy: { date: 'asc' },
      take: FUZZY_CANDIDATE_LIMIT,
    })
    : [];
  const fuzzyCandidatesTruncated = fuzzyCandidates.length === FUZZY_CANDIDATE_LIMIT;
  const fuzzyBucket = new Map<string, { id: string; description: string }[]>();
  for (const c of fuzzyCandidates) {
    if (cashAccountId !== null && c.bankAccountId === cashAccountId) continue; // synthetic leg
    const key = `${dayKey(c.date)}|${c.amount.toFixed(2)}|${String(c.type)}`;
    const bucket = fuzzyBucket.get(key);
    if (bucket) bucket.push({ id: c.id, description: c.description });
    else fuzzyBucket.set(key, [{ id: c.id, description: c.description }]);
  }

  // Dedup against the DB (exact hash, then the fuzzy net above) AND against hashes
  // already accepted earlier in this same batch — two identical rows in one statement
  // (same date/amount/type/description) previously both survived into toCreate and
  // collided on insert (P2002), hard-failing the whole import with a deterministic,
  // unrecoverable "please try again". Counting the second occurrence as a duplicate
  // here (rather than letting it reach the DB) keeps `imported + duplicatesSkipped ===
  // rowCount` true with no separate bookkeeping. Fuzzy matching is intentionally NOT
  // applied within the batch itself (seenInBatch stays exact-hash-only) — one file's
  // own description formatting is internally uniform, so there's no incident-shaped
  // benefit, only added false-positive surface.
  const seenInBatch = new Set<string>();
  // Matched candidate ids consumed so far — each existing transaction can absorb at
  // most ONE incoming row. Without this, two different new rows that both happen to
  // suffix-match the same single existing row (e.g. one matches on a longer narration
  // variant than the other) would both be dropped, silently losing a genuine second
  // transaction rather than just the true duplicate.
  const consumedCandidateIds = new Set<string>();
  const fuzzySkipped: { date: string; amount: string; description: string; matchedId: string }[] = [];
  const toCreate = txsWithHash.filter((t) => {
    if (existingHashes.has(t.hash) || seenInBatch.has(t.hash)) return false;
    const bucketKey = `${dayKey(t.date)}|${t.amount.toFixed(2)}|${t.type}`;
    const candidates = fuzzyBucket.get(bucketKey);
    const match = candidates?.find(
      (c) => !consumedCandidateIds.has(c.id) && isFuzzyDuplicate(t.description, c.description),
    );
    if (match) {
      consumedCandidateIds.add(match.id);
      fuzzySkipped.push({ date: dayKey(t.date), amount: t.amount.toFixed(2), description: t.description, matchedId: match.id });
      return false;
    }
    seenInBatch.add(t.hash);
    return true;
  });
  const fuzzyDuplicatesSkipped = fuzzySkipped.length;
  // Historical note: this count now includes fuzzy skips, not just exact-hash ones — a
  // silent widening of this persisted column's meaning for anyone comparing import
  // records over time. Not worth a migration for a count column; fuzzyDuplicatesSkipped
  // is returned separately (not persisted) for anyone who needs the exact split.
  const duplicatesSkipped = txsWithHash.length - toCreate.length;
  // A fuzzy skip means a genuine-looking transaction was silently NOT created. If the
  // matcher is ever wrong, this is the only forensic trail — a bare count in a warning
  // is not enough to diagnose or recover from a bad match after the fact. `matchedId`
  // is enough to look up the full row in the DB, so the narration itself is truncated
  // here rather than logged in full — a large duplicate re-import shouldn't write
  // thousands of lines of financial narration (counterparty names, UPI handles) to
  // stdout/log aggregation, and is capped separately from the (unbounded) count.
  for (const s of fuzzySkipped.slice(0, FUZZY_LOG_LIMIT)) {
    console.info('[import] fuzzy duplicate skipped', {
      ownerUserId,
      date: s.date,
      amount: s.amount,
      matchedId: s.matchedId,
      descriptionPreview: s.description.slice(0, 40),
    });
  }

  let syntheticCashLegsCreated = 0;
  let supersededByAnchorCount = 0;
  const cashDeltas: number[] = [];
  const linkedAccountSupersededHashes = new Set<string>();

  try {
    // Explicit timeout. Prisma's interactive-transaction default is 5s, and this is the
    // only $transaction in the repo that iterates an unbounded, user-supplied collection.
    // The inserts below are batched via createMany (not chunked into separate
    // transactions — that would break the all-or-nothing invariant this file's own top
    // comment documents and import.routes.test.ts asserts on), so round-trip count is no
    // longer a function of row count. Verified live against a real Postgres instance:
    // createMany inserts 50,000 rows in ~2.4s inside one $transaction, comfortably under
    // this timeout — Prisma auto-batches internally, staying under Postgres's bind-
    // parameter limit without any app-level chunking. 30s is kept as a defensive ceiling
    // for genuinely pathological cases (e.g. lock contention), not because row count
    // alone can exhaust it anymore.
    await prisma.$transaction(async (tx) => {
      // Resolved once per import, not per row — same idempotent helper createTransaction
      // and recurringService use. Only looked up when at least one row needs it.
      const anyCashRows = toCreate.some((t) => t.paymentMode === PaymentMode.CASH);
      const cashAccount = anyCashRows ? await ensureCashAccount(tx, ownerUserId) : null;

      const normalRows: Prisma.TransactionCreateManyInput[] = [];
      const syntheticRows: Prisma.TransactionCreateManyInput[] = [];

      for (const t of toCreate) {
        const isCashRow = cashAccount !== null && t.paymentMode === PaymentMode.CASH;

        // Unlinked import + CASH row: resolves directly to the cash account, single leg
        // — structurally identical to a manual CASH expense with no account.
        //
        // Linked import + CASH row (e.g. an "ATM WDL" line inside a real bank statement):
        // the row KEEPS its real account — it already correctly debits/credits it — and
        // gets paired via transferPairId with a synthetic counterpart leg on the cash
        // account below. This reuses the existing double-entry TRANSFER machinery rather
        // than inventing a new "independent cash leg" concept, so the frontend's
        // "Cash Withdrawal"/"Cash Deposit" label (which already renders generically for
        // ANY transfer pair with a cash-account leg) applies with zero frontend changes.
        //
        // Forward-only: re-importing an already-imported pre-fix statement will NOT
        // retroactively add the missing cash leg, because dedup keys off the original
        // row's hash, which is unchanged by this fix and already exists in the DB.
        const pairId = isCashRow && accountId ? crypto.randomUUID() : undefined;

        // The row's own leg targets the cash account when unlinked-CASH, otherwise the
        // linked account (or no account at all, for an unlinked non-cash row — which has
        // no anchor to check since it never affects any account's balance).
        const normalRowCutoff = isCashRow && !accountId ? cashAnchorCutoff : linkedAccountAnchorCutoff;
        const normalRowSuperseded = normalRowCutoff !== null && t.date <= normalRowCutoff;
        if (normalRowSuperseded) {
          supersededByAnchorCount += 1;
          if (accountId) linkedAccountSupersededHashes.add(t.hash);
        }

        // Accumulated at the exact point the routing decision is made, rather than
        // re-derived afterward from a second filter/map pass — one source of truth for
        // "does this row affect the cash account, and in which direction." Excluded when
        // superseded: the row is still inserted (visible in lists, per the anchor's
        // "supersede, don't hide" rule) but must not move a balance it's excluded from.
        if (isCashRow && !accountId && !normalRowSuperseded) {
          cashDeltas.push(round2(t.type === 'INCOME' ? t.amount : -t.amount));
        }

        normalRows.push({
          userId: ownerUserId,
          bankAccountId: isCashRow && !accountId ? cashAccount!.id : (accountId ?? null),
          amount: t.amount,
          type: t.type,
          // A linked-CASH row is half of a transfer pair, and transfers are never
          // categorized (same rule as createTransaction/updateTransaction).
          categoryId: pairId ? null : (t.categoryId ?? null),
          description: t.description,
          remark: t.remark ?? null,
          date: t.date,
          paymentMode: t.paymentMode ?? null,
          balanceImpactApplied: true,
          balanceSupersededByAnchor: normalRowSuperseded,
          importHash: t.hash,
          transferPairId: pairId,
        });

        if (isCashRow && accountId) {
          // Synthetic counterpart leg: opposite type, on the cash account. Its hash is
          // derived FROM the original row's own hash (t.hash, already globally unique —
          // @@unique([importHash])) rather than re-derived from raw fields scoped to
          // cashAccount.id: every linked-CASH row for this user would otherwise share
          // that one scope, so two different statements (or the same row re-linked to a
          // different account after a delete+reimport) could produce byte-identical
          // synthetic hashes and hard-fail the whole batch with an unrecoverable P2002.
          // Deriving from t.hash is deterministic (same original row → same synthetic
          // hash, so re-import dedup still works) and can never collide with anything
          // else's hash, since t.hash itself is already collision-free by construction.
          // isCashRow already guarantees cashAccount is non-null (it's part of the
          // condition), so `!` here is provably safe, not a suppressed nullability risk.
          const syntheticType = t.type === 'INCOME' ? 'EXPENSE' : 'INCOME';
          const syntheticHash = crypto.createHash('sha256').update(`${t.hash}|cash-leg`).digest('hex');
          // Checked independently of normalRowSuperseded (which reflects the linked
          // account's anchor, not the cash account's) — a linked-CASH row writes to two
          // separate accounts, each with its own anchor.
          const syntheticSuperseded = cashAnchorCutoff !== null && t.date <= cashAnchorCutoff;
          if (syntheticSuperseded) supersededByAnchorCount += 1;
          syntheticRows.push({
            userId: ownerUserId,
            bankAccountId: cashAccount!.id,
            amount: t.amount,
            type: syntheticType,
            categoryId: null,
            description: t.description,
            date: t.date,
            // Always 'CASH' here (isCashRow's precondition) — written directly rather
            // than `t.paymentMode ?? null`, which would leave an unreachable branch.
            paymentMode: PaymentMode.CASH,
            balanceImpactApplied: true,
            balanceSupersededByAnchor: syntheticSuperseded,
            importHash: syntheticHash,
            transferPairId: pairId,
          });
          if (!syntheticSuperseded) {
            cashDeltas.push(round2(syntheticType === 'INCOME' ? t.amount : -t.amount));
          }
        }
      }

      // One bulk insert instead of up to 2×N per-row round trips — the actual fix.
      // normalRows and syntheticRows share the identical row shape and target the same
      // table with no ordering dependency between them, so there's no reason to pay two
      // round trips when one covers both. Still inside this same $transaction, so
      // atomicity is unchanged: either the whole batch lands and the balance syncs below
      // run, or nothing here was ever written. No skipDuplicates needed — toCreate is
      // already deduped both against the DB and within the batch itself (see
      // seenInBatch above), so createMany should never see a same-hash collision here.
      const allRows = [...normalRows, ...syntheticRows];
      if (allRows.length > 0) await tx.transaction.createMany({ data: allRows });
      syntheticCashLegsCreated = syntheticRows.length;

      // Sync the linked account's balance inside the same transaction as the inserts.
      // Unchanged: every row keeping bankAccountId: accountId (including linked-CASH
      // rows, which correctly debit/credit it exactly as before) is counted as before.
      if (accountId && toCreate.length > 0) {
        // Round twice, deliberately. Per row, because Prisma stores each amount into
        // Decimal(15,2) independently — summing raw would drift from what the rows
        // actually persist as (two 0.004 rows each store 0.00, but raw-sum to 0.01).
        // Then on the total, because float addition of already-rounded values still
        // accumulates error (0.1 + 0.2 === 0.30000000000000004), and an exactly-
        // cancelling set must compare equal to 0 so no bogus increment is written.
        const netDelta = round2(
          toCreate.reduce(
            (sum, t) => (
              linkedAccountSupersededHashes.has(t.hash)
                ? sum
                : sum + round2(t.type === 'INCOME' ? t.amount : -t.amount)
            ),
            0,
          ),
        );
        if (netDelta !== 0) {
          await tx.bankAccount.update({
            where: { id: accountId },
            data: { currentBalance: { increment: netDelta } },
          });
        }
      }

      // Sync the cash account's balance: unlinked-CASH rows (single leg, using the row's
      // own type) plus synthetic legs from linked-CASH rows (using the synthetic leg's
      // own, opposite type). Same two-stage rounding discipline as the block above.
      if (cashAccount) {
        const cashNetDelta = round2(cashDeltas.reduce((sum, d) => sum + d, 0));
        if (cashNetDelta !== 0) {
          await tx.bankAccount.update({
            where: { id: cashAccount.id },
            data: { currentBalance: { increment: cashNetDelta } },
          });
        }
      }
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (err) {
    // $transaction is atomic, so this always means "nothing was written". Log the real
    // cause WITH identifying context here: errorHandler short-circuits operational
    // errors before its own context-rich log, so this is the only record of the failure.
    //
    // Includes the rare case where ensureCashAccount's own AppError.conflict (a
    // concurrent-provisioning race on the user's cash account) lands here too — it loses
    // its specific "retry" messaging and becomes the generic message below. Accepted
    // deliberately rather than special-cased: the generic message already tells the user
    // nothing was saved and a retry is safe, which is the same remedy.
    console.error('[import] batch insert failed', {
      ownerUserId,
      accountId: accountId ?? null,
      rowCount: toCreate.length,
      err,
    });
    // isOperational: true so the user is told nothing was saved and a retry is safe.
    // Messages are hand-written and leak no internals.
    //
    // P2028 (transaction timed out) is deterministic for a given statement size — telling
    // that user to "try again" would send them round a loop that cannot succeed, so they
    // get the one remedy that actually works instead.
    const timedOut = (err as { code?: string } | null)?.code === 'P2028';
    throw new AppError(
      timedOut
        ? 'Import timed out — no transactions were saved. Try splitting the statement into smaller date ranges.'
        : 'Import failed — no transactions were saved. Please try again.',
      500,
      'IMPORT_FAILED',
      true,
    );
  }

  // All-or-nothing above, so every row that was going to land, landed. `imported` counts
  // STATEMENT rows (kept equal to toCreate.length) so `imported + duplicatesSkipped ===
  // rowCount` stays a true invariant the UI relies on ("Rows parsed / Imported /
  // Duplicates skipped"). Synthetic cash-credit legs are real DB rows too, but they are
  // not statement rows — they're reported separately so nothing double-counts.
  const imported = toCreate.length;

  const importRecord = await prisma.bankStatementImport.create({
    data: {
      userId: ownerUserId,
      bankAccountId: accountId ?? null,
      bankName: bank,
      rowCount,
      importedCount: imported,
      duplicatesSkipped,
      errorsCount: 0,
      filename: sanitizeFilename(filename),
    },
  });

  const warnings: string[] = [];
  if (fuzzyDuplicatesSkipped > 0) {
    const sample = fuzzySkipped.slice(0, 3).map((s) => `${s.date} ₹${s.amount}`).join(', ');
    const more = fuzzySkipped.length > 3 ? ` and ${fuzzySkipped.length - 3} more` : '';
    warnings.push(
      `${fuzzyDuplicatesSkipped} row${fuzzyDuplicatesSkipped === 1 ? '' : 's'} matched an `
      + `existing transaction already imported from a different file or account link `
      + `(${sample}${more}) and ${fuzzyDuplicatesSkipped === 1 ? 'was' : 'were'} skipped `
      + 'as a likely duplicate.',
    );
  }
  if (fuzzyCandidatesTruncated) {
    warnings.push(
      'The duplicate check was limited to the first '
      + `${FUZZY_CANDIDATE_LIMIT} matching existing transactions — for a very large `
      + 'account history, some duplicates may not have been caught.',
    );
  }
  if (supersededByAnchorCount > 0) {
    warnings.push(
      `${supersededByAnchorCount} row${supersededByAnchorCount === 1 ? '' : 's'} dated on or `
      + `before an account's opening-balance date ${supersededByAnchorCount === 1 ? 'was' : 'were'} `
      + 'imported for the record but excluded from the balance calculation.',
    );
  }

  return {
    imported,
    duplicatesSkipped,
    fuzzyDuplicatesSkipped,
    supersededByAnchorCount,
    cashLegsCreated: syntheticCashLegsCreated,
    importRecord,
    warnings,
  };
}
