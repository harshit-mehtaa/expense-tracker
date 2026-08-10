import { CategoryType, PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getDefaultCategoryStyle } from '../src/utils/categoryStyle';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

interface BootstrapCategory {
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  parentName?: string;
  replaceIcons?: string[];
  replaceColors?: string[];
}

const BOOTSTRAP_CATEGORIES: BootstrapCategory[] = [
  { name: 'Salary', type: CategoryType.INCOME, icon: '💼', color: '#22c55e' },
  { name: 'Dividend', type: CategoryType.INCOME, icon: '📈', color: '#8b5cf6' },
  { name: 'Medical Reimbursement', type: CategoryType.INCOME, icon: '🏥', color: '#14b8a6' },
  { name: 'Food and Beverages', type: CategoryType.EXPENSE, icon: '🍽️', color: '#ec4899' },
  { name: 'Fruits and Vegies', type: CategoryType.EXPENSE, icon: '🥦', color: '#10b981' },
  { name: 'Groceries', type: CategoryType.EXPENSE, icon: '🛒', color: '#3b82f6' },
  { name: 'Medical', type: CategoryType.EXPENSE, icon: '💊', color: '#14b8a6' },
  { name: 'Restaurants', type: CategoryType.EXPENSE, icon: '🍕', color: '#ef4444' },
  { name: 'Subscriptions', type: CategoryType.EXPENSE, icon: '📺', color: '#8b5cf6' },
  {
    name: 'Netflix',
    type: CategoryType.EXPENSE,
    icon: 'N',
    color: '#e50914',
    parentName: 'Subscriptions',
    replaceIcons: ['🎬'],
    replaceColors: ['#ef4444'],
  },
  {
    name: 'Amazon Prime',
    type: CategoryType.EXPENSE,
    icon: '▶️',
    color: '#00a8e1',
    parentName: 'Subscriptions',
    replaceIcons: ['📦'],
    replaceColors: ['#3b82f6'],
  },
  {
    name: 'Google',
    type: CategoryType.EXPENSE,
    icon: 'G',
    color: '#4285f4',
    parentName: 'Subscriptions',
    replaceColors: ['#22c55e'],
  },
];

async function main() {
  console.log('Seeding clean family bootstrap...');

  const passwordHash = await bcrypt.hash('Admin@1234', BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.family.upsert({
      where: { id: 'default-family' },
      update: {
        name: 'Mehta Family',
        currency: 'INR',
        locale: 'en-IN',
        timezone: 'Asia/Kolkata',
        fyStartMonth: 4,
      },
      create: {
        id: 'default-family',
        name: 'Mehta Family',
        currency: 'INR',
        locale: 'en-IN',
        timezone: 'Asia/Kolkata',
        fyStartMonth: 4,
      },
    });

    await tx.user.upsert({
      where: { email: 'harshit@mehta.local' },
      update: {
        name: 'Harshit Mehta',
        passwordHash,
        role: Role.ADMIN,
        isActive: true,
        mustChangePassword: false,
        deletedAt: null,
        colorTag: '#6366f1',
      },
      create: {
        name: 'Harshit Mehta',
        email: 'harshit@mehta.local',
        passwordHash,
        role: Role.ADMIN,
        isActive: true,
        mustChangePassword: false,
        colorTag: '#6366f1',
      },
    });

    for (const category of BOOTSTRAP_CATEGORIES) {
      const parent = category.parentName
        ? await tx.category.findFirst({
          where: { name: category.parentName, type: category.type, userId: null },
          select: { id: true },
        })
        : null;
      const existing = await tx.category.findFirst({
        where: { name: category.name, type: category.type, userId: null },
      });

      if (existing) {
        const shouldUpdateIcon = !existing.icon?.trim()
          || category.replaceIcons?.includes(existing.icon ?? '');
        const shouldUpdateColor = !existing.color?.trim()
          || category.replaceColors?.includes(existing.color ?? '');
        await tx.category.update({
          where: { id: existing.id },
          data: {
            icon: shouldUpdateIcon ? category.icon : existing.icon,
            color: shouldUpdateColor ? category.color : existing.color,
            parentId: existing.parentId ?? parent?.id ?? null,
          },
        });
        continue;
      }

      await tx.category.create({
        data: {
          name: category.name,
          type: category.type,
          icon: category.icon,
          color: category.color,
          parentId: parent?.id ?? null,
          userId: null,
          isDefault: false,
        },
      });
    }

    const categoriesWithoutIcons = await tx.category.findMany({
      where: {
        userId: null,
        OR: [{ icon: null }, { icon: '' }],
      },
    });
    for (const category of categoriesWithoutIcons) {
      const style = getDefaultCategoryStyle(category.name, category.type);
      await tx.category.update({
        where: { id: category.id },
        data: {
          icon: style.icon,
          color: category.color?.trim() ? category.color : style.color,
        },
      });
    }
  });

  console.log('Clean family bootstrap ready.');
  console.log('Admin: harshit@mehta.local / Admin@1234');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
