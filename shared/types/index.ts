// Shared TypeScript types — used by both frontend and backend
// Import from '@shared/types' in both apps

// ─── API Envelope ─────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedApiResponse<T> extends ApiResponse<T[]> {
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}

export interface ApiError {
  success: false;
  message: string;
  errors?: Record<string, string[]>;
  code?: string;
}

// ─── Auth DTOs ────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: UserProfile;
  accessToken: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  avatarUrl?: string;
  colorTag?: string;
  panNumberMasked?: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
}

// ─── Financial Year ───────────────────────────────────────────────────────────

export interface FYRange {
  fy: string;          // e.g., "2024-25"
  startDate: Date;     // Apr 1 in IST
  endDate: Date;       // Mar 31 23:59:59 in IST
  label: string;       // "FY 2024-25"
}

// ─── Dashboard DTOs ───────────────────────────────────────────────────────────

export interface DashboardSummary {
  netWorth: number;
  netWorthChange: number;          // vs last FY
  netWorthChangePct: number;
  totalIncome: number;
  totalExpense: number;
  savingsRate: number;             // percentage
  totalAssets: number;
  totalLiabilities: number;
  fyYear: string;
}

export interface CashflowMonth {
  month: string;                   // "Apr", "May", etc.
  monthIndex: number;              // 1-12
  year: number;
  income: number;
  expense: number;
  net: number;
}

export interface AssetAllocation {
  label: string;
  value: number;
  percentage: number;
  color: string;
}

export interface UpcomingAlert {
  type: 'EMI' | 'SIP' | 'INSURANCE_PREMIUM' | 'FD_MATURITY' | 'ADVANCE_TAX';
  title: string;
  amount?: number;
  dueDate: string;
  daysUntilDue: number;
  entityId: string;
}

// ─── Transaction DTOs ─────────────────────────────────────────────────────────

export interface TransactionFilters {
  userId?: string;
  bankAccountId?: string;
  categoryId?: string;
  type?: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  paymentMode?: string;
  startDate?: string;
  endDate?: string;
  fy?: string;                     // e.g., "2024-25"
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  tags?: string[];
  cursor?: string;
  limit?: number;
  sort?: string;                   // e.g., "date:desc"
}

export interface TransactionDTO {
  id: string;
  userId: string;
  bankAccountId?: string;
  bankAccountName?: string;
  categoryId?: string;
  categoryName?: string;
  categoryColor?: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  paymentMode?: string;
  upiIdUsed?: string;
  description: string;
  date: string;
  tags: string[];
  receiptUrl?: string;
  isRecurring: boolean;
  gstAmount?: number;
  createdAt: string;
}

export interface CreateTransactionRequest {
  bankAccountId?: string;
  categoryId?: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  paymentMode?: string;
  upiIdUsed?: string;
  description: string;
  date: string;
  tags?: string[];
  isRecurring?: boolean;
  recurringFrequency?: string;
  gstAmount?: number;
}

// ─── Investment DTOs ──────────────────────────────────────────────────────────

export interface InvestmentDTO {
  id: string;
  userId: string;
  type: string;
  name: string;
  exchange?: string;
  currency: string;
  unitsOrQuantity: number;
  purchasePricePerUnit: number;
  purchaseDate: string;
  purchaseExchangeRate?: number;
  currentPricePerUnit: number;
  isTaxSaving: boolean;
  lockInEndDate?: string;
  xirr?: number | null;
  absoluteReturnPct?: number | null;
  // Computed at read time
  investedAmountINR: number;
  currentValueINR: number;
  gainLossINR: number;
  gainLossPct: number;
  // For foreign equities
  investedAmountForeign?: number;
  currentValueForeign?: number;
  gainLossForeign?: number;
  foreignCurrency?: string;
}

export interface PortfolioSummary {
  totalCurrentValueINR: number;
  totalInvestedINR: number;
  totalGainLossINR: number;
  totalGainLossPct: number;
  xirr?: number | null;
  allocation: AssetAllocation[];
  lastUpdated: string;
}

// ─── Tax DTOs ─────────────────────────────────────────────────────────────────

export interface TaxSummary {
  fyYear: string;
  regime: 'OLD' | 'NEW';
  grossIncome: number;
  totalDeductions: number;
  taxableIncome: number;
  estimatedTax: number;
  taxPaid: number;
  balance: number;                 // Positive = refund due, negative = tax due
  breakdown: {
    section: string;
    limit?: number;
    claimed: number;
    remaining?: number;
  }[];
}

export interface Section80CBreakdown {
  fyYear: string;
  limit: number;                   // ₹1,50,000
  utilised: number;
  remaining: number;
  items: {
    source: string;                // "ELSS", "PPF", "LIC", etc.
    amount: number;
    entityId?: string;
  }[];
}

// ─── Bank Import DTOs ─────────────────────────────────────────────────────────

export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  rawRow: Record<string, string>;
}

export interface ParseError {
  rowIndex: number;
  rawRow: Record<string, string>;
  message: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  errors: ParseError[];
  warnings: string[];
}

export interface ImportResult {
  importedCount: number;
  duplicatesSkipped: number;
  errorsCount: number;
  importId: string;
}
