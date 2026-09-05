/**
 * One-time backfill: provision a cash account for every existing user.
 *
 * New users get a cash account automatically at creation time (authService.createUser,
 * adminService.createUser, prisma/seed.ts), but that only covers signups going forward —
 * this backfills users that existed before the cash-account feature shipped.
 *
 * transactionService.createTransaction also self-heals (calls the same ensureCashAccount
 * lazily if a user has none), so this script is a convenience, not a hard prerequisite —
 * but running it means the FIRST cash transaction for a pre-existing user doesn't pay the
 * extra provisioning write.
 *
 * Usage: docker compose exec backend npx ts-node prisma/backfill-cash-accounts.ts
 *
 * Idempotent: ensureCashAccount is a find-or-create, so re-running is safe and reports
 * 0 created on subsequent runs.
 */

// Reuses the shared singleton rather than `new PrismaClient()` — accountService already
// imports it transitively, so a second client here would just be a dangling connection.
import prisma from '../src/config/prisma';
import { ensureCashAccount } from '../src/services/accountService';

async function main() {
  const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });

  let created = 0;
  for (const user of users) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.bankAccount.findFirst({ where: { userId: user.id, isCashAccount: true } });
      await ensureCashAccount(tx, user.id);
      if (!before) created += 1;
    });
  }

  console.log(`✓ Backfill complete. ${created} cash account(s) created, ${users.length - created} already existed.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Backfill failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
