import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sanitizeFilename } from '../utils/sanitizeFilename';
import { makeImportHash, type ParsedTransaction } from './importService';

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
  }

  // scopeId = accountId when linked, userId otherwise — so re-importing the same
  // statement is idempotent even when no account is attached.
  const scopeId = accountId ?? ownerUserId;
  const txsWithHash = transactions.map((tx) => ({
    ...tx,
    hash: makeImportHash(tx.date, tx.amount, tx.type, tx.description, scopeId),
  }));

  // One query for every hash rather than one per row.
  const hashes = txsWithHash.map((t) => t.hash);
  const existingHashes = new Set(
    (await prisma.transaction.findMany({
      where: { importHash: { in: hashes } },
      select: { importHash: true },
    })).map((r) => r.importHash!),
  );

  const toCreate = txsWithHash.filter((t) => !existingHashes.has(t.hash));
  const duplicatesSkipped = txsWithHash.length - toCreate.length;

  try {
    // Explicit timeout. Prisma's interactive-transaction default is 5s, and this is the
    // only $transaction in the repo that iterates an unbounded, user-supplied collection
    // — a ~1,600-row statement (well within the 15MB upload limit) blows 5s at typical
    // round-trip latency and fails with P2028. 30s covers ~10k rows, comfortably past any
    // realistic statement, without holding a write transaction open for minutes.
    // The real fix is createMany/chunking; tracked as debt, deliberately not done here.
    await prisma.$transaction(async (tx) => {
      for (const t of toCreate) {
        await tx.transaction.create({
          data: {
            userId: ownerUserId,
            bankAccountId: accountId ?? null,
            amount: t.amount,
            type: t.type,
            categoryId: t.categoryId ?? null,
            description: t.description,
            remark: t.remark ?? null,
            date: t.date,
            paymentMode: t.paymentMode ?? null,
            balanceImpactApplied: true,
            importHash: t.hash,
          },
        });
      }
      // Sync the account balance inside the same transaction as the inserts.
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
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (err) {
    // $transaction is atomic, so this always means "nothing was written". Log the real
    // cause WITH identifying context here: errorHandler short-circuits operational
    // errors before its own context-rich log, so this is the only record of the failure.
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

  // All-or-nothing above, so every row that was going to land, landed.
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

  return { imported, duplicatesSkipped, importRecord };
}
