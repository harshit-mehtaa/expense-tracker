import { PrismaClient, Role, AccountType, CategoryType, LoanType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

async function main() {
  console.log('🌱 Seeding database...');

  // ── Check if already seeded ─────────────────────────────────────────────────
  const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (existingAdmin) {
    console.log('✓ Database already seeded — skipping');
    return;
  }

  // ── Family record ───────────────────────────────────────────────────────────
  await prisma.family.create({
    data: {
      name: 'My Family',
      currency: 'INR',
      locale: 'en-IN',
      timezone: 'Asia/Kolkata',
      fyStartMonth: 4,
    },
  });

  // ── Advance tax calendar (current FY and next) ──────────────────────────────
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const fyStartYear = currentMonth >= 4 ? currentYear : currentYear - 1;

  for (const yearOffset of [0, 1]) {
    const y = fyStartYear + yearOffset;
    await prisma.advanceTaxEvent.createMany({
      data: [
        {
          fyYear: `${y}-${String(y + 1).slice(-2)}`,
          dueDate: new Date(`${y}-06-15T23:59:59+05:30`),
          percentageDue: 15,
          description: '1st Installment — 15% of estimated tax due by June 15',
          isSystemGenerated: true,
        },
        {
          fyYear: `${y}-${String(y + 1).slice(-2)}`,
          dueDate: new Date(`${y}-09-15T23:59:59+05:30`),
          percentageDue: 45,
          description: '2nd Installment — 45% cumulative by September 15',
          isSystemGenerated: true,
        },
        {
          fyYear: `${y}-${String(y + 1).slice(-2)}`,
          dueDate: new Date(`${y}-12-15T23:59:59+05:30`),
          percentageDue: 75,
          description: '3rd Installment — 75% cumulative by December 15',
          isSystemGenerated: true,
        },
        {
          fyYear: `${y}-${String(y + 1).slice(-2)}`,
          dueDate: new Date(`${y + 1}-03-15T23:59:59+05:30`),
          percentageDue: 100,
          description: '4th Installment — 100% cumulative by March 15',
          isSystemGenerated: true,
        },
      ],
    });
  }

  // ── Exchange rates (base rates — user should update regularly) ──────────────
  await prisma.exchangeRate.createMany({
    data: [
      { fromCurrency: 'USD', toCurrency: 'INR', rate: 83.50 },
      { fromCurrency: 'GBP', toCurrency: 'INR', rate: 106.00 },
      { fromCurrency: 'EUR', toCurrency: 'INR', rate: 90.50 },
      { fromCurrency: 'SGD', toCurrency: 'INR', rate: 62.00 },
      { fromCurrency: 'JPY', toCurrency: 'INR', rate: 0.55 },
    ],
    skipDuplicates: true,
  });

  // ── Default categories ───────────────────────────────────────────────────────
  const expenseCategories = [
    { name: 'Groceries', icon: '🛒', color: '#22c55e' },
    { name: 'Vegetables & Dairy', icon: '🥦', color: '#86efac' },
    { name: 'Eating Out', icon: '🍽️', color: '#f97316' },
    { name: 'Petrol/CNG', icon: '⛽', color: '#ef4444' },
    { name: 'Auto/Cab', icon: '🚕', color: '#f59e0b' },
    { name: 'Electricity', icon: '⚡', color: '#eab308' },
    { name: 'Water & Gas', icon: '💧', color: '#3b82f6' },
    { name: 'Mobile & Internet', icon: '📱', color: '#8b5cf6' },
    { name: 'DTH & OTT', icon: '📺', color: '#6366f1' },
    { name: 'School/Tuition Fees', icon: '🎓', color: '#14b8a6' },
    { name: 'Medical & Pharmacy', icon: '💊', color: '#ec4899' },
    { name: 'Doctor Visits', icon: '🏥', color: '#f43f5e' },
    { name: 'Rent', icon: '🏠', color: '#64748b' },
    { name: 'Home Maintenance', icon: '🔧', color: '#78716c' },
    { name: 'Maid/Cook/Driver', icon: '👩‍🍳', color: '#a78bfa' },
    { name: 'Clothing & Footwear', icon: '👗', color: '#fb923c' },
    { name: 'Personal Care', icon: '💆', color: '#f9a8d4' },
    { name: 'Entertainment', icon: '🎬', color: '#c084fc' },
    { name: 'Travel & Holidays', icon: '✈️', color: '#38bdf8' },
    { name: 'Gifts & Festivals', icon: '🪔', color: '#fbbf24' },
    { name: 'Charity & Donations', icon: '🤲', color: '#4ade80' },
    { name: 'EMI', icon: '💳', color: '#f87171' },
    { name: 'Taxes', icon: '📋', color: '#94a3b8' },
    { name: 'Miscellaneous', icon: '📦', color: '#cbd5e1' },
  ];

  const incomeCategories = [
    { name: 'Salary', icon: '💼', color: '#10b981' },
    { name: 'Freelance/Consulting', icon: '💻', color: '#059669' },
    { name: 'Rental Income', icon: '🏘️', color: '#047857' },
    { name: 'FD Interest', icon: '🏦', color: '#0284c7' },
    { name: 'Dividend', icon: '📈', color: '#0369a1' },
    { name: 'Capital Gains', icon: '📊', color: '#7c3aed' },
    { name: 'Bonus', icon: '🎯', color: '#d97706' },
    { name: 'Agricultural Income', icon: '🌾', color: '#65a30d' },
    { name: 'Other Income', icon: '💰', color: '#16a34a' },
  ];

  for (const cat of expenseCategories) {
    await prisma.category.create({
      data: { ...cat, type: CategoryType.EXPENSE, isDefault: true, userId: null },
    });
  }

  for (const cat of incomeCategories) {
    await prisma.category.create({
      data: { ...cat, type: CategoryType.INCOME, isDefault: true, userId: null },
    });
  }

  // ── Admin user ───────────────────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin@1234', BCRYPT_ROUNDS);
  const admin = await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@family.local',
      passwordHash: adminPassword,
      role: Role.ADMIN,
      colorTag: '#6366f1',
      mustChangePassword: true,
    },
  });

  // ── Demo bank account ────────────────────────────────────────────────────────
  await prisma.bankAccount.create({
    data: {
      userId: admin.id,
      bankName: 'HDFC Bank',
      ifscPrefix: 'HDFC',
      accountNumberLast4: '1234',
      accountType: AccountType.SAVINGS,
      currentBalance: 250000,
      upiId: 'admin@hdfcbank',
    },
  });

  // ── Demo loan ────────────────────────────────────────────────────────────────
  await prisma.loan.create({
    data: {
      userId: admin.id,
      lenderName: 'HDFC Bank',
      loanType: LoanType.HOME,
      principalAmount: 5000000,
      outstandingBalance: 4200000,
      interestRate: 8.75,
      emiAmount: 44000,
      emiDate: 5,
      tenureMonths: 240,
      disbursementDate: new Date('2022-04-01'),
      endDate: new Date('2042-04-01'),
      section24bEligible: true,
      isTaxDeductible: true,
    },
  });

  // ── Demo FD ──────────────────────────────────────────────────────────────────
  await prisma.fixedDeposit.create({
    data: {
      userId: admin.id,
      bankName: 'SBI',
      principalAmount: 500000,
      interestRate: 7.1,
      tenureMonths: 24,
      startDate: new Date('2024-01-15'),
      maturityDate: new Date('2026-01-15'),
      maturityAmount: 576620,
      interestPayoutType: 'CUMULATIVE',
      isTaxSaver: false,
      tdsApplicable: true,
      status: 'ACTIVE',
    },
  });

  console.log('');
  console.log('========================================');
  console.log('  FIRST_RUN=true');
  console.log('  Family Finance Tracker is ready!');
  console.log('');
  console.log('  Default admin credentials:');
  console.log('  Email: admin@family.local');
  console.log('  Password: Admin@1234');
  console.log('');
  console.log('  ⚠️  Please change your password after first login!');
  console.log('========================================');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
