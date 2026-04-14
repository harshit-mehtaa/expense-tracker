/**
 * One-time migration: consolidate user-scoped categories → family-shared (userId: null).
 *
 * Run before applying the schema change that adds @@unique([name, type]).
 *
 * Usage: docker compose exec backend npx ts-node prisma/migrate-categories.ts
 *
 * Idempotent: exits early if no user-scoped categories exist.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const userCats = await prisma.category.findMany({
    where: { NOT: { userId: null } },
  });

  if (userCats.length === 0) {
    console.log('✓ No user-scoped categories found. Migration already complete or not needed.');
    return;
  }

  console.log(`Found ${userCats.length} user-scoped categories to migrate.`);

  // Load all existing family-level categories for dedup lookup
  const familyCats = await prisma.category.findMany({
    where: { userId: null },
    select: { id: true, name: true, type: true },
  });
  const familyMap = new Map(familyCats.map((c) => [`${c.name}::${c.type}`, c.id]));

  await prisma.$transaction(async (tx) => {
    for (const userCat of userCats) {
      const key = `${userCat.name}::${userCat.type}`;
      const familyId = familyMap.get(key);

      if (familyId) {
        // Duplicate: re-point all transaction and budget references → family category
        const [txCount, budgetCount] = await Promise.all([
          tx.transaction.updateMany({
            where: { categoryId: userCat.id },
            data: { categoryId: familyId },
          }),
          tx.budget.updateMany({
            where: { categoryId: userCat.id },
            data: { categoryId: familyId },
          }),
        ]);
        console.log(
          `  Merged "${userCat.name}" (${userCat.type}) — ` +
            `re-pointed ${txCount.count} transactions, ${budgetCount.count} budgets → family cat ${familyId}`,
        );
        await tx.category.delete({ where: { id: userCat.id } });
      } else {
        // No conflict: promote to family-shared
        await tx.category.update({ where: { id: userCat.id }, data: { userId: null } });
        // Add to map so subsequent duplicates of this newly-promoted category are handled
        familyMap.set(key, userCat.id);
        console.log(`  Promoted "${userCat.name}" (${userCat.type}) → family-shared`);
      }
    }
  });

  console.log('✓ Migration complete.');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
