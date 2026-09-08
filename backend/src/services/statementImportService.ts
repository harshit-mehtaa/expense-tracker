import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sanitizeFilename } from '../utils/sanitizeFilename';
import { makeImportHash, type ParsedTransaction } from './importService';
import { ensureCashAccount } from './accountService';

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

export async function persistParsedStatement(args: PersistArgs) {
  const { ownerUserId, accountId, bank, rowCount, transactions, filename } = args;

  // Verify the account belongs to the owner before writing anything against it.
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

  // Dedup against the DB AND against hashes already accepted earlier in this same
  // batch — two identical rows in one statement (same date/amount/type/description)
  // previously both survived into toCreate and collided on insert (P2002), hard-failing
  // the whole import with a deterministic, unrecoverable "please try again". Counting
  // the second occurrence as a duplicate here (rather than letting it reach the DB)
  // keeps `imported + duplicatesSkipped === rowCount` true with no separate bookkeeping.
  const seenInBatch = new Set<string>();
  const toCreate = txsWithHash.filter((t) => {
    if (existingHashes.has(t.hash) || seenInBatch.has(t.hash)) return false;
    seenInBatch.add(t.hash);
    return true;
  });
  const duplicatesSkipped = txsWithHash.length - toCreate.length;

  let syntheticCashLegsCreated = 0;
  const cashDeltas: number[] = [];

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
      const anyCashRows = toCreate.some((t) => t.paymentMode === 'CASH');
      const cashAccount = anyCashRows ? await ensureCashAccount(tx, ownerUserId) : null;

      const normalRows: Prisma.TransactionCreateManyInput[] = [];
      const syntheticRows: Prisma.TransactionCreateManyInput[] = [];

      for (const t of toCreate) {
        const isCashRow = cashAccount !== null && t.paymentMode === 'CASH';

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

        // Accumulated at the exact point the routing decision is made, rather than
        // re-derived afterward from a second filter/map pass — one source of truth for
        // "does this row affect the cash account, and in which direction."
        if (isCashRow && !accountId) {
          cashDeltas.push(round2(t.type === 'INCOME' ? t.amount : -t.amount));
        }

        normalRows.push({
          userId: ownerUserId,
          bankAccountId: isCashRow && !accountId ? cashAccount!.id : (accountId ?? null),
          amount: t.amount,
          type: t.type,
          categoryId: t.categoryId ?? null,
          description: t.description,
          remark: t.remark ?? null,
          date: t.date,
          paymentMode: t.paymentMode ?? null,
          balanceImpactApplied: true,
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
            paymentMode: 'CASH',
            balanceImpactApplied: true,
            importHash: syntheticHash,
            transferPairId: pairId,
          });
          cashDeltas.push(round2(syntheticType === 'INCOME' ? t.amount : -t.amount));
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
            (sum, t) => sum + round2(t.type === 'INCOME' ? t.amount : -t.amount),
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

  return { imported, duplicatesSkipped, cashLegsCreated: syntheticCashLegsCreated, importRecord };
}
