/**
 * Shared fixtures for page tests.
 *
 * Money values are chosen so their Indian-format rendering is distinctive and
 * unambiguous — `₹1,25,000.00` cannot be produced by accident, which makes it a real
 * assertion rather than a coincidence. Keep the lakh grouping (1,25,000 not 125,000);
 * that grouping is the thing worth asserting.
 */

export interface TestUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  isActive: boolean;
  mustChangePassword: boolean;
  colorTag: string | null;
}

export const ADMIN_USER: TestUser = {
  id: 'u-admin',
  name: 'Asha',
  email: 'asha@example.com',
  role: 'ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  colorTag: null,
};

export const MEMBER_USER: TestUser = {
  ...ADMIN_USER,
  id: 'u-member',
  name: 'Ravi',
  email: 'ravi@example.com',
  role: 'MEMBER' as const,
};

export const MEMBERS = [
  { id: 'u-admin', name: 'Asha', isActive: true, colorTag: null },
  { id: 'u-member', name: 'Ravi', isActive: true, colorTag: null },
];

export const CATEGORIES = [
  { id: 'cat-food', name: 'Food', type: 'EXPENSE', parentId: null, colorHex: '#ff0000', iconKey: null },
  { id: 'cat-rent', name: 'Rent', type: 'EXPENSE', parentId: null, colorHex: '#00ff00', iconKey: null },
  { id: 'cat-sal', name: 'Salary', type: 'INCOME', parentId: null, colorHex: '#0000ff', iconKey: null },
];

export const ACCOUNTS = [
  {
    id: 'acc-1',
    bankName: 'HDFC Bank',
    accountType: 'SAVINGS',
    accountNumberMasked: 'XXXX1234',
    currentBalance: '125000.00',
    userId: 'u-admin',
    isActive: true,
  },
];

/** Renders as ₹1,25,000.00 — the distinctive lakh grouping. */
export const MONEY = 125000;
export const MONEY_FORMATTED = '₹1,25,000.00';

export const BUDGETS_VS_ACTUALS = [
  {
    id: 'bud-1',
    categoryId: 'cat-food',
    category: { id: 'cat-food', name: 'Food', type: 'EXPENSE' },
    amount: MONEY,
    actual: 50000,
    remaining: 75000,
    pctUsed: 40,
    period: 'MONTHLY',
    fyYear: '2025-26',
    userId: 'u-admin',
    userName: 'Asha',
  },
];
