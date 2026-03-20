-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('SAVINGS', 'CURRENT', 'SALARY', 'NRE', 'NRO', 'PPF', 'EPF', 'DEMAT');

-- CreateEnum
CREATE TYPE "InvestmentType" AS ENUM ('STOCKS_INDIA', 'STOCKS_FOREIGN', 'MUTUAL_FUND', 'ELSS', 'PPF', 'NPS', 'EPF', 'SGB', 'GOLD_ETF', 'BONDS', 'CRYPTO', 'OTHER');

-- CreateEnum
CREATE TYPE "Exchange" AS ENUM ('NSE', 'BSE', 'NYSE', 'NASDAQ', 'LSE', 'SGX', 'OTHER');

-- CreateEnum
CREATE TYPE "SIPTransactionType" AS ENUM ('BUY', 'SELL', 'DIVIDEND');

-- CreateEnum
CREATE TYPE "InsurancePolicyType" AS ENUM ('TERM_LIFE', 'ENDOWMENT', 'ULIP', 'WHOLE_LIFE', 'HEALTH', 'SUPER_TOP_UP', 'CRITICAL_ILLNESS', 'PERSONAL_ACCIDENT', 'VEHICLE', 'HOME', 'TRAVEL');

-- CreateEnum
CREATE TYPE "PremiumFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUALLY', 'SINGLE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'FY');

-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('HOME', 'AUTO', 'PERSONAL', 'EDUCATION', 'GOLD', 'LAP', 'BUSINESS', 'OTHER');

-- CreateEnum
CREATE TYPE "FDInterestPayoutType" AS ENUM ('CUMULATIVE', 'MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "FDStatus" AS ENUM ('ACTIVE', 'MATURED', 'BROKEN');

-- CreateEnum
CREATE TYPE "RDStatus" AS ENUM ('ACTIVE', 'MATURED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SIPStatus" AS ENUM ('ACTIVE', 'PAUSED', 'STOPPED');

-- CreateEnum
CREATE TYPE "GoldType" AS ENUM ('PHYSICAL', 'SGB', 'GOLD_ETF', 'DIGITAL');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'LAND', 'PLOT');

-- CreateEnum
CREATE TYPE "TaxSection" AS ENUM ('S80C', 'S80D', 'S80E', 'S80G', 'S80CCD1B', 'SECTION_24B', 'HRA', 'STANDARD_DEDUCTION', 'ADVANCE_TAX', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('OLD', 'NEW');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "avatarUrl" TEXT,
    "colorTag" TEXT,
    "panNumberMasked" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "fyStartMonth" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "ifscPrefix" TEXT,
    "accountNumberLast4" TEXT,
    "accountType" "AccountType" NOT NULL,
    "currentBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "interestRate" DECIMAL(5,2),
    "maturityDate" TIMESTAMP(3),
    "upiId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedDeposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "bankName" TEXT NOT NULL,
    "principalAmount" DECIMAL(15,2) NOT NULL,
    "interestRate" DECIMAL(5,2) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "maturityDate" TIMESTAMP(3) NOT NULL,
    "maturityAmount" DECIMAL(15,2) NOT NULL,
    "interestPayoutType" "FDInterestPayoutType" NOT NULL DEFAULT 'CUMULATIVE',
    "isTaxSaver" BOOLEAN NOT NULL DEFAULT false,
    "tdsApplicable" BOOLEAN NOT NULL DEFAULT true,
    "status" "FDStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringDeposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "bankName" TEXT NOT NULL,
    "monthlyInstallment" DECIMAL(15,2) NOT NULL,
    "interestRate" DECIMAL(5,2) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "maturityDate" TIMESTAMP(3) NOT NULL,
    "maturityAmount" DECIMAL(15,2) NOT NULL,
    "totalDeposited" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "installmentsPaid" INTEGER NOT NULL DEFAULT 0,
    "status" "RDStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "InvestmentType" NOT NULL,
    "name" TEXT NOT NULL,
    "folioNumber" TEXT,
    "isin" TEXT,
    "tickerSymbolNSE" TEXT,
    "tickerSymbolBSE" TEXT,
    "tickerSymbolForeign" TEXT,
    "exchange" "Exchange",
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "unitsOrQuantity" DECIMAL(15,4) NOT NULL,
    "purchasePricePerUnit" DECIMAL(15,4) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "purchaseNav" DECIMAL(15,4),
    "purchaseExchangeRate" DECIMAL(15,4),
    "currentPricePerUnit" DECIMAL(15,4) NOT NULL,
    "currentNav" DECIMAL(15,4),
    "isTaxSaving" BOOLEAN NOT NULL DEFAULT false,
    "lockInEndDate" TIMESTAMP(3),
    "xirr" DECIMAL(8,4),
    "absoluteReturnPct" DECIMAL(8,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SIP" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "fundName" TEXT NOT NULL,
    "folioNumber" TEXT,
    "monthlyAmount" DECIMAL(15,2) NOT NULL,
    "sipDate" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "SIPStatus" NOT NULL DEFAULT 'ACTIVE',
    "bankAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SIP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SIPTransaction" (
    "id" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "units" DECIMAL(15,4) NOT NULL,
    "nav" DECIMAL(15,4) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "type" "SIPTransactionType" NOT NULL DEFAULT 'BUY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SIPTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL DEFAULT 'INR',
    "rate" DECIMAL(15,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoldHolding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "GoldType" NOT NULL,
    "description" TEXT,
    "quantityGrams" DECIMAL(10,3) NOT NULL,
    "purchasePricePerGram" DECIMAL(15,2) NOT NULL,
    "currentPricePerGram" DECIMAL(15,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoldHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealEstate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "propertyName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "purchasePrice" DECIMAL(15,2) NOT NULL,
    "currentValue" DECIMAL(15,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "loanId" TEXT,
    "rentalIncomeMonthly" DECIMAL(15,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealEstate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyType" "InsurancePolicyType" NOT NULL,
    "providerName" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "sumAssured" DECIMAL(15,2) NOT NULL,
    "premiumAmount" DECIMAL(15,2) NOT NULL,
    "premiumFrequency" "PremiumFrequency" NOT NULL,
    "premiumDueDate" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "maturityDate" TIMESTAMP(3),
    "nomineeName" TEXT,
    "agentName" TEXT,
    "agentContact" TEXT,
    "is80cEligible" BOOLEAN NOT NULL DEFAULT false,
    "is80dEligible" BOOLEAN NOT NULL DEFAULT false,
    "isForParents" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "categoryId" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "paymentMode" "PaymentMode",
    "upiIdUsed" TEXT,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "receiptUrl" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "gstAmount" DECIMAL(15,2),
    "importHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateTransactionId" TEXT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "period" "BudgetPeriod" NOT NULL,
    "fyYear" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "lenderName" TEXT NOT NULL,
    "loanAccountNumber" TEXT,
    "loanType" "LoanType" NOT NULL,
    "principalAmount" DECIMAL(15,2) NOT NULL,
    "outstandingBalance" DECIMAL(15,2) NOT NULL,
    "interestRate" DECIMAL(5,2) NOT NULL,
    "emiAmount" DECIMAL(15,2) NOT NULL,
    "emiDate" INTEGER NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "disbursementDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isTaxDeductible" BOOLEAN NOT NULL DEFAULT false,
    "section24bEligible" BOOLEAN NOT NULL DEFAULT false,
    "prepaymentChargesPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPrepayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "reducedEmi" DECIMAL(15,2),
    "tenureReduced" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanPrepayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fyYear" TEXT NOT NULL,
    "regime" "TaxRegime" NOT NULL DEFAULT 'OLD',
    "grossSalary" DECIMAL(15,2),
    "hraReceived" DECIMAL(15,2),
    "hraExempt" DECIMAL(15,2),
    "rentPaidMonthly" DECIMAL(15,2),
    "cityType" TEXT,
    "standardDeduction" DECIMAL(15,2),
    "deduction80C" DECIMAL(15,2),
    "deduction80D" DECIMAL(15,2),
    "deduction80E" DECIMAL(15,2),
    "deduction80G" DECIMAL(15,2),
    "deduction24B" DECIMAL(15,2),
    "nps80Ccd1B" DECIMAL(15,2),
    "otherDeductions" DECIMAL(15,2),
    "taxPaidAdvance" DECIMAL(15,2),
    "taxPaidTds" DECIMAL(15,2),
    "taxPaidSelfAssessment" DECIMAL(15,2),
    "estimatedTaxLiability" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fyYear" TEXT NOT NULL,
    "regime" "TaxRegime" NOT NULL DEFAULT 'OLD',
    "section" "TaxSection" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT,
    "proofUploaded" BOOLEAN NOT NULL DEFAULT false,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceTaxEvent" (
    "id" TEXT NOT NULL,
    "fyYear" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "percentageDue" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "isSystemGenerated" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AdvanceTaxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relatedEntityType" TEXT NOT NULL,
    "relatedEntityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "bankName" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "duplicatesSkipped" INTEGER NOT NULL,
    "errorsCount" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT NOT NULL,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "performedByUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValueJson" JSONB,
    "newValueJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "BankAccount_userId_idx" ON "BankAccount"("userId");

-- CreateIndex
CREATE INDEX "FixedDeposit_userId_idx" ON "FixedDeposit"("userId");

-- CreateIndex
CREATE INDEX "FixedDeposit_maturityDate_idx" ON "FixedDeposit"("maturityDate");

-- CreateIndex
CREATE INDEX "FixedDeposit_status_idx" ON "FixedDeposit"("status");

-- CreateIndex
CREATE INDEX "RecurringDeposit_userId_idx" ON "RecurringDeposit"("userId");

-- CreateIndex
CREATE INDEX "RecurringDeposit_maturityDate_idx" ON "RecurringDeposit"("maturityDate");

-- CreateIndex
CREATE INDEX "Investment_userId_idx" ON "Investment"("userId");

-- CreateIndex
CREATE INDEX "Investment_type_idx" ON "Investment"("type");

-- CreateIndex
CREATE INDEX "Investment_isin_idx" ON "Investment"("isin");

-- CreateIndex
CREATE UNIQUE INDEX "SIP_investmentId_key" ON "SIP"("investmentId");

-- CreateIndex
CREATE INDEX "SIP_userId_idx" ON "SIP"("userId");

-- CreateIndex
CREATE INDEX "SIP_status_idx" ON "SIP"("status");

-- CreateIndex
CREATE INDEX "SIP_sipDate_idx" ON "SIP"("sipDate");

-- CreateIndex
CREATE INDEX "SIPTransaction_investmentId_idx" ON "SIPTransaction"("investmentId");

-- CreateIndex
CREATE INDEX "SIPTransaction_date_idx" ON "SIPTransaction"("date");

-- CreateIndex
CREATE INDEX "ExchangeRate_fromCurrency_idx" ON "ExchangeRate"("fromCurrency");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_fromCurrency_toCurrency_key" ON "ExchangeRate"("fromCurrency", "toCurrency");

-- CreateIndex
CREATE INDEX "GoldHolding_userId_idx" ON "GoldHolding"("userId");

-- CreateIndex
CREATE INDEX "RealEstate_userId_idx" ON "RealEstate"("userId");

-- CreateIndex
CREATE INDEX "InsurancePolicy_userId_idx" ON "InsurancePolicy"("userId");

-- CreateIndex
CREATE INDEX "InsurancePolicy_endDate_idx" ON "InsurancePolicy"("endDate");

-- CreateIndex
CREATE INDEX "InsurancePolicy_policyType_idx" ON "InsurancePolicy"("policyType");

-- CreateIndex
CREATE INDEX "Category_type_idx" ON "Category"("type");

-- CreateIndex
CREATE INDEX "Category_isDefault_idx" ON "Category"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_name_type_key" ON "Category"("userId", "name", "type");

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_bankAccountId_idx" ON "Transaction"("bankAccountId");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");

-- CreateIndex
CREATE INDEX "Transaction_deletedAt_idx" ON "Transaction"("deletedAt");

-- CreateIndex
CREATE INDEX "Transaction_importHash_idx" ON "Transaction"("importHash");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_importHash_key" ON "Transaction"("importHash");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringRule_templateTransactionId_key" ON "RecurringRule"("templateTransactionId");

-- CreateIndex
CREATE INDEX "RecurringRule_userId_idx" ON "RecurringRule"("userId");

-- CreateIndex
CREATE INDEX "RecurringRule_nextRunDate_idx" ON "RecurringRule"("nextRunDate");

-- CreateIndex
CREATE INDEX "RecurringRule_isActive_idx" ON "RecurringRule"("isActive");

-- CreateIndex
CREATE INDEX "Budget_userId_idx" ON "Budget"("userId");

-- CreateIndex
CREATE INDEX "Budget_fyYear_idx" ON "Budget"("fyYear");

-- CreateIndex
CREATE INDEX "Budget_categoryId_idx" ON "Budget"("categoryId");

-- CreateIndex
CREATE INDEX "Loan_userId_idx" ON "Loan"("userId");

-- CreateIndex
CREATE INDEX "Loan_loanType_idx" ON "Loan"("loanType");

-- CreateIndex
CREATE INDEX "Loan_emiDate_idx" ON "Loan"("emiDate");

-- CreateIndex
CREATE INDEX "LoanPrepayment_loanId_idx" ON "LoanPrepayment"("loanId");

-- CreateIndex
CREATE INDEX "TaxProfile_userId_idx" ON "TaxProfile"("userId");

-- CreateIndex
CREATE INDEX "TaxProfile_fyYear_idx" ON "TaxProfile"("fyYear");

-- CreateIndex
CREATE UNIQUE INDEX "TaxProfile_userId_fyYear_key" ON "TaxProfile"("userId", "fyYear");

-- CreateIndex
CREATE INDEX "TaxEntry_userId_idx" ON "TaxEntry"("userId");

-- CreateIndex
CREATE INDEX "TaxEntry_fyYear_idx" ON "TaxEntry"("fyYear");

-- CreateIndex
CREATE INDEX "TaxEntry_section_idx" ON "TaxEntry"("section");

-- CreateIndex
CREATE INDEX "AdvanceTaxEvent_fyYear_idx" ON "AdvanceTaxEvent"("fyYear");

-- CreateIndex
CREATE INDEX "AdvanceTaxEvent_dueDate_idx" ON "AdvanceTaxEvent"("dueDate");

-- CreateIndex
CREATE INDEX "Document_userId_idx" ON "Document"("userId");

-- CreateIndex
CREATE INDEX "Document_relatedEntityType_relatedEntityId_idx" ON "Document"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "BankStatementImport_userId_idx" ON "BankStatementImport"("userId");

-- CreateIndex
CREATE INDEX "BankStatementImport_importedAt_idx" ON "BankStatementImport"("importedAt");

-- CreateIndex
CREATE INDEX "AuditLog_performedByUserId_idx" ON "AuditLog"("performedByUserId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedDeposit" ADD CONSTRAINT "FixedDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedDeposit" ADD CONSTRAINT "FixedDeposit_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringDeposit" ADD CONSTRAINT "RecurringDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringDeposit" ADD CONSTRAINT "RecurringDeposit_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SIP" ADD CONSTRAINT "SIP_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SIP" ADD CONSTRAINT "SIP_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SIP" ADD CONSTRAINT "SIP_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SIPTransaction" ADD CONSTRAINT "SIPTransaction_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldHolding" ADD CONSTRAINT "GoldHolding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstate" ADD CONSTRAINT "RealEstate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstate" ADD CONSTRAINT "RealEstate_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_templateTransactionId_fkey" FOREIGN KEY ("templateTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPrepayment" ADD CONSTRAINT "LoanPrepayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEntry" ADD CONSTRAINT "TaxEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "doc_transaction" FOREIGN KEY ("relatedEntityId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "doc_insurance" FOREIGN KEY ("relatedEntityId") REFERENCES "InsurancePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "doc_fd" FOREIGN KEY ("relatedEntityId") REFERENCES "FixedDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "doc_gold" FOREIGN KEY ("relatedEntityId") REFERENCES "GoldHolding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "doc_realestate" FOREIGN KEY ("relatedEntityId") REFERENCES "RealEstate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

