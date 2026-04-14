import {
  PrismaClient,
  Role,
  AccountType,
  CategoryType,
  LoanType,
  InvestmentType,
  Exchange,
  GoldType,
  PropertyType,
  PremiumFrequency,
  SIPStatus,
  SIPTransactionType,
  FDStatus,
  RDStatus,
  TransactionType,
  PaymentMode,
  InsurancePolicyType,
  BudgetPeriod,
  TaxRegime,
  TaxSection,
  FDInterestPayoutType,
  CapitalGainAssetType,
  OtherSourceType,
  HousePropertyUsage,
  ForeignAssetCategory,
  RecurringFrequency,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

// ── Date helpers ──────────────────────────────────────────────────────────────
function d(yyyy: number, mm: number, dd: number) {
  return new Date(`${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T12:00:00+05:30`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Seeding database...');

  const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (existingAdmin) {
    console.log('✓ Database already seeded — skipping');
    return;
  }

  // ── Family ──────────────────────────────────────────────────────────────────
  await prisma.family.create({
    data: { name: 'Sharma Family', currency: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata', fyStartMonth: 4 },
  });

  // ── Advance tax calendar ─────────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const fyStartYear = currentMonth >= 4 ? currentYear : currentYear - 1;
  for (const yearOffset of [0, 1]) {
    const y = fyStartYear + yearOffset;
    const fyLabel = `${y}-${String(y + 1).slice(-2)}`;
    await prisma.advanceTaxEvent.createMany({
      data: [
        { fyYear: fyLabel, dueDate: d(y, 6, 15), percentageDue: 15, description: '1st Installment — 15% of estimated tax due by June 15', isSystemGenerated: true },
        { fyYear: fyLabel, dueDate: d(y, 9, 15), percentageDue: 45, description: '2nd Installment — 45% cumulative by September 15', isSystemGenerated: true },
        { fyYear: fyLabel, dueDate: d(y, 12, 15), percentageDue: 75, description: '3rd Installment — 75% cumulative by December 15', isSystemGenerated: true },
        { fyYear: fyLabel, dueDate: d(y + 1, 3, 15), percentageDue: 100, description: '4th Installment — 100% cumulative by March 15', isSystemGenerated: true },
      ],
    });
  }

  // ── Exchange rates ───────────────────────────────────────────────────────────
  await prisma.exchangeRate.createMany({
    data: [
      { fromCurrency: 'USD', toCurrency: 'INR', rate: 83.50 },
      { fromCurrency: 'GBP', toCurrency: 'INR', rate: 106.00 },
      { fromCurrency: 'EUR', toCurrency: 'INR', rate: 90.50 },
      { fromCurrency: 'SGD', toCurrency: 'INR', rate: 62.00 },
    ],
    skipDuplicates: true,
  });

  // ── Categories ───────────────────────────────────────────────────────────────
  const expenseCats = [
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
  const incomeCats = [
    { name: 'Salary', icon: '💼', color: '#10b981' },
    { name: 'Freelance/Consulting', icon: '💻', color: '#059669' },
    { name: 'Rental Income', icon: '🏘️', color: '#047857' },
    { name: 'FD Interest', icon: '🏦', color: '#0284c7' },
    { name: 'Dividend', icon: '📈', color: '#0369a1' },
    { name: 'Capital Gains', icon: '📊', color: '#7c3aed' },
    { name: 'Bonus', icon: '🎯', color: '#d97706' },
    { name: 'Other Income', icon: '💰', color: '#16a34a' },
  ];

  const assetCats = [
    { name: 'Bank & Cash', icon: '🏦', color: '#3b82f6' },
    { name: 'Mutual Funds & Stocks', icon: '📈', color: '#8b5cf6' },
    { name: 'Fixed Deposits', icon: '📄', color: '#0284c7' },
    { name: 'Provident Fund', icon: '🛡️', color: '#0369a1' },
    { name: 'Gold', icon: '🪙', color: '#f59e0b' },
    { name: 'Real Estate', icon: '🏠', color: '#10b981' },
    { name: 'Vehicle', icon: '🚗', color: '#64748b' },
    { name: 'Other Assets', icon: '💼', color: '#94a3b8' },
  ];
  const liabilityCats = [
    { name: 'Home Loan', icon: '🏡', color: '#ef4444' },
    { name: 'Car Loan', icon: '🚘', color: '#f97316' },
    { name: 'Personal Loan', icon: '💳', color: '#f43f5e' },
    { name: 'Education Loan', icon: '🎓', color: '#f59e0b' },
    { name: 'Credit Card', icon: '💲', color: '#dc2626' },
    { name: 'Other Liabilities', icon: '📋', color: '#94a3b8' },
  ];

  const catMap: Record<string, string> = {};
  for (const cat of expenseCats) {
    const c = await prisma.category.upsert({
      where: { name_type: { name: cat.name, type: CategoryType.EXPENSE } },
      update: { icon: cat.icon, color: cat.color, isDefault: true, userId: null },
      create: { ...cat, type: CategoryType.EXPENSE, isDefault: true, userId: null },
    });
    catMap[cat.name] = c.id;
  }
  for (const cat of incomeCats) {
    const c = await prisma.category.upsert({
      where: { name_type: { name: cat.name, type: CategoryType.INCOME } },
      update: { icon: cat.icon, color: cat.color, isDefault: true, userId: null },
      create: { ...cat, type: CategoryType.INCOME, isDefault: true, userId: null },
    });
    catMap[cat.name] = c.id;
  }
  for (const cat of assetCats) {
    await prisma.category.upsert({
      where: { name_type: { name: cat.name, type: CategoryType.ASSET } },
      update: { icon: cat.icon, color: cat.color, isDefault: true, userId: null },
      create: { ...cat, type: CategoryType.ASSET, isDefault: true, userId: null },
    });
  }
  for (const cat of liabilityCats) {
    await prisma.category.upsert({
      where: { name_type: { name: cat.name, type: CategoryType.LIABILITY } },
      update: { icon: cat.icon, color: cat.color, isDefault: true, userId: null },
      create: { ...cat, type: CategoryType.LIABILITY, isDefault: true, userId: null },
    });
  }

  // ── Users ────────────────────────────────────────────────────────────────────
  const [adminPwd, memberPwd] = await Promise.all([
    bcrypt.hash('Admin@1234', BCRYPT_ROUNDS),
    bcrypt.hash('Member@1234', BCRYPT_ROUNDS),
  ]);

  const rajesh = await prisma.user.create({
    data: {
      name: 'Rajesh Sharma',
      email: 'admin@family.local',
      passwordHash: adminPwd,
      role: Role.ADMIN,
      colorTag: '#6366f1',
      mustChangePassword: false,
      panNumberMasked: 'ABCPS****K',
    },
  });

  const priya = await prisma.user.create({
    data: {
      name: 'Priya Sharma',
      email: 'priya@family.local',
      passwordHash: memberPwd,
      role: Role.MEMBER,
      colorTag: '#ec4899',
      mustChangePassword: false,
      panNumberMasked: 'BRTPS****A',
    },
  });

  const arjun = await prisma.user.create({
    data: {
      name: 'Arjun Sharma',
      email: 'arjun@family.local',
      passwordHash: memberPwd,
      role: Role.MEMBER,
      colorTag: '#f97316',
      mustChangePassword: false,
    },
  });

  // ── Bank Accounts ────────────────────────────────────────────────────────────
  const rajeshHDFC = await prisma.bankAccount.create({ data: {
    userId: rajesh.id, bankName: 'HDFC Bank', ifscPrefix: 'HDFC', accountNumberLast4: '4821',
    accountType: AccountType.SALARY, currentBalance: 185000, upiId: 'rajesh.sharma@hdfcbank', isActive: true,
  }});
  const rajeshICICI = await prisma.bankAccount.create({ data: {
    userId: rajesh.id, bankName: 'ICICI Bank', ifscPrefix: 'ICIC', accountNumberLast4: '9034',
    accountType: AccountType.SAVINGS, currentBalance: 75000, upiId: 'rajesh@icici', isActive: true,
  }});
  const rajeshSBI = await prisma.bankAccount.create({ data: {
    userId: rajesh.id, bankName: 'State Bank of India', ifscPrefix: 'SBIN', accountNumberLast4: '2277',
    accountType: AccountType.PPF, currentBalance: 450000, interestRate: 7.1, isActive: true,
  }});

  const priyaAxis = await prisma.bankAccount.create({ data: {
    userId: priya.id, bankName: 'Axis Bank', ifscPrefix: 'UTIB', accountNumberLast4: '5512',
    accountType: AccountType.SALARY, currentBalance: 62000, upiId: 'priya.sharma@axisbank', isActive: true,
  }});
  const priyaSBI = await prisma.bankAccount.create({ data: {
    userId: priya.id, bankName: 'State Bank of India', ifscPrefix: 'SBIN', accountNumberLast4: '8841',
    accountType: AccountType.SAVINGS, currentBalance: 115000, isActive: true,
  }});

  const arjunKotak = await prisma.bankAccount.create({ data: {
    userId: arjun.id, bankName: 'Kotak Mahindra Bank', ifscPrefix: 'KKBK', accountNumberLast4: '3390',
    accountType: AccountType.SAVINGS, currentBalance: 28000, upiId: 'arjun.sharma@kotak', isActive: true,
  }});

  // ── Fixed Deposits ────────────────────────────────────────────────────────────
  await prisma.fixedDeposit.createMany({ data: [
    {
      userId: rajesh.id, bankAccountId: rajeshSBI.id, bankName: 'State Bank of India',
      principalAmount: 500000, interestRate: 7.1, tenureMonths: 24,
      startDate: d(2024, 1, 15), maturityDate: d(2026, 1, 15), maturityAmount: 576620,
      interestPayoutType: FDInterestPayoutType.CUMULATIVE, isTaxSaver: false, tdsApplicable: true, status: FDStatus.ACTIVE,
    },
    {
      userId: rajesh.id, bankAccountId: rajeshHDFC.id, bankName: 'HDFC Bank',
      principalAmount: 150000, interestRate: 7.25, tenureMonths: 60,
      startDate: d(2023, 4, 1), maturityDate: d(2028, 4, 1), maturityAmount: 213750,
      interestPayoutType: FDInterestPayoutType.CUMULATIVE, isTaxSaver: true, tdsApplicable: false, status: FDStatus.ACTIVE,
    },
    {
      userId: priya.id, bankAccountId: priyaSBI.id, bankName: 'State Bank of India',
      principalAmount: 200000, interestRate: 7.0, tenureMonths: 18,
      startDate: d(2025, 1, 10), maturityDate: d(2026, 7, 10), maturityAmount: 221500,
      interestPayoutType: FDInterestPayoutType.QUARTERLY, isTaxSaver: false, tdsApplicable: true, status: FDStatus.ACTIVE,
    },
    {
      userId: arjun.id, bankName: 'Kotak Mahindra Bank',
      principalAmount: 50000, interestRate: 7.4, tenureMonths: 12,
      startDate: d(2025, 8, 1), maturityDate: d(2026, 8, 1), maturityAmount: 53700,
      interestPayoutType: FDInterestPayoutType.CUMULATIVE, isTaxSaver: false, tdsApplicable: false, status: FDStatus.ACTIVE,
    },
  ]});

  // ── Recurring Deposits ────────────────────────────────────────────────────────
  await prisma.recurringDeposit.createMany({ data: [
    {
      userId: priya.id, bankName: 'State Bank of India',
      monthlyInstallment: 5000, interestRate: 6.8, tenureMonths: 36,
      startDate: d(2024, 4, 1), maturityDate: d(2027, 4, 1), maturityAmount: 200700,
      totalDeposited: 120000, status: RDStatus.ACTIVE,
    },
    {
      userId: rajesh.id, bankName: 'HDFC Bank',
      monthlyInstallment: 10000, interestRate: 7.0, tenureMonths: 24,
      startDate: d(2025, 6, 1), maturityDate: d(2027, 6, 1), maturityAmount: 258200,
      totalDeposited: 100000, status: RDStatus.ACTIVE,
    },
  ]});

  // ── Investments ───────────────────────────────────────────────────────────────
  const miraeFund = await prisma.investment.create({ data: {
    userId: rajesh.id, type: InvestmentType.ELSS, name: 'Mirae Asset Tax Saver Fund',
    folioNumber: 'MAF/12345678', isin: 'INF769K01EY6',
    unitsOrQuantity: 3842.51, purchasePricePerUnit: 28.5, currentPricePerUnit: 38.92,
    purchaseDate: d(2021, 4, 5), purchaseNav: 28.5, currentNav: 38.92,
    isTaxSaving: true, lockInEndDate: d(2024, 4, 5),
    absoluteReturnPct: 36.56, notes: 'SIP ongoing — 80C eligible',
  }});

  const hdfcMidCap = await prisma.investment.create({ data: {
    userId: rajesh.id, type: InvestmentType.MUTUAL_FUND, name: 'HDFC Mid-Cap Opportunities Fund',
    folioNumber: 'HDFC/87654321', isin: 'INF179K01LL6',
    unitsOrQuantity: 2156.44, purchasePricePerUnit: 62.3, currentPricePerUnit: 89.45,
    purchaseDate: d(2020, 7, 15), purchaseNav: 62.3, currentNav: 89.45,
    isTaxSaving: false, absoluteReturnPct: 43.57,
  }});

  await prisma.investment.createMany({ data: [
    {
      userId: rajesh.id, type: InvestmentType.STOCKS_INDIA, name: 'Reliance Industries Ltd',
      tickerSymbolNSE: 'RELIANCE',
      unitsOrQuantity: 50, purchasePricePerUnit: 2200, currentPricePerUnit: 2945,
      purchaseDate: d(2022, 11, 10), isTaxSaving: false, absoluteReturnPct: 33.86,
    },
    {
      userId: rajesh.id, type: InvestmentType.STOCKS_INDIA, name: 'Infosys Ltd',
      tickerSymbolNSE: 'INFY',
      unitsOrQuantity: 40, purchasePricePerUnit: 1350, currentPricePerUnit: 1728,
      purchaseDate: d(2023, 3, 22), isTaxSaving: false, absoluteReturnPct: 28.0,
    },
    {
      userId: rajesh.id, type: InvestmentType.EPF, name: 'Employees Provident Fund',
      unitsOrQuantity: 1, purchasePricePerUnit: 850000, currentPricePerUnit: 1020000,
      purchaseDate: d(2012, 6, 1), isTaxSaving: true, absoluteReturnPct: 20.0,
      notes: 'Accumulated EPF corpus',
    },
    {
      userId: rajesh.id, type: InvestmentType.NPS, name: 'NPS Tier 1 — Rajesh Sharma',
      unitsOrQuantity: 1, purchasePricePerUnit: 220000, currentPricePerUnit: 318000,
      purchaseDate: d(2018, 4, 1), isTaxSaving: true, absoluteReturnPct: 44.55,
      notes: '80CCD(1B) additional ₹50,000 deduction',
    },
  ]});

  // Create Priya & Arjun investments individually to capture IDs for SIPs
  const priyaBluechip = await prisma.investment.create({ data: {
    userId: priya.id, type: InvestmentType.MUTUAL_FUND, name: 'Axis Bluechip Fund',
    folioNumber: 'AXS/55667788', isin: 'INF846K01DP8',
    unitsOrQuantity: 1840.22, purchasePricePerUnit: 35.8, currentPricePerUnit: 50.64,
    purchaseDate: d(2021, 9, 1), purchaseNav: 35.8, currentNav: 50.64,
    isTaxSaving: false, absoluteReturnPct: 41.45,
  }});
  await prisma.investment.create({ data: {
    userId: priya.id, type: InvestmentType.ELSS, name: 'SBI Tax Advantage Fund',
    folioNumber: 'SBI/99887766', isin: 'INF200K01RO2',
    unitsOrQuantity: 1250.88, purchasePricePerUnit: 40.0, currentPricePerUnit: 57.32,
    purchaseDate: d(2022, 4, 5), purchaseNav: 40.0, currentNav: 57.32,
    isTaxSaving: true, lockInEndDate: d(2025, 4, 5), absoluteReturnPct: 43.3,
  }});
  const arjunNifty = await prisma.investment.create({ data: {
    userId: arjun.id, type: InvestmentType.MUTUAL_FUND, name: 'Nifty 50 Index Fund — Zerodha',
    folioNumber: 'ZER/11223344',
    unitsOrQuantity: 520.0, purchasePricePerUnit: 45.0, currentPricePerUnit: 62.4,
    purchaseDate: d(2023, 7, 1), isTaxSaving: false, absoluteReturnPct: 38.67,
  }});
  await prisma.investment.create({ data: {
    userId: arjun.id, type: InvestmentType.STOCKS_INDIA, name: 'Tata Consultancy Services',
    tickerSymbolNSE: 'TCS',
    unitsOrQuantity: 5, purchasePricePerUnit: 3500, currentPricePerUnit: 4150,
    purchaseDate: d(2024, 2, 14), isTaxSaving: false, absoluteReturnPct: 18.57,
  }});

  // ── SIPs ──────────────────────────────────────────────────────────────────────
  await prisma.sIP.createMany({ data: [
    {
      userId: rajesh.id, investmentId: miraeFund.id, fundName: 'Mirae Asset Tax Saver Fund',
      folioNumber: 'MAF/12345678', monthlyAmount: 12500, sipDate: 5,
      startDate: d(2021, 4, 5), status: SIPStatus.ACTIVE, bankAccountId: rajeshHDFC.id,
    },
    {
      userId: rajesh.id, investmentId: hdfcMidCap.id, fundName: 'HDFC Mid-Cap Opportunities Fund',
      folioNumber: 'HDFC/87654321', monthlyAmount: 10000, sipDate: 10,
      startDate: d(2020, 7, 10), status: SIPStatus.ACTIVE, bankAccountId: rajeshHDFC.id,
    },
    {
      userId: priya.id, investmentId: priyaBluechip.id, fundName: 'Axis Bluechip Fund',
      folioNumber: 'AXS/55667788', monthlyAmount: 5000, sipDate: 3,
      startDate: d(2021, 9, 3), status: SIPStatus.ACTIVE, bankAccountId: priyaAxis.id,
    },
    {
      userId: arjun.id, investmentId: arjunNifty.id, fundName: 'Nifty 50 Index Fund — Zerodha',
      folioNumber: 'ZER/11223344', monthlyAmount: 2000, sipDate: 15,
      startDate: d(2023, 7, 15), status: SIPStatus.ACTIVE, bankAccountId: arjunKotak.id,
    },
  ]});

  // ── SIP Transactions (12 monthly installments per SIP — needed for XIRR) ───────
  // Mirae Asset ELSS SIP — Rajesh (₹12,500/month, NAV growing from 34 to 38.92)
  await prisma.sIPTransaction.createMany({ data: [
    { investmentId: miraeFund.id, date: d(2025, 4, 5), units: 367.65, nav: 34.00, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2025, 5, 5), units: 362.32, nav: 34.50, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2025, 6, 5), units: 357.14, nav: 35.00, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2025, 7, 5), units: 352.11, nav: 35.50, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2025, 8, 5), units: 347.22, nav: 36.00, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2025, 9, 5), units: 342.47, nav: 36.50, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2025, 10, 5), units: 337.84, nav: 37.00, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2025, 11, 5), units: 333.33, nav: 37.50, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2025, 12, 5), units: 328.95, nav: 38.00, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2026, 1, 5), units: 326.80, nav: 38.25, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2026, 2, 5), units: 324.68, nav: 38.50, amount: 12500, type: SIPTransactionType.BUY },
    { investmentId: miraeFund.id, date: d(2026, 3, 5), units: 321.23, nav: 38.92, amount: 12500, type: SIPTransactionType.BUY },
  ]});

  // HDFC Mid-Cap SIP — Rajesh (₹10,000/month, NAV growing from 81 to 89.45)
  await prisma.sIPTransaction.createMany({ data: [
    { investmentId: hdfcMidCap.id, date: d(2025, 4, 10), units: 123.46, nav: 81.00, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2025, 5, 10), units: 121.95, nav: 82.00, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2025, 6, 10), units: 120.48, nav: 83.00, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2025, 7, 10), units: 119.05, nav: 84.00, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2025, 8, 10), units: 117.65, nav: 85.00, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2025, 9, 10), units: 116.28, nav: 86.00, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2025, 10, 10), units: 114.94, nav: 87.00, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2025, 11, 10), units: 113.64, nav: 88.00, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2025, 12, 10), units: 112.36, nav: 89.00, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2026, 1, 10), units: 111.98, nav: 89.30, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2026, 2, 10), units: 111.86, nav: 89.40, amount: 10000, type: SIPTransactionType.BUY },
    { investmentId: hdfcMidCap.id, date: d(2026, 3, 10), units: 111.73, nav: 89.45, amount: 10000, type: SIPTransactionType.BUY },
  ]});

  // Axis Bluechip SIP — Priya (₹5,000/month, NAV growing from 46 to 50.64)
  await prisma.sIPTransaction.createMany({ data: [
    { investmentId: priyaBluechip.id, date: d(2025, 4, 3), units: 108.70, nav: 46.00, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2025, 5, 3), units: 106.83, nav: 46.80, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2025, 6, 3), units: 105.04, nav: 47.60, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2025, 7, 3), units: 103.31, nav: 48.40, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2025, 8, 3), units: 101.63, nav: 49.20, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2025, 9, 3), units: 100.00, nav: 50.00, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2025, 10, 3), units: 99.40, nav: 50.30, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2025, 11, 3), units: 98.62, nav: 50.70, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2025, 12, 3), units: 98.04, nav: 51.00, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2026, 1, 3), units: 98.43, nav: 50.80, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2026, 2, 3), units: 98.23, nav: 50.90, amount: 5000, type: SIPTransactionType.BUY },
    { investmentId: priyaBluechip.id, date: d(2026, 3, 3), units: 98.04, nav: 51.00, amount: 5000, type: SIPTransactionType.BUY },
  ]});

  // Nifty 50 Index Fund SIP — Arjun (₹2,000/month, NAV growing from 58 to 62.4)
  await prisma.sIPTransaction.createMany({ data: [
    { investmentId: arjunNifty.id, date: d(2025, 4, 15), units: 34.48, nav: 58.00, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2025, 5, 15), units: 33.90, nav: 59.00, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2025, 6, 15), units: 33.33, nav: 60.00, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2025, 7, 15), units: 32.79, nav: 61.00, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2025, 8, 15), units: 32.26, nav: 62.00, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2025, 9, 15), units: 32.05, nav: 62.40, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2025, 10, 15), units: 31.85, nav: 62.80, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2025, 11, 15), units: 31.65, nav: 63.20, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2025, 12, 15), units: 31.45, nav: 63.60, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2026, 1, 15), units: 31.25, nav: 64.00, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2026, 2, 15), units: 31.09, nav: 64.32, amount: 2000, type: SIPTransactionType.BUY },
    { investmentId: arjunNifty.id, date: d(2026, 3, 15), units: 30.92, nav: 64.68, amount: 2000, type: SIPTransactionType.BUY },
  ]});

  // ── Gold Holdings ─────────────────────────────────────────────────────────────
  await prisma.goldHolding.createMany({ data: [
    {
      userId: priya.id, type: GoldType.PHYSICAL, quantityGrams: 120,
      purchasePricePerGram: 4800, currentPricePerGram: 7850,
      purchaseDate: d(2015, 11, 14), notes: 'Family jewellery — Diwali 2015',
    },
    {
      userId: priya.id, type: GoldType.SGB, quantityGrams: 16,
      purchasePricePerGram: 5600, currentPricePerGram: 7850,
      purchaseDate: d(2021, 5, 20), notes: 'SGB Series 2021-22 — 4 units of 4g each',
    },
    {
      userId: rajesh.id, type: GoldType.GOLD_ETF, quantityGrams: 20,
      purchasePricePerGram: 5200, currentPricePerGram: 7850,
      purchaseDate: d(2022, 8, 10), notes: 'Nippon India Gold ETF via Demat',
    },
  ]});

  // ── Loans ────────────────────────────────────────────────────────────────────
  const homeLoan = await prisma.loan.create({ data: {
    userId: rajesh.id, lenderName: 'HDFC Bank', loanAccountNumber: 'HDFCHL00234561',
    loanType: LoanType.HOME, principalAmount: 5000000, outstandingBalance: 3950000,
    interestRate: 8.75, emiAmount: 44000, emiDate: 5, tenureMonths: 240,
    disbursementDate: d(2020, 6, 1), endDate: d(2040, 6, 1),
    section24bEligible: true, isTaxDeductible: true, prepaymentChargesPct: 0,
  }});

  await prisma.loan.create({ data: {
    userId: rajesh.id, lenderName: 'HDFC Bank', loanAccountNumber: 'HDFCAL00891234',
    loanType: LoanType.AUTO, principalAmount: 800000, outstandingBalance: 420000,
    interestRate: 9.5, emiAmount: 16500, emiDate: 10, tenureMonths: 60,
    disbursementDate: d(2022, 9, 15), endDate: d(2027, 9, 15),
    section24bEligible: false, isTaxDeductible: false,
  }});

  const priyaEduLoan = await prisma.loan.create({ data: {
    userId: priya.id, lenderName: 'SBI', loanAccountNumber: 'SBIEDU00112233',
    loanType: LoanType.EDUCATION, principalAmount: 300000, outstandingBalance: 175000,
    interestRate: 8.5, emiAmount: 6155, emiDate: 15, tenureMonths: 60,
    disbursementDate: d(2021, 7, 1), endDate: d(2026, 7, 1),
    section24bEligible: false, isTaxDeductible: true,
  }});

  // ── Loan Prepayments ─────────────────────────────────────────────────────────
  await prisma.loanPrepayment.createMany({ data: [
    {
      loanId: homeLoan.id, amount: 200000, date: d(2025, 10, 1),
      notes: 'Diwali bonus prepayment — reduce tenure strategy',
      tenureReduced: 6,
    },
    {
      loanId: homeLoan.id, amount: 100000, date: d(2026, 2, 15),
      notes: 'Tax refund reinvested into home loan principal',
      tenureReduced: 3,
    },
    {
      loanId: priyaEduLoan.id, amount: 50000, date: d(2025, 7, 10),
      notes: 'Partial prepayment from semester savings',
      tenureReduced: 9,
    },
  ]});

  // ── Real Estate ───────────────────────────────────────────────────────────────
  await prisma.realEstate.create({ data: {
    userId: rajesh.id, propertyType: PropertyType.RESIDENTIAL,
    propertyName: '3BHK Apartment — Whitefield, Bangalore', location: 'Whitefield, Bangalore, Karnataka',
    purchasePrice: 6500000, currentValue: 9800000,
    purchaseDate: d(2020, 6, 1), loanId: homeLoan.id, rentalIncomeMonthly: 0,
    notes: 'Primary residence — under home loan',
  }});

  // ── Insurance ────────────────────────────────────────────────────────────────
  const nextPremiumDate = (day: number) => {
    const now = new Date();
    const candidate = new Date(now.getFullYear(), now.getMonth(), day);
    if (candidate < now) candidate.setMonth(candidate.getMonth() + 1);
    return candidate;
  };

  await prisma.insurancePolicy.createMany({ data: [
    {
      userId: rajesh.id, policyType: InsurancePolicyType.TERM_LIFE, providerName: 'HDFC Life',
      policyNumber: 'HDFC-TL-2019-00112', policyName: 'HDFC Click2Protect 3D Plus',
      sumAssured: 10000000, premiumAmount: 18500, premiumFrequency: PremiumFrequency.ANNUALLY,
      premiumDueDate: 7, startDate: d(2019, 4, 7), endDate: d(2049, 4, 7),
      nomineeName: 'Priya Sharma', is80cEligible: true, is80dEligible: false,
    },
    {
      userId: rajesh.id, policyType: InsurancePolicyType.HEALTH, providerName: 'Star Health Insurance',
      policyNumber: 'STAR-HLT-2023-45678', policyName: 'Star Comprehensive Family Floater',
      sumAssured: 1000000, premiumAmount: 22000, premiumFrequency: PremiumFrequency.ANNUALLY,
      premiumDueDate: 20, startDate: d(2023, 7, 20), endDate: d(2026, 7, 20),
      nomineeName: 'Priya Sharma', is80cEligible: false, is80dEligible: true, isForParents: false,
    },
    {
      userId: rajesh.id, policyType: InsurancePolicyType.VEHICLE, providerName: 'ICICI Lombard',
      policyNumber: 'ICICI-VH-2025-77891', policyName: 'Complete Vehicle Insurance — Maruti Swift',
      sumAssured: 750000, premiumAmount: 9200, premiumFrequency: PremiumFrequency.ANNUALLY,
      premiumDueDate: 15, startDate: d(2025, 3, 15), endDate: d(2026, 3, 15),
      is80cEligible: false, is80dEligible: false,
    },
    {
      userId: priya.id, policyType: InsurancePolicyType.SUPER_TOP_UP, providerName: 'Niva Bupa',
      policyNumber: 'NIVA-STU-2024-33456', policyName: 'ReAssure Super Top-Up',
      sumAssured: 1500000, premiumAmount: 8500, premiumFrequency: PremiumFrequency.ANNUALLY,
      premiumDueDate: 12, startDate: d(2024, 8, 12), endDate: d(2027, 8, 12),
      is80cEligible: false, is80dEligible: true, isForParents: false,
    },
    {
      userId: priya.id, policyType: InsurancePolicyType.HEALTH, providerName: 'Star Health Insurance',
      policyNumber: 'STAR-HLT-2022-89012', policyName: 'Star Senior Citizen Red Carpet — Parents',
      sumAssured: 500000, premiumAmount: 32000, premiumFrequency: PremiumFrequency.ANNUALLY,
      premiumDueDate: 5, startDate: d(2022, 10, 5), endDate: d(2026, 10, 5),
      nomineeName: 'Priya Sharma', is80cEligible: false, is80dEligible: true, isForParents: true,
      notes: 'Parents coverage — 80D sub-limit ₹50K for senior citizens',
    },
    {
      userId: arjun.id, policyType: InsurancePolicyType.PERSONAL_ACCIDENT, providerName: 'Bajaj Allianz',
      policyNumber: 'BAJAJ-PA-2025-55123', policyName: 'Personal Accident Guard',
      sumAssured: 2500000, premiumAmount: 3200, premiumFrequency: PremiumFrequency.ANNUALLY,
      premiumDueDate: 20, startDate: d(2025, 1, 20), endDate: d(2026, 1, 20),
      is80cEligible: false, is80dEligible: false,
    },
  ]});

  // ── Budgets (FY 2025-26) ──────────────────────────────────────────────────────
  const fy = `${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
  const budgetData = [
    { catName: 'Groceries', amount: 15000 },
    { catName: 'Vegetables & Dairy', amount: 5000 },
    { catName: 'Eating Out', amount: 10000 },
    { catName: 'Petrol/CNG', amount: 6000 },
    { catName: 'Electricity', amount: 4000 },
    { catName: 'Mobile & Internet', amount: 2500 },
    { catName: 'DTH & OTT', amount: 2000 },
    { catName: 'Medical & Pharmacy', amount: 3000 },
    { catName: 'Maid/Cook/Driver', amount: 9000 },
    { catName: 'Entertainment', amount: 5000 },
    { catName: 'Personal Care', amount: 3000 },
    { catName: 'Clothing & Footwear', amount: 5000 },
    { catName: 'Travel & Holidays', amount: 20000 },
    { catName: 'Gifts & Festivals', amount: 8000 },
  ];
  for (const b of budgetData) {
    if (catMap[b.catName]) {
      await prisma.budget.create({
        data: {
          userId: rajesh.id, categoryId: catMap[b.catName],
          amount: b.amount, period: BudgetPeriod.MONTHLY, fyYear: fy,
          startDate: d(fyStartYear, 4, 1), endDate: d(fyStartYear + 1, 3, 31),
        },
      });
    }
  }

  // ── Priya budgets (FY 2025-26) ───────────────────────────────────────────────
  const priyaBudgetData = [
    { catName: 'Personal Care', amount: 3500 },
    { catName: 'Clothing & Footwear', amount: 4000 },
    { catName: 'Groceries', amount: 6000 },
    { catName: 'Eating Out', amount: 4000 },
    { catName: 'Medical & Pharmacy', amount: 3000 },
    { catName: 'Auto/Cab', amount: 2000 },
    { catName: 'School/Tuition Fees', amount: 8000 },
    { catName: 'Entertainment', amount: 2000 },
  ];
  for (const b of priyaBudgetData) {
    if (catMap[b.catName]) {
      await prisma.budget.create({
        data: {
          userId: priya.id, categoryId: catMap[b.catName],
          amount: b.amount, period: BudgetPeriod.MONTHLY, fyYear: fy,
          startDate: d(fyStartYear, 4, 1), endDate: d(fyStartYear + 1, 3, 31),
        },
      });
    }
  }

  // ── Tax Profiles (FY 2025-26) ─────────────────────────────────────────────────
  await prisma.taxProfile.create({ data: {
    userId: rajesh.id, fyYear: fy, regime: TaxRegime.OLD,
    grossSalary: 2200000, hraReceived: 360000, hraExempt: 240000,
    standardDeduction: 50000,
    deduction80C: 143500,   // ELSS SIP ₹75K + PPF ₹50K + Term Life premium ₹18.5K
    deduction80D: 22000,    // health insurance self
    deduction80E: 0,
    deduction80G: 10000,    // charity donations
    deduction24B: 200000,   // home loan interest (max cap)
    nps80Ccd1B: 50000,      // NPS additional
    otherDeductions: 0,
    taxPaidAdvance: 80000,
    taxPaidTds: 180000,
    taxPaidSelfAssessment: 0,
    estimatedTaxLiability: 285000,
  }});

  await prisma.taxProfile.create({ data: {
    userId: priya.id, fyYear: fy, regime: TaxRegime.NEW,
    grossSalary: 900000, hraReceived: 180000, hraExempt: 0,
    standardDeduction: 75000,   // New regime standard deduction
    deduction80C: 0,
    deduction80D: 0,
    otherDeductions: 0,
    taxPaidAdvance: 0,
    taxPaidTds: 28000,
    taxPaidSelfAssessment: 0,
    estimatedTaxLiability: 28000,
  }});

  // ── Arjun TaxProfile (FY 2025-26 — New Regime, student / part-time freelancer) ─
  await prisma.taxProfile.create({ data: {
    userId: arjun.id, fyYear: fy, regime: TaxRegime.NEW,
    grossSalary: 0,
    standardDeduction: 0,
    deduction80C: 0,
    deduction80D: 0,
    taxPaidAdvance: 0,
    taxPaidTds: 0,
    taxPaidSelfAssessment: 0,
    estimatedTaxLiability: 0,
  }});

  // ── Tax Entries (individual deduction records for Rajesh & Priya) ───────────
  await prisma.taxEntry.createMany({ data: [
    // Rajesh 80C
    { userId: rajesh.id, fyYear: fy, regime: TaxRegime.OLD, section: TaxSection.S80C, amount: 75000, description: 'Mirae Asset ELSS SIP — FY 2025-26 (12 × ₹12,500 × 80% locked-in)', proofUploaded: true, entityType: 'Investment', entityId: miraeFund.id },
    { userId: rajesh.id, fyYear: fy, regime: TaxRegime.OLD, section: TaxSection.S80C, amount: 50000, description: 'PPF contribution FY 2025-26', proofUploaded: true },
    { userId: rajesh.id, fyYear: fy, regime: TaxRegime.OLD, section: TaxSection.S80C, amount: 18500, description: 'HDFC Life Term Insurance premium', proofUploaded: true },
    // Rajesh 80D
    { userId: rajesh.id, fyYear: fy, regime: TaxRegime.OLD, section: TaxSection.S80D, amount: 22000, description: 'Star Health Family Floater premium', proofUploaded: true },
    // Rajesh 80CCD(1B) — NPS
    { userId: rajesh.id, fyYear: fy, regime: TaxRegime.OLD, section: TaxSection.S80CCD1B, amount: 50000, description: 'NPS Tier 1 contribution — additional deduction ₹50K', proofUploaded: true },
    // Rajesh 24(B) — home loan interest
    { userId: rajesh.id, fyYear: fy, regime: TaxRegime.OLD, section: TaxSection.SECTION_24B, amount: 200000, description: 'HDFC Home Loan interest deduction (capped at ₹2L)', proofUploaded: false },
    // Rajesh 80G
    { userId: rajesh.id, fyYear: fy, regime: TaxRegime.OLD, section: TaxSection.S80G, amount: 10000, description: 'PM CARES / CRY Foundation donation', proofUploaded: false },
    // Note: Priya is on NEW regime — 80D and 80E deductions do not apply.
  ]});

  // ── Transactions (FY 2025-26: April 2025 – March 2026) ─────────────────────
  // Helper to create a batch of transactions
  async function createTxns(txns: Array<{
    userId: string; bankAccountId: string; categoryId: string;
    amount: number; type: TransactionType; paymentMode: PaymentMode;
    description: string; date: Date; tags?: string[]; isRecurring?: boolean;
  }>) {
    for (const t of txns) {
      await prisma.transaction.create({ data: { ...t, tags: t.tags ?? [] } });
    }
  }

  // Monthly salary and recurring expenses for Rajesh (Apr 2025 – Mar 2026)
  const months = [
    { y: 2025, m: 4 }, { y: 2025, m: 5 }, { y: 2025, m: 6 },
    { y: 2025, m: 7 }, { y: 2025, m: 8 }, { y: 2025, m: 9 },
    { y: 2025, m: 10 }, { y: 2025, m: 11 }, { y: 2025, m: 12 },
    { y: 2026, m: 1 }, { y: 2026, m: 2 }, { y: 2026, m: 3 },
  ];

  for (const { y, m } of months) {
    // Rajesh salary
    await createTxns([
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Salary'], amount: 145000, type: TransactionType.INCOME, paymentMode: PaymentMode.NEFT, description: 'TechCorp India Pvt Ltd — Monthly Salary', date: d(y, m, 1), isRecurring: true },
      // EMI — Home Loan
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['EMI'], amount: 44000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.AUTO_DEBIT, description: 'HDFC Bank Home Loan EMI', date: d(y, m, 5), isRecurring: true, tags: ['home-loan'] },
      // EMI — Car Loan
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['EMI'], amount: 16500, type: TransactionType.EXPENSE, paymentMode: PaymentMode.AUTO_DEBIT, description: 'HDFC Bank Car Loan EMI', date: d(y, m, 10), isRecurring: true, tags: ['car-loan'] },
      // SIP deductions
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Miscellaneous'], amount: 12500, type: TransactionType.EXPENSE, paymentMode: PaymentMode.AUTO_DEBIT, description: 'Mirae Asset ELSS SIP — Auto debit', date: d(y, m, 5), isRecurring: true, tags: ['sip', 'investment'] },
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Miscellaneous'], amount: 10000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.AUTO_DEBIT, description: 'HDFC Mid-Cap Fund SIP — Auto debit', date: d(y, m, 10), isRecurring: true, tags: ['sip', 'investment'] },
      // Groceries
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Groceries'], amount: 12500, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'BigBasket / DMart monthly grocery', date: d(y, m, 8), tags: ['grocery'] },
      // Vegetables
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Vegetables & Dairy'], amount: 4200, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CASH, description: 'Local sabzi mandi & milk', date: d(y, m, 14) },
      // Petrol
      { userId: rajesh.id, bankAccountId: rajeshICICI.id, categoryId: catMap['Petrol/CNG'], amount: 5500, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CARD, description: 'Petrol — BPCL pump', date: d(y, m, 12) },
      // Electricity
      { userId: rajesh.id, bankAccountId: rajeshICICI.id, categoryId: catMap['Electricity'], amount: 3800, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'BESCOM electricity bill', date: d(y, m, 18), isRecurring: true },
      // Mobile & Internet
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Mobile & Internet'], amount: 1499, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'Airtel postpaid + broadband', date: d(y, m, 15), isRecurring: true },
      // OTT
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['DTH & OTT'], amount: 1499, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CARD, description: 'Netflix + Prime Video subscription', date: d(y, m, 3), isRecurring: true },
      // Maid
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Maid/Cook/Driver'], amount: 8000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'Maid & cook monthly wages', date: d(y, m, 1) },
    ]);
    // Eating out (2 per month)
    await createTxns([
      { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Eating Out'], amount: 3200, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'Swiggy / Zomato food orders', date: d(y, m, 16) },
      { userId: rajesh.id, bankAccountId: rajeshICICI.id, categoryId: catMap['Eating Out'], amount: 2800, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CARD, description: 'Restaurant dinner — family outing', date: d(y, m, 22) },
    ]);

    // Priya salary
    await createTxns([
      { userId: priya.id, bankAccountId: priyaAxis.id, categoryId: catMap['Salary'], amount: 62000, type: TransactionType.INCOME, paymentMode: PaymentMode.NEFT, description: 'DPS School — Monthly Salary', date: d(y, m, 2), isRecurring: true },
      // Education loan EMI
      { userId: priya.id, bankAccountId: priyaAxis.id, categoryId: catMap['EMI'], amount: 6155, type: TransactionType.EXPENSE, paymentMode: PaymentMode.AUTO_DEBIT, description: 'SBI Education Loan EMI', date: d(y, m, 15), isRecurring: true, tags: ['education-loan'] },
      // SIP
      { userId: priya.id, bankAccountId: priyaAxis.id, categoryId: catMap['Miscellaneous'], amount: 5000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.AUTO_DEBIT, description: 'Axis Bluechip Fund SIP', date: d(y, m, 3), isRecurring: true, tags: ['sip', 'investment'] },
      // Personal care
      { userId: priya.id, bankAccountId: priyaAxis.id, categoryId: catMap['Personal Care'], amount: 2800, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'Salon & beauty products', date: d(y, m, 20) },
      // Clothing
      { userId: priya.id, bankAccountId: priyaAxis.id, categoryId: catMap['Clothing & Footwear'], amount: 3500, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CARD, description: 'Clothing & accessories — Myntra', date: d(y, m, 25) },
    ]);

    // Arjun — freelance income + expenses
    if ([4, 6, 8, 10, 12, 2].includes(m)) {
      await createTxns([
        { userId: arjun.id, bankAccountId: arjunKotak.id, categoryId: catMap['Freelance/Consulting'], amount: 18000, type: TransactionType.INCOME, paymentMode: PaymentMode.IMPS, description: 'Web dev project — client payment', date: d(y, m, 10) },
      ]);
    }
    await createTxns([
      { userId: arjun.id, bankAccountId: arjunKotak.id, categoryId: catMap['Auto/Cab'], amount: 1800, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'Ola / Rapido commute', date: d(y, m, 18) },
      { userId: arjun.id, bankAccountId: arjunKotak.id, categoryId: catMap['Eating Out'], amount: 2200, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'Canteen & campus food', date: d(y, m, 22) },
    ]);
  }

  // ── TRANSFER transactions (double-entry bank-to-bank) ─────────────────────────
  // Each transfer has a matching pair sharing a transferPairId (uuid-like string)
  const t1PairId = 'transfer-pair-rajesh-hdfc-to-icici-jun25';
  const t2PairId = 'transfer-pair-priya-axis-to-sbi-aug25';
  const t3PairId = 'transfer-pair-rajesh-icici-to-sbi-jan26';

  await prisma.transaction.createMany({ data: [
    // Rajesh moves money from HDFC to ICICI (June 2025)
    { userId: rajesh.id, bankAccountId: rajeshHDFC.id, amount: 50000, type: TransactionType.TRANSFER, paymentMode: PaymentMode.NEFT, description: 'Transfer to ICICI savings', date: d(2025, 6, 20), transferPairId: t1PairId, tags: ['transfer'] },
    { userId: rajesh.id, bankAccountId: rajeshICICI.id, amount: 50000, type: TransactionType.TRANSFER, paymentMode: PaymentMode.NEFT, description: 'Received from HDFC account', date: d(2025, 6, 20), transferPairId: t1PairId, tags: ['transfer'] },
    // Priya moves money from Axis to SBI (August 2025)
    { userId: priya.id, bankAccountId: priyaAxis.id, amount: 30000, type: TransactionType.TRANSFER, paymentMode: PaymentMode.IMPS, description: 'Transfer to SBI for FD renewal', date: d(2025, 8, 5), transferPairId: t2PairId, tags: ['transfer', 'fd'] },
    { userId: priya.id, bankAccountId: priyaSBI.id, amount: 30000, type: TransactionType.TRANSFER, paymentMode: PaymentMode.IMPS, description: 'Received from Axis — FD renewal', date: d(2025, 8, 5), transferPairId: t2PairId, tags: ['transfer', 'fd'] },
    // Rajesh moves from ICICI to SBI PPF (January 2026)
    { userId: rajesh.id, bankAccountId: rajeshICICI.id, amount: 75000, type: TransactionType.TRANSFER, paymentMode: PaymentMode.NEFT, description: 'PPF annual contribution transfer', date: d(2026, 1, 10), transferPairId: t3PairId, tags: ['transfer', 'ppf'] },
    { userId: rajesh.id, bankAccountId: rajeshSBI.id, amount: 75000, type: TransactionType.TRANSFER, paymentMode: PaymentMode.NEFT, description: 'PPF contribution — received', date: d(2026, 1, 10), transferPairId: t3PairId, tags: ['transfer', 'ppf'] },
  ]});

  // ── One-time & special transactions ─────────────────────────────────────────
  // Annual insurance premiums
  await createTxns([
    { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Miscellaneous'], amount: 18500, type: TransactionType.EXPENSE, paymentMode: PaymentMode.NEFT, description: 'HDFC Life Term Insurance Premium', date: d(2025, 4, 7), tags: ['insurance', '80c'] },
    { userId: rajesh.id, bankAccountId: rajeshICICI.id, categoryId: catMap['Medical & Pharmacy'], amount: 22000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CARD, description: 'Star Health Family Floater Premium', date: d(2025, 7, 20), tags: ['insurance', '80d'] },
    { userId: priya.id, bankAccountId: priyaSBI.id, categoryId: catMap['Medical & Pharmacy'], amount: 32000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.NEFT, description: 'Star Health Senior Citizen — Parents Premium', date: d(2025, 10, 5), tags: ['insurance', '80d-parents'] },
    // Diwali shopping
    { userId: rajesh.id, bankAccountId: rajeshICICI.id, categoryId: catMap['Gifts & Festivals'], amount: 18000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CARD, description: 'Diwali gifts & decorations — family & colleagues', date: d(2025, 10, 20), tags: ['diwali', 'festival'] },
    { userId: priya.id, bankAccountId: priyaAxis.id, categoryId: catMap['Gifts & Festivals'], amount: 8500, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'Diwali sweets & gifts', date: d(2025, 10, 22), tags: ['diwali'] },
    // Goa trip (December)
    { userId: rajesh.id, bankAccountId: rajeshICICI.id, categoryId: catMap['Travel & Holidays'], amount: 45000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CARD, description: 'Goa family trip — flights + hotel 4 nights', date: d(2025, 12, 22), tags: ['travel', 'holiday', 'goa'] },
    // Annual bonus
    { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Bonus'], amount: 250000, type: TransactionType.INCOME, paymentMode: PaymentMode.NEFT, description: 'TechCorp Annual Performance Bonus — FY 2024-25', date: d(2025, 6, 15), tags: ['bonus'] },
    // FD interest credited
    { userId: rajesh.id, bankAccountId: rajeshSBI.id, categoryId: catMap['FD Interest'], amount: 35500, type: TransactionType.INCOME, paymentMode: PaymentMode.NEFT, description: 'SBI FD Interest — Annual payout', date: d(2025, 7, 15), tags: ['fd-interest'] },
    // Charity donation
    { userId: rajesh.id, bankAccountId: rajeshICICI.id, categoryId: catMap['Charity & Donations'], amount: 10000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'PM Cares / CRY Foundation donation', date: d(2025, 9, 2), tags: ['80g', 'donation'] },
    // Doctor visit
    { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Doctor Visits'], amount: 3500, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CARD, description: 'Apollo Hospital — annual health checkup', date: d(2025, 11, 8) },
    { userId: priya.id, bankAccountId: priyaSBI.id, categoryId: catMap['Doctor Visits'], amount: 1800, type: TransactionType.EXPENSE, paymentMode: PaymentMode.UPI, description: 'General physician consultation', date: d(2025, 8, 14) },
    // Home maintenance
    { userId: rajesh.id, bankAccountId: rajeshICICI.id, categoryId: catMap['Home Maintenance'], amount: 12000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CASH, description: 'Annual house painting — 2 rooms', date: d(2025, 5, 8) },
    // Advance tax payment
    { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Taxes'], amount: 40000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.NEFT, description: 'Advance Tax — 1st Installment FY 2025-26', date: d(2025, 6, 12), tags: ['advance-tax'] },
    { userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Taxes'], amount: 40000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.NEFT, description: 'Advance Tax — 2nd Installment FY 2025-26', date: d(2025, 9, 10), tags: ['advance-tax'] },
    // Priya school fees (Arjun's college)
    { userId: priya.id, bankAccountId: priyaSBI.id, categoryId: catMap['School/Tuition Fees'], amount: 45000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.NEFT, description: "Arjun's semester fees — BMS College of Engineering", date: d(2025, 7, 5), tags: ['education'] },
    { userId: priya.id, bankAccountId: priyaSBI.id, categoryId: catMap['School/Tuition Fees'], amount: 45000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.NEFT, description: "Arjun's semester fees — BMS College of Engineering", date: d(2026, 1, 8), tags: ['education'] },

    // Arjun coding course
    { userId: arjun.id, bankAccountId: arjunKotak.id, categoryId: catMap['School/Tuition Fees'], amount: 12000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.CARD, description: 'Full-Stack Web Dev course — Udemy + Frontend Masters', date: d(2025, 5, 15), tags: ['learning'] },
    // Arjun dividend income
    { userId: arjun.id, bankAccountId: arjunKotak.id, categoryId: catMap['Dividend'], amount: 850, type: TransactionType.INCOME, paymentMode: PaymentMode.NEFT, description: 'TCS dividend — Q2 FY2025-26', date: d(2025, 11, 5) },
  ]);

  // ── Capital Gain Entries (ITR-2 Schedule CG) ─────────────────────────────────
  await prisma.capitalGainEntry.createMany({ data: [
    {
      userId: rajesh.id, fyYear: fy,
      assetName: 'Infosys Ltd — partial sale (20 shares)', assetType: CapitalGainAssetType.EQUITY_LISTED,
      purchaseDate: d(2023, 3, 22), saleDate: d(2025, 9, 5),
      purchasePrice: 27000, salePrice: 34560, // 20 × ₹1350 buy; 20 × ₹1728 sell
      isListed: true, isSection112AEligible: true, // LTCG 10% above ₹1L
      notes: 'LTCG on listed equity — held > 12 months. Section 112A applies.',
    },
    {
      userId: priya.id, fyYear: fy,
      assetName: 'SBI Tax Advantage Fund — partial redemption (200 units)', assetType: CapitalGainAssetType.EQUITY_MUTUAL_FUND,
      purchaseDate: d(2022, 4, 5), saleDate: d(2025, 5, 10),
      purchasePrice: 8000, salePrice: 11464, // 200 × 40 buy; 200 × 57.32 sell
      isListed: true, isSection112AEligible: true,
      notes: 'LTCG on equity mutual fund — lock-in expired Apr 2025. Section 112A applies.',
    },
  ]});

  // ── Other Source Income (ITR-2 Schedule OS) ───────────────────────────────────
  await prisma.otherSourceIncome.createMany({ data: [
    { userId: rajesh.id, fyYear: fy, sourceType: OtherSourceType.FD_INTEREST, description: 'SBI FD ₹5L @ 7.1% — interest accrued FY 2025-26 (cumulative)', amount: 35500, tdsDeducted: 3550 },
    { userId: rajesh.id, fyYear: fy, sourceType: OtherSourceType.SAVINGS_INTEREST, description: 'HDFC + ICICI savings account interest', amount: 4200, tdsDeducted: 0 },
    { userId: priya.id, fyYear: fy, sourceType: OtherSourceType.FD_INTEREST, description: 'SBI FD ₹2L @ 7% — quarterly payout (annualised)', amount: 14000, tdsDeducted: 1400 },
    { userId: arjun.id, fyYear: fy, sourceType: OtherSourceType.DIVIDEND, description: 'TCS dividend — Q2 FY2025-26', amount: 850, tdsDeducted: 0 },
  ]});

  // ── House Property Detail (ITR-2 Schedule HP) ─────────────────────────────────
  await prisma.housePropertyDetail.create({ data: {
    userId: rajesh.id, fyYear: fy,
    propertyName: '3BHK Apartment — Whitefield, Bangalore',
    usage: HousePropertyUsage.SELF_OCCUPIED,
    grossAnnualRent: null, // self-occupied: no rent income
    municipalTaxesPaid: 18000,
    homeLoanInterest: 350000, // actual interest paid; Section 24(b) capped at ₹2L for self-occupied
    isPreConstruction: false,
    notes: 'Self-occupied. Home loan interest ₹3.5L actual; only ₹2L deductible under Sec 24(b).',
  }});

  // ── Foreign Equity Investment + Schedule FA ───────────────────────────────────
  await prisma.investment.create({ data: {
    userId: rajesh.id, type: InvestmentType.STOCKS_FOREIGN, name: 'Apple Inc. (AAPL)',
    tickerSymbolForeign: 'AAPL', exchange: Exchange.NASDAQ,
    currency: 'USD',
    unitsOrQuantity: 5, purchasePricePerUnit: 150, currentPricePerUnit: 195,
    purchaseDate: d(2022, 8, 15), purchaseExchangeRate: 79.50,
    isTaxSaving: false, absoluteReturnPct: 30.0,
    notes: 'Held via INDmoney international brokerage. Subject to Schedule FA disclosure.',
  }});

  await prisma.foreignAssetDisclosure.create({ data: {
    userId: rajesh.id, fyYear: fy,
    category: ForeignAssetCategory.EQUITY_AND_MF,
    country: 'United States',
    assetDescription: 'Apple Inc. (AAPL) — 5 shares held in INDmoney international brokerage account',
    acquisitionCostINR: 59625, // 5 × $150 × ₹79.50
    peakValueINR: 85313,       // 5 × $195 × ₹87.50 (peak USD rate during FY)
    closingValueINR: 81217,    // 5 × $195 × ₹83.30 (FY-end rate)
    incomeAccruedINR: 0,       // Apple pays minimal dividend — not tracked
    notes: 'Reported under Schedule FA as per ITR-2 requirement for foreign assets held during FY.',
  }});

  // ── Net Worth Snapshots (12 months: Apr 2025 – Mar 2026) ─────────────────────
  // Approximations consistent with the seeded balances, growing over time
  const nwMonths = [
    { y: 2025, m: 4 }, { y: 2025, m: 5 }, { y: 2025, m: 6 },
    { y: 2025, m: 7 }, { y: 2025, m: 8 }, { y: 2025, m: 9 },
    { y: 2025, m: 10 }, { y: 2025, m: 11 }, { y: 2025, m: 12 },
    { y: 2026, m: 1 }, { y: 2026, m: 2 }, { y: 2026, m: 3 },
  ];

  for (let i = 0; i < nwMonths.length; i++) {
    const { y, m } = nwMonths[i];
    const snapshotDate = d(y, m, 1);

    // Rajesh — high NW, growing investments, declining loans
    const rajeshInv = 4800000 + i * 25000;
    const rajeshLoans = 4620000 - i * 9000;
    const rajeshBanks = 260000;
    const rajeshFDs = 650000;
    const rajeshRDs = 110000 + i * 10000;
    const rajeshGold = 157000;
    const rajeshRE = 9800000;
    const rajeshAssets = rajeshBanks + rajeshFDs + rajeshRDs + rajeshInv + rajeshGold + rajeshRE;
    const rajeshNW = rajeshAssets - rajeshLoans;

    await prisma.netWorthSnapshot.upsert({
      where: { userId_snapshotDate: { userId: rajesh.id, snapshotDate } },
      create: { userId: rajesh.id, snapshotDate, totalAssets: rajeshAssets, totalLiabilities: rajeshLoans, netWorth: rajeshNW, bankBalances: rajeshBanks, fixedDeposits: rajeshFDs, recurringDeposits: rajeshRDs, investments: rajeshInv, gold: rajeshGold, realEstate: rajeshRE, loans: rajeshLoans },
      update: { totalAssets: rajeshAssets, totalLiabilities: rajeshLoans, netWorth: rajeshNW, bankBalances: rajeshBanks, fixedDeposits: rajeshFDs, recurringDeposits: rajeshRDs, investments: rajeshInv, gold: rajeshGold, realEstate: rajeshRE, loans: rajeshLoans },
    });

    // Priya — moderate NW
    const priyaInv = 270000 + i * 6000;
    const priyaLoans = 185000 - i * 1500;
    const priyaBanks = 177000;
    const priyaFDs = 200000;
    const priyaRDs = 120000 + i * 5000;
    const priyaGold = 1067600; // physical 120g × ₹7,850 + SGB 16g × ₹7,850
    const priyaAssets = priyaBanks + priyaFDs + priyaRDs + priyaInv + priyaGold;
    const priyaNW = priyaAssets - priyaLoans;

    await prisma.netWorthSnapshot.upsert({
      where: { userId_snapshotDate: { userId: priya.id, snapshotDate } },
      create: { userId: priya.id, snapshotDate, totalAssets: priyaAssets, totalLiabilities: priyaLoans, netWorth: priyaNW, bankBalances: priyaBanks, fixedDeposits: priyaFDs, recurringDeposits: priyaRDs, investments: priyaInv, gold: priyaGold, loans: priyaLoans },
      update: { totalAssets: priyaAssets, totalLiabilities: priyaLoans, netWorth: priyaNW, bankBalances: priyaBanks, fixedDeposits: priyaFDs, recurringDeposits: priyaRDs, investments: priyaInv, gold: priyaGold, loans: priyaLoans },
    });

    // Arjun — student, small NW, growing investments
    const arjunInv = 40000 + i * 2500;
    const arjunBanks = 28000;
    const arjunFDs = 50000;
    const arjunAssets = arjunBanks + arjunFDs + arjunInv;
    const arjunNW = arjunAssets;

    await prisma.netWorthSnapshot.upsert({
      where: { userId_snapshotDate: { userId: arjun.id, snapshotDate } },
      create: { userId: arjun.id, snapshotDate, totalAssets: arjunAssets, totalLiabilities: 0, netWorth: arjunNW, bankBalances: arjunBanks, fixedDeposits: arjunFDs, investments: arjunInv },
      update: { totalAssets: arjunAssets, totalLiabilities: 0, netWorth: arjunNW, bankBalances: arjunBanks, fixedDeposits: arjunFDs, investments: arjunInv },
    });
  }

  // ── Recurring Rules (template transactions for scheduled recurrence) ──────────
  // Create dedicated template transactions (separate from the monthly loop instances)
  const rajeshSalaryTemplate = await prisma.transaction.create({ data: {
    userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['Salary'],
    amount: 145000, type: TransactionType.INCOME, paymentMode: PaymentMode.NEFT,
    description: 'TechCorp India Pvt Ltd — Monthly Salary [TEMPLATE]',
    date: d(fyStartYear + 1, 4, 1), isRecurring: true, tags: ['recurring-template'],
  }});
  const priyaSalaryTemplate = await prisma.transaction.create({ data: {
    userId: priya.id, bankAccountId: priyaAxis.id, categoryId: catMap['Salary'],
    amount: 62000, type: TransactionType.INCOME, paymentMode: PaymentMode.NEFT,
    description: 'DPS School — Monthly Salary [TEMPLATE]',
    date: d(fyStartYear + 1, 4, 2), isRecurring: true, tags: ['recurring-template'],
  }});
  const rajeshEmiTemplate = await prisma.transaction.create({ data: {
    userId: rajesh.id, bankAccountId: rajeshHDFC.id, categoryId: catMap['EMI'],
    amount: 44000, type: TransactionType.EXPENSE, paymentMode: PaymentMode.AUTO_DEBIT,
    description: 'HDFC Bank Home Loan EMI [TEMPLATE]',
    date: d(fyStartYear + 1, 4, 5), isRecurring: true, tags: ['recurring-template', 'home-loan'],
  }});

  await prisma.recurringRule.createMany({ data: [
    { userId: rajesh.id, templateTransactionId: rajeshSalaryTemplate.id, frequency: RecurringFrequency.MONTHLY, nextRunDate: d(fyStartYear + 1, 5, 1), isActive: true },
    { userId: priya.id, templateTransactionId: priyaSalaryTemplate.id, frequency: RecurringFrequency.MONTHLY, nextRunDate: d(fyStartYear + 1, 5, 2), isActive: true },
    { userId: rajesh.id, templateTransactionId: rajeshEmiTemplate.id, frequency: RecurringFrequency.MONTHLY, nextRunDate: d(fyStartYear + 1, 5, 5), isActive: true },
  ]});

  console.log('');
  console.log('========================================');
  console.log('  FIRST_RUN=true');
  console.log('  Family Finance Tracker is ready!');
  console.log('');
  console.log('  Sharma Family demo data seeded!');
  console.log('');
  console.log('  Login credentials:');
  console.log('  Admin  — admin@family.local  / Admin@1234   (Rajesh Sharma)');
  console.log('  Member — priya@family.local  / Member@1234  (Priya Sharma)');
  console.log('  Member — arjun@family.local  / Member@1234  (Arjun Sharma)');
  console.log('========================================');
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
