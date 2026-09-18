/**
 * Manual validation for the opening-balance-anchor feature. Not part of CI or `npm test`
 * — this proves something unit tests (mocked Prisma) structurally cannot: that the
 * incremental delta path (every createTransaction/updateTransaction/softDeleteTransaction
 * call) and the from-scratch recompute path (applyAnchor) never drift apart from each
 * other over a real sequence of operations against a real Postgres instance.
 *
 * Run inside the backend container (needs a live DATABASE_URL):
 *   docker compose exec backend npx ts-node scripts/validate-opening-balance.ts
 *
 * Creates and tears down its own throwaway user/account — safe to run against a real
 * dev database. Exits non-zero on any invariant violation.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import prisma from '../src/config/prisma';
import { anchorCutoff } from '../src/utils/financialYear';
import * as accountService from '../src/services/accountService';
import * as transactionService from '../src/services/transactionService';

const RUN_ID = Date.now();
const USER_ID_EMAIL = `opening-balance-validation-${RUN_ID}@example.invalid`;

let failures = 0;

function assertInvariant(label: string, condition: boolean, detail: string) {
  if (!condition) {
    failures += 1;
    console.error(`❌ FAIL: ${label}\n   ${detail}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

/** Independently recomputes currentBalance straight from the transaction rows — does
 *  NOT reuse applyAnchor's own aggregate query, so it can catch the incremental
 *  (delta-based create/update/delete) path silently drifting from the anchor formula. */
async function independentBalance(accountId: string): Promise<Prisma.Decimal> {
  const account = await prisma.bankAccount.findUniqueOrThrow({ where: { id: accountId } });
  const cutoff = anchorCutoff(account.openingBalanceDate);
  const rows = await prisma.transaction.findMany({ where: { bankAccountId: accountId, deletedAt: null } });
  let sum = new Prisma.Decimal(account.openingBalance ?? 0);
  for (const row of rows) {
    if (row.balanceImpactApplied === false) continue;
    if (cutoff && row.date <= cutoff) continue;
    sum = row.type === 'INCOME' ? sum.plus(row.amount) : sum.minus(row.amount);
  }
  return sum;
}

async function checkInvariant(accountId: string, label: string) {
  const account = await prisma.bankAccount.findUniqueOrThrow({ where: { id: accountId } });
  const expected = await independentBalance(accountId);
  const actual = new Prisma.Decimal(account.currentBalance);
  assertInvariant(
    label,
    actual.equals(expected),
    `stored currentBalance=${actual.toString()} vs independently recomputed=${expected.toString()}`,
  );
}

function randomAmount(): number {
  return Math.round((Math.random() * 5000 + 10) * 100) / 100;
}

function randomDateBetween(start: Date, end: Date): Date {
  const t = start.getTime() + Math.random() * (end.getTime() - start.getTime());
  return new Date(t);
}

async function main() {
  console.log(`Validation run ${RUN_ID}`);

  const user = await prisma.user.create({
    data: { name: 'Opening Balance Validation', email: USER_ID_EMAIL, passwordHash: 'x', role: 'MEMBER' },
  });
  const account = await prisma.bankAccount.create({
    data: { userId: user.id, bankName: 'Validation Bank', accountType: 'SAVINGS', currentBalance: 0, currency: 'INR' },
  });
  const other = await prisma.bankAccount.create({
    data: { userId: user.id, bankName: 'Validation Bank 2', accountType: 'SAVINGS', currentBalance: 0, currency: 'INR' },
  });

  try {
    const historyStart = new Date('2024-01-01');
    const historyMid = new Date('2025-06-01');
    const historyEnd = new Date('2026-06-01');

    // 1. Seed ~60 varied transactions before setting an anchor.
    for (let i = 0; i < 60; i++) {
      await transactionService.createTransaction(user.id, {
        bankAccountId: account.id,
        amount: randomAmount(),
        type: Math.random() > 0.4 ? 'EXPENSE' : 'INCOME',
        description: `Seed ${i}`,
        date: randomDateBetween(historyStart, historyMid).toISOString(),
      });
    }
    // A transfer pair (both legs on `account`/`other`).
    await transactionService.createTransaction(user.id, {
      bankAccountId: account.id, transferToAccountId: other.id, amount: 1000, type: 'TRANSFER',
      description: 'Seed transfer', date: historyMid.toISOString(),
    });
    // A soft-deleted row (should never count, before or after anchoring).
    const toDelete = await transactionService.createTransaction(user.id, {
      bankAccountId: account.id, amount: 250, type: 'EXPENSE', description: 'Will be deleted',
      date: historyStart.toISOString(),
    });
    await transactionService.softDeleteTransaction((toDelete as any).id, user.id, 'MEMBER');

    await checkInvariant(account.id, 'Invariant holds after seeding (no anchor yet)');

    // 2. Set an anchor mid-history.
    const { supersededTransactionCount } = await accountService.applyAnchor(
      account.id, user.id, 'MEMBER', 50000, '2025-01-01',
    );
    console.log(`Anchor set — ${supersededTransactionCount} rows superseded`);
    await checkInvariant(account.id, 'Invariant holds immediately after setting the anchor');

    // 3. ~20 randomized operations through the REAL service functions, all dated after
    //    the anchor (creating pre-anchor rows is correctly rejected — not the invariant
    //    under test here).
    let successfulOps = 0;
    for (let i = 0; i < 20; i++) {
      const op = Math.floor(Math.random() * 4);
      try {
        if (op === 0) {
          await transactionService.createTransaction(user.id, {
            bankAccountId: account.id, amount: randomAmount(),
            type: Math.random() > 0.5 ? 'EXPENSE' : 'INCOME',
            description: `Random ${i}`, date: randomDateBetween(historyMid, historyEnd).toISOString(),
          });
        } else if (op === 1) {
          const recent = await prisma.transaction.findFirst({
            where: { bankAccountId: account.id, deletedAt: null, balanceSupersededByAnchor: false },
            orderBy: { createdAt: 'desc' },
          });
          if (recent) {
            await transactionService.updateTransaction(recent.id, user.id, 'MEMBER', { amount: randomAmount() });
          }
        } else if (op === 2) {
          const recent = await prisma.transaction.findFirst({
            where: { bankAccountId: account.id, deletedAt: null, balanceSupersededByAnchor: false, transferPairId: null },
            orderBy: { createdAt: 'desc' },
          });
          if (recent) await transactionService.softDeleteTransaction(recent.id, user.id, 'MEMBER');
        } else {
          await transactionService.createTransaction(user.id, {
            bankAccountId: account.id, transferToAccountId: other.id, amount: randomAmount(), type: 'TRANSFER',
            description: `Random transfer ${i}`, date: randomDateBetween(historyMid, historyEnd).toISOString(),
          });
        }
        successfulOps += 1;
      } catch (err) {
        // A rejected pre-anchor date, etc. — not a failure of the invariant itself, AS
        // LONG AS most ops are actually succeeding (see the minimum-success assertion
        // below) — otherwise a change that made every op throw would report a clean
        // invariant (balance simply never moved) and mask a real regression.
        console.log(`  (op ${i} threw, as expected for some random dates: ${(err as Error).message})`);
      }
      await checkInvariant(account.id, `Invariant holds after random op ${i}`);
    }
    assertInvariant(
      'At least 15 of the 20 randomized ops actually succeeded (not all silently rejected)',
      successfulOps >= 15,
      `${successfulOps}/20 succeeded`,
    );

    // 4. Move the anchor later, then earlier, then clear it.
    await accountService.applyAnchor(account.id, user.id, 'MEMBER', 60000, '2025-09-01');
    await checkInvariant(account.id, 'Invariant holds after moving the anchor LATER');

    await accountService.applyAnchor(account.id, user.id, 'MEMBER', 40000, '2025-01-01');
    await checkInvariant(account.id, 'Invariant holds after moving the anchor EARLIER (resurrection)');

    await accountService.applyAnchor(account.id, user.id, 'MEMBER', null, null);
    await checkInvariant(account.id, 'Invariant holds after CLEARING the anchor');

    // Re-set the identical anchor twice — idempotency check: the second call must
    // produce the exact same currentBalance as the first.
    await accountService.applyAnchor(account.id, user.id, 'MEMBER', 40000, '2025-01-01');
    const firstSet = await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } });
    await accountService.applyAnchor(account.id, user.id, 'MEMBER', 40000, '2025-01-01');
    const secondSet = await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } });
    assertInvariant(
      'Setting the identical anchor twice is idempotent',
      new Prisma.Decimal(secondSet.currentBalance).equals(new Prisma.Decimal(firstSet.currentBalance)),
      `first=${firstSet.currentBalance} second=${secondSet.currentBalance}`,
    );
    await checkInvariant(account.id, 'Invariant holds after re-setting the same anchor twice');

    // 5. Concurrency probe #1: applyAnchor racing 10 concurrent createTransaction calls.
    const createRace = [
      accountService.applyAnchor(account.id, user.id, 'MEMBER', 45000, '2025-03-01'),
      ...Array.from({ length: 10 }, (_, i) => transactionService.createTransaction(user.id, {
        bankAccountId: account.id, amount: randomAmount(), type: 'EXPENSE',
        description: `Concurrent create ${i}`, date: new Date('2026-01-01').toISOString(),
      })),
    ];
    const createResults = await Promise.allSettled(createRace);
    console.log(`Concurrency probe (create): ${createResults.filter((r) => r.status === 'rejected').length}/${createResults.length} rejected`);
    await checkInvariant(account.id, 'Invariant holds after the create concurrency probe');

    // 6. Concurrency probe #2: applyAnchor racing softDeleteTransaction/updateTransaction
    //    on EXISTING rows — this is the specific shape a real race was found and fixed
    //    in (a stale read of balanceSupersededByAnchor deciding a reversal). Probe #1
    //    alone would NOT have caught that class, since createTransaction never reads
    //    that flag.
    const raceTargets = await prisma.transaction.findMany({
      where: { bankAccountId: account.id, deletedAt: null, transferPairId: null },
      take: 6,
      orderBy: { createdAt: 'desc' },
    });
    const mutateRace = [
      accountService.applyAnchor(account.id, user.id, 'MEMBER', 42000, '2025-02-01'),
      ...raceTargets.slice(0, 3).map((t) => transactionService.updateTransaction(t.id, user.id, 'MEMBER', { amount: randomAmount() })),
      ...raceTargets.slice(3, 6).map((t) => transactionService.softDeleteTransaction(t.id, user.id, 'MEMBER')),
    ];
    const mutateResults = await Promise.allSettled(mutateRace);
    console.log(`Concurrency probe (update/delete): ${mutateResults.filter((r) => r.status === 'rejected').length}/${mutateResults.length} rejected`);
    await checkInvariant(account.id, 'Invariant holds after the update/delete concurrency probe');
  } finally {
    // Cleanup — hard delete is fine here, this is throwaway validation data, not real
    // user financial history (the 8-hard-delete-exception list in vision.md doesn't
    // apply to this script's own scratch data).
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.bankAccount.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  console.log(`\n${failures === 0 ? '✅ All invariant checks passed.' : `❌ ${failures} invariant check(s) FAILED.`}`);
  await (prisma as unknown as PrismaClient).$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Validation script crashed:', err);
  await (prisma as unknown as PrismaClient).$disconnect();
  process.exit(1);
});
