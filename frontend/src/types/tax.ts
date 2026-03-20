export type CapitalGainAssetType =
  | 'EQUITY_LISTED'
  | 'EQUITY_MUTUAL_FUND'
  | 'DEBT_MUTUAL_FUND'
  | 'PROPERTY'
  | 'BONDS'
  | 'GOLD'
  | 'FOREIGN_EQUITY'
  | 'OTHER';

export type OtherSourceType =
  | 'FD_INTEREST'
  | 'RD_INTEREST'
  | 'SAVINGS_INTEREST'
  | 'DIVIDEND'
  | 'GIFT'
  | 'FOREIGN_DIVIDEND'
  | 'OTHER';

export type HousePropertyUsage = 'SELF_OCCUPIED' | 'LET_OUT' | 'DEEMED_LET_OUT';

// ─── Capital Gains ────────────────────────────────────────────────────────────

export interface CapitalGainEntry {
  id: string;
  userId: string;
  fyYear: string;
  investmentId?: string;
  assetName: string;
  assetType: CapitalGainAssetType;
  purchaseDate: string;
  saleDate: string;
  purchasePrice: number;
  salePrice: number;
  indexedCost?: number;
  isListed: boolean;
  isSection112AEligible: boolean;
  isPreApril2023Purchase: boolean;
  foreignTaxPaid?: number;
  exchangeRateAtSale?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CapitalGainSummary {
  stcg: {
    equity15Pct: number;
    other: number;
    total: number;
  };
  ltcg: {
    equity10Pct: number;
    withIndexation: number;
    debtMFSlab: number;
    foreign20Pct: number;
    total: number;
  };
  totalTaxableGain: number;
  entries: Array<{
    id: string;
    assetName: string;
    assetType: CapitalGainAssetType;
    holdingDays: number;
    isLongTerm: boolean;
    gain: number;
    taxRate: string;
    taxBucket: string;
  }>;
}

// ─── Other Sources ────────────────────────────────────────────────────────────

export interface OtherSourceIncome {
  id: string;
  userId: string;
  fyYear: string;
  sourceType: OtherSourceType;
  description: string;
  amount: number;
  tdsDeducted?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OtherIncomeSummary {
  breakdown: {
    fdInterest: number;
    rdInterest: number;
    savingsInterest: number;
    dividend: number;
    gift: number;
    other: number;
  };
  foreignDividend: number;
  totalForeignWithholdingTax: number;
  grossTotal: number;
  deduction80TTA: number;
  taxableTotal: number;
  totalTdsDeducted: number;
}

// ─── House Property ───────────────────────────────────────────────────────────

export interface HousePropertyDetail {
  id: string;
  userId: string;
  fyYear: string;
  realEstateId?: string;
  propertyName: string;
  usage: HousePropertyUsage;
  grossAnnualRent?: number;
  municipalTaxesPaid?: number;
  homeLoanInterest?: number;
  isPreConstruction: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HousePropertyIncomeSummary {
  properties: Array<{
    id: string;
    propertyName: string;
    usage: string;
    grossAnnualValue: number;
    municipalTaxes: number;
    netAnnualValue: number;
    standardDeduction30Pct: number;
    interestOnLoan: number;
    incomeFromHP: number;
  }>;
  totalHPIncome: number;
  hpLossSetOff: number;
  taxableHPIncome: number;
}

// ─── Foreign Assets (Schedule FA) ─────────────────────────────────────────────

export type ForeignAssetCategory =
  | 'BANK_ACCOUNT'
  | 'EQUITY_AND_MF'
  | 'DEBT'
  | 'IMMOVABLE_PROPERTY'
  | 'OTHER';

export interface ForeignAssetDisclosure {
  id: string;
  userId: string;
  fyYear: string;
  category: ForeignAssetCategory;
  country: string;
  assetDescription: string;
  acquisitionCostINR: number;
  peakValueINR: number;
  closingValueINR: number;
  incomeAccruedINR?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ForeignAssetSummary {
  count: number;
  totalClosingValueINR: number;
  totalIncomeAccruedINR: number;
  byCategory: Record<string, { count: number; closingValueINR: number }>;
}

// ─── ITR-2 Summary ────────────────────────────────────────────────────────────

export interface ITR2Summary {
  fy: string;
  regime: 'OLD' | 'NEW';
  scheduleCG: {
    stcg: CapitalGainSummary['stcg'];
    ltcg: CapitalGainSummary['ltcg'];
    totalTaxableGain: number;
    entryCount: number;
  };
  scheduleOS: {
    breakdown: OtherIncomeSummary['breakdown'];
    foreignDividend: number;
    totalForeignWithholdingTax: number;
    grossTotal: number;
    deduction80TTA: number;
    taxableTotal: number;
    totalTdsDeducted: number;
  };
  scheduleHP: {
    properties: HousePropertyIncomeSummary['properties'];
    totalHPIncome: number;
    hpLossSetOff: number;
    taxableHPIncome: number;
  };
}
