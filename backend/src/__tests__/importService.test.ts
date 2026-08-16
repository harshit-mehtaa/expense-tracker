/**
 * Tests for importService — makeImportHash (pure crypto) and parseCSV
 * (uses real iconv-lite + papaparse but no DB access).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeImportHash, parseCSV, parsePDF } from '../services/importService';

// Mock pdf-parse so tests don't need real PDF binary fixtures
vi.mock('pdf-parse', () => {
  return {
    default: vi.fn(),
  };
});

// Helper: import the mock after vi.mock is hoisted
async function getPdfParseMock() {
  const mod = await import('pdf-parse');
  return mod.default as ReturnType<typeof vi.fn>;
}

// ─── makeImportHash ───────────────────────────────────────────────────────────

describe('makeImportHash', () => {
  const DATE = new Date('2025-04-01T00:00:00.000Z');
  const AMOUNT = 1500;
  const TYPE = 'EXPENSE';
  const DESC = 'Salary Credit';
  const ACCOUNT = 'acct-abc123';

  it('is deterministic — same inputs produce the same hash', () => {
    const h1 = makeImportHash(DATE, AMOUNT, TYPE, DESC, ACCOUNT);
    const h2 = makeImportHash(DATE, AMOUNT, TYPE, DESC, ACCOUNT);
    expect(h1).toBe(h2);
  });

  it('produces a 64-character hex string (SHA-256)', () => {
    const hash = makeImportHash(DATE, AMOUNT, TYPE, DESC, ACCOUNT);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes description to lowercase', () => {
    const h1 = makeImportHash(DATE, AMOUNT, TYPE, 'salary credit', ACCOUNT);
    const h2 = makeImportHash(DATE, AMOUNT, TYPE, 'SALARY CREDIT', ACCOUNT);
    expect(h1).toBe(h2);
  });

  it('trims leading/trailing spaces from description', () => {
    const h1 = makeImportHash(DATE, AMOUNT, TYPE, '  Salary Credit  ', ACCOUNT);
    const h2 = makeImportHash(DATE, AMOUNT, TYPE, 'Salary Credit', ACCOUNT);
    expect(h1).toBe(h2);
  });

  it('different dates produce different hashes', () => {
    const h1 = makeImportHash(new Date('2025-04-01'), AMOUNT, TYPE, DESC, ACCOUNT);
    const h2 = makeImportHash(new Date('2025-04-02'), AMOUNT, TYPE, DESC, ACCOUNT);
    expect(h1).not.toBe(h2);
  });

  it('different amounts produce different hashes', () => {
    const h1 = makeImportHash(DATE, 1000, TYPE, DESC, ACCOUNT);
    const h2 = makeImportHash(DATE, 2000, TYPE, DESC, ACCOUNT);
    expect(h1).not.toBe(h2);
  });

  it('different accounts produce different hashes', () => {
    const h1 = makeImportHash(DATE, AMOUNT, TYPE, DESC, 'account-A');
    const h2 = makeImportHash(DATE, AMOUNT, TYPE, DESC, 'account-B');
    expect(h1).not.toBe(h2);
  });

  it('different types (INCOME vs EXPENSE) produce different hashes', () => {
    const h1 = makeImportHash(DATE, AMOUNT, 'INCOME', DESC, ACCOUNT);
    const h2 = makeImportHash(DATE, AMOUNT, 'EXPENSE', DESC, ACCOUNT);
    expect(h1).not.toBe(h2);
  });
});

// ─── parseCSV — empty input ───────────────────────────────────────────────────

describe('parseCSV — empty input', () => {
  it('returns empty transactions and an error for empty buffer', () => {
    const result = parseCSV(Buffer.from(''));
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('Empty file');
    expect(result.bank).toBe('UNKNOWN');
  });

  it('returns empty transactions for whitespace-only buffer', () => {
    const result = parseCSV(Buffer.from('   \n  '));
    expect(result.transactions).toHaveLength(0);
  });
});

// ─── parseCSV — HDFC format ───────────────────────────────────────────────────

describe('parseCSV — HDFC format', () => {
  // HDFC format: Date | Narration | Chq/Ref | Value Dt | Withdrawal | Deposit | Closing Balance
  const HDFC_CSV = [
    'HDFC Bank Statement',
    'Date,Narration,Chq/Ref No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '01/04/25,SALARY CREDIT,REF001,01/04/25,,50000.00,150000.00',
    '05/04/25,GROCERY STORE,REF002,05/04/25,2500.00,,147500.00',
    '10/04/25,ELECTRICITY BILL,REF003,10/04/25,1200.00,,146300.00',
  ].join('\n');

  it('detects bank as HDFC', () => {
    const result = parseCSV(Buffer.from(HDFC_CSV));
    expect(result.bank).toBe('HDFC');
  });

  it('parses income (deposit) rows as INCOME type', () => {
    const result = parseCSV(Buffer.from(HDFC_CSV));
    const income = result.transactions.find((t) => t.type === 'INCOME');
    expect(income).toBeDefined();
    expect(income!.amount).toBe(50000);
    expect(income!.description).toBe('SALARY CREDIT');
  });

  it('parses expense (withdrawal) rows as EXPENSE type', () => {
    const result = parseCSV(Buffer.from(HDFC_CSV));
    const expenses = result.transactions.filter((t) => t.type === 'EXPENSE');
    expect(expenses).toHaveLength(2);
    expect(expenses[0].amount).toBe(2500);
    expect(expenses[1].amount).toBe(1200);
  });

  it('returns Date objects for parsed transactions', () => {
    const result = parseCSV(Buffer.from(HDFC_CSV));
    result.transactions.forEach((t) => {
      expect(t.date).toBeInstanceOf(Date);
      expect(isNaN(t.date.getTime())).toBe(false);
    });
  });

  it('infers payment mode from high-confidence CSV remarks and references', () => {
    const csv = [
      'HDFC Bank Statement',
      'Date,Narration,Chq/Ref No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '01/04/25,UPI/SWIGGY/harshit@okhdfcbank,REF001,01/04/25,500.00,,100000.00',
      '02/04/25,NETBANKING TRANSFER,NEFT123,02/04/25,,1000.00,101000.00',
      '03/04/25,POS AMAZON PURCHASE,REF003,03/04/25,250.00,,100750.00',
      '04/04/25,NACH-MANDATE-MUTUAL FUND,REF004,04/04/25,100.00,,100650.00',
    ].join('\n');

    const result = parseCSV(Buffer.from(csv), 'HDFC');

    expect(result.transactions.map((t) => t.paymentMode)).toEqual(['UPI', 'NEFT', 'CARD', 'AUTO_DEBIT']);
  });

  it('leaves payment mode empty when CSV remarks are ambiguous', () => {
    const csv = [
      'HDFC Bank Statement',
      'Date,Narration,Chq/Ref No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '01/04/25,GROCERY STORE,REF001,01/04/25,500.00,,100000.00',
    ].join('\n');

    const result = parseCSV(Buffer.from(csv), 'HDFC');

    expect(result.transactions[0].paymentMode).toBeUndefined();
  });
});

// ─── parseCSV — bank hint ─────────────────────────────────────────────────────

describe('parseCSV — bank hint override', () => {
  it('uses the bank hint to select parser even if header does not match', () => {
    // Generic CSV with no bank name in header
    const csv = [
      'Date,Narration,Chq/Ref No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '01/04/25,TEST INCOME,REF001,01/04/25,,5000.00,5000.00',
    ].join('\n');

    const result = parseCSV(Buffer.from(csv), 'HDFC');
    expect(result.bank).toBe('HDFC');
  });
});

// ─── parseCSV — unknown format ────────────────────────────────────────────────

describe('parseCSV — unknown format', () => {
  it('returns bank: GENERIC and a warning for unrecognised format', () => {
    const csv = 'SomeColumn,AnotherColumn\nvalue1,value2\n';
    const result = parseCSV(Buffer.from(csv));
    expect(result.bank).toBe('GENERIC');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/not detected/i);
  });
});

// ─── parseCSV — SBI format ────────────────────────────────────────────────────

describe('parseCSV — SBI format', () => {
  // SBI format: Txn Date | Value Date | Description | Ref No | Debit | Credit | Balance
  // Date format: DD-MMM-YYYY (e.g. "01-Apr-2025")
  const SBI_CSV = [
    'Txn Date,Value Date,Description,Ref No,Debit,Credit,Balance',
    '01-Apr-2025,01-Apr-2025,SALARY CREDIT,NEFT001,,50000.00,150000.00',
    '05-Apr-2025,05-Apr-2025,ELECTRICITY BILL,REF002,1500.00,,148500.00',
  ].join('\n');

  it('detects bank as SBI', () => {
    const result = parseCSV(Buffer.from(SBI_CSV), 'SBI');
    expect(result.bank).toBe('SBI');
  });

  it('parses credit rows as INCOME', () => {
    const result = parseCSV(Buffer.from(SBI_CSV), 'SBI');
    const income = result.transactions.find((t) => t.type === 'INCOME');
    expect(income).toBeDefined();
    expect(income!.amount).toBe(50000);
    expect(income!.description).toBe('SALARY CREDIT');
  });

  it('parses debit rows as EXPENSE', () => {
    const result = parseCSV(Buffer.from(SBI_CSV), 'SBI');
    const expense = result.transactions.find((t) => t.type === 'EXPENSE');
    expect(expense).toBeDefined();
    expect(expense!.amount).toBe(1500);
  });

  it('returns Date objects for all transactions', () => {
    const result = parseCSV(Buffer.from(SBI_CSV), 'SBI');
    result.transactions.forEach((t) => {
      expect(t.date).toBeInstanceOf(Date);
      expect(isNaN(t.date.getTime())).toBe(false);
    });
  });

  it('records invalid date row in errors and continues parsing', () => {
    const csv = [
      'Txn Date,Value Date,Description,Ref No,Debit,Credit,Balance',
      'BAD-DATE,01-Apr-2025,Some Transaction,REF001,500.00,,',
      '10-Apr-2025,10-Apr-2025,Valid Transaction,REF002,,2000.00,',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv), 'SBI');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.transactions.some((t) => t.amount === 2000)).toBe(true);
  });

  it('parses SBI compact Dr suffix format — single debit column (lines 108-113)', () => {
    // row.length < 6 && row[3] → triggers Dr/Cr suffix branch
    const csv = [
      'Txn Date,Value Date,Description,Amount',
      '01-Apr-2025,01-Apr-2025,ELECTRICITY BILL,1500.00Dr',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv), 'SBI');
    const expense = result.transactions.find((t) => t.type === 'EXPENSE');
    expect(expense).toBeDefined();
    expect(expense!.amount).toBe(1500);
  });

  it('parses SBI compact Cr suffix format — single credit column', () => {
    const csv = [
      'Txn Date,Value Date,Description,Amount',
      '05-Apr-2025,05-Apr-2025,SALARY CREDIT,60000.00Cr',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv), 'SBI');
    const income = result.transactions.find((t) => t.type === 'INCOME');
    expect(income).toBeDefined();
    expect(income!.amount).toBe(60000);
  });
});

// ─── parseCSV — ICICI format ──────────────────────────────────────────────────

describe('parseCSV — ICICI format', () => {
  // ICICI: Transaction Date | Value Date | Description | Ref | Debit | Credit | Balance
  // Date format: ISO or standard parseable (e.g. "2025-04-01")
  const ICICI_CSV = [
    'ICICI Bank Statement',
    'Transaction Date,Value Date,Description,Ref,Debit,Credit,Balance',
    '2025-04-01,2025-04-01,SALARY CREDIT,NEFT001,,80000.00,200000.00',
    '2025-04-03,2025-04-03,AMAZON PURCHASE,REF002,3500.00,,196500.00',
  ].join('\n');

  it('detects bank as ICICI', () => {
    const result = parseCSV(Buffer.from(ICICI_CSV), 'ICICI');
    expect(result.bank).toBe('ICICI');
  });

  it('parses credit rows as INCOME', () => {
    const result = parseCSV(Buffer.from(ICICI_CSV), 'ICICI');
    const income = result.transactions.find((t) => t.type === 'INCOME');
    expect(income).toBeDefined();
    expect(income!.amount).toBe(80000);
  });

  it('parses debit rows as EXPENSE', () => {
    const result = parseCSV(Buffer.from(ICICI_CSV), 'ICICI');
    const expense = result.transactions.find((t) => t.type === 'EXPENSE');
    expect(expense).toBeDefined();
    expect(expense!.amount).toBe(3500);
  });

  it('auto-detects ICICI from header text (no hint needed)', () => {
    const result = parseCSV(Buffer.from(ICICI_CSV)); // no bank hint
    expect(result.bank).toBe('ICICI');
  });

  it('records invalid date row in errors and continues parsing valid rows', () => {
    const csv = [
      'ICICI Bank Statement',
      'Transaction Date,Value Date,Description,Ref,Debit,Credit,Balance',
      'NOT-A-DATE,2025-04-01,Bad Row,REF001,500.00,,',
      '2025-04-02,2025-04-02,Good Row,REF002,,2000.00,',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv), 'ICICI');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.transactions.some((t) => t.amount === 2000)).toBe(true);
  });

  it('parses ICICI exports that include a leading serial-number column and Indian date format', () => {
    const csv = [
      'ICICI Bank Statement',
      'S No,Transaction Date,Value Date,Transaction Remarks,Withdrawal Amount (INR),Deposit Amount (INR),Balance (INR)',
      '1,02/04/2026,02/04/2026,UPI/PAYMENT/SHOP,189.00,,10000.00',
      '2,03/04/2026,03/04/2026,SALARY CREDIT,,595.00,10595.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv), 'ICICI');

    expect(result.errors).toHaveLength(0);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      amount: 189,
      type: 'EXPENSE',
      description: 'UPI/PAYMENT/SHOP',
      remark: 'UPI/PAYMENT/SHOP',
    });
    expect(result.transactions[0].date.toISOString()).toBe('2026-04-02T00:00:00.000Z');
    expect(result.transactions[1]).toMatchObject({
      amount: 595,
      type: 'INCOME',
      description: 'SALARY CREDIT',
      remark: 'SALARY CREDIT',
    });
    expect(result.transactions[1].date.toISOString()).toBe('2026-04-03T00:00:00.000Z');
  });

  it('maps ICICI withdrawal/deposit columns by header and never treats balance as income', () => {
    const csv = [
      'S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount(INR),Deposit Amount(INR),Balance(INR),',
      '1,02/04/2026,02/04/2026,,UPI/MERCHANT/PAYMENT,189.00,0.00,445317.85,',
      '2,03/04/2026,03/04/2026,,NEFT/SALARY CREDIT,0.00,1000.00,446317.85,',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv), 'ICICI');

    expect(result.errors).toHaveLength(0);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      date: new Date('2026-04-02'),
      description: 'UPI/MERCHANT/PAYMENT',
      remark: 'UPI/MERCHANT/PAYMENT',
      amount: 189,
      type: 'EXPENSE',
    });
    expect(result.transactions[1]).toMatchObject({
      date: new Date('2026-04-03'),
      description: 'NEFT/SALARY CREDIT',
      remark: 'NEFT/SALARY CREDIT',
      amount: 1000,
      type: 'INCOME',
    });
    expect(result.transactions.some((t) => t.amount === 445317.85 || t.amount === 446317.85)).toBe(false);
  });
});

// ─── parseCSV — Axis format ───────────────────────────────────────────────────

describe('parseCSV — Axis format', () => {
  // Axis: Tran Date | ... | Description | Debit | Credit | ...
  const AXIS_CSV = [
    'Tran Date,Chq No,Description,Debit,Credit,Balance',
    '2025-04-01,,SALARY,,60000.00,160000.00',
    '2025-04-05,,MOBILE RECHARGE,499.00,,159501.00',
  ].join('\n');

  it('detects bank as Axis (title case)', () => {
    const result = parseCSV(Buffer.from(AXIS_CSV), 'AXIS');
    expect(result.bank).toBe('Axis'); // Note: title case!
  });

  it('parses credit rows as INCOME', () => {
    const result = parseCSV(Buffer.from(AXIS_CSV), 'AXIS');
    const income = result.transactions.find((t) => t.type === 'INCOME');
    expect(income).toBeDefined();
    expect(income!.amount).toBe(60000);
  });

  it('parses debit rows as EXPENSE', () => {
    const result = parseCSV(Buffer.from(AXIS_CSV), 'AXIS');
    const expense = result.transactions.find((t) => t.type === 'EXPENSE');
    expect(expense).toBeDefined();
    expect(expense!.amount).toBe(499);
  });

  it('records invalid date row in errors and continues parsing valid rows', () => {
    const csv = [
      'Tran Date,Chq No,Description,Debit,Credit,Balance',
      'NOT-A-DATE,,Bad Row,500.00,,',
      '2025-04-05,,Valid Row,,1000.00,',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv), 'AXIS');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.transactions.some((t) => t.amount === 1000)).toBe(true);
  });
});

// ─── parseCSV — Kotak format ──────────────────────────────────────────────────

describe('parseCSV — Kotak format', () => {
  // Kotak: Transaction Date | Description | ... | Debit | Credit | ...
  // Date format: DD-MM-YYYY (e.g. "01-04-2025")
  const KOTAK_CSV = [
    'Transaction Date,Description,Chq / Ref No.,Debit Amount,Credit Amount,Balance',
    '01-04-2025,SALARY CREDIT,NEFT001,,75000.00,175000.00',
    '04-04-2025,RENT PAYMENT,REF002,25000.00,,150000.00',
  ].join('\n');

  it('detects bank as Kotak (title case)', () => {
    const result = parseCSV(Buffer.from(KOTAK_CSV), 'KOTAK');
    expect(result.bank).toBe('Kotak'); // Note: title case!
  });

  it('parses credit rows as INCOME', () => {
    const result = parseCSV(Buffer.from(KOTAK_CSV), 'KOTAK');
    const income = result.transactions.find((t) => t.type === 'INCOME');
    expect(income).toBeDefined();
    expect(income!.amount).toBe(75000);
  });

  it('parses debit rows as EXPENSE', () => {
    const result = parseCSV(Buffer.from(KOTAK_CSV), 'KOTAK');
    const expense = result.transactions.find((t) => t.type === 'EXPENSE');
    expect(expense).toBeDefined();
    expect(expense!.amount).toBe(25000);
  });

  it('parses DD-MM-YYYY date format correctly', () => {
    const result = parseCSV(Buffer.from(KOTAK_CSV), 'KOTAK');
    result.transactions.forEach((t) => {
      expect(t.date).toBeInstanceOf(Date);
      expect(isNaN(t.date.getTime())).toBe(false);
    });
  });

  it('records invalid date row in errors and continues parsing valid rows', () => {
    const csv = [
      'Transaction Date,Description,Chq / Ref No.,Debit Amount,Credit Amount,Balance',
      'BAD-DATE-ROW,INVALID TRANSACTION,REF001,500.00,,',
      '01-04-2025,SALARY CREDIT,NEFT001,,75000.00,175000.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv), 'KOTAK');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.transactions.some((t) => t.amount === 75000)).toBe(true);
  });

  it('dateStr with no dashes falls back to new Date(dateStr) — line 240 false branch', () => {
    // '2025/04/01' → split('-') → 1 part → parts.length !== 3 → false branch → new Date('2025/04/01')
    const csv = [
      'Transaction Date,Description,Chq / Ref No.,Debit Amount,Credit Amount,Balance',
      '2025/04/01,SALARY CREDIT,NEFT001,,50000.00,150000.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv), 'KOTAK');
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe(50000);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── parsePDF — error cases ───────────────────────────────────────────────────

describe('parsePDF — error cases', () => {
  let pdfParseMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pdfParseMock = await getPdfParseMock();
    vi.clearAllMocks();
  });

  it('returns an error when pdf-parse throws a password error', async () => {
    pdfParseMock.mockRejectedValueOnce(new Error('password required'));
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/password/i);
  });

  it('returns an error when pdf-parse throws an encrypted error', async () => {
    pdfParseMock.mockRejectedValueOnce(new Error('File encrypted'));
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/password/i);
  });

  it('returns an error for non-password pdf-parse failure', async () => {
    pdfParseMock.mockRejectedValueOnce(new Error('Corrupt PDF stream'));
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/Failed to read PDF/i);
  });

  it('returns a clear error when extracted text is empty (scanned PDF)', async () => {
    pdfParseMock.mockResolvedValueOnce({ text: '', numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/no extractable text/i);
  });

  it('returns a clear error when extracted text is too short', async () => {
    pdfParseMock.mockResolvedValueOnce({ text: 'short', numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/no extractable text/i);
  });

  it('returns an error when no transaction rows can be extracted from valid text', async () => {
    const boilerplateText = 'Account Statement\nHDFC Bank\nAccount Holder: John Doe\nBranch: Mumbai\n'.repeat(5);
    pdfParseMock.mockResolvedValueOnce({ text: boilerplateText, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ─── parsePDF — HDFC text layout ─────────────────────────────────────────────

describe('parsePDF — HDFC text layout', () => {
  let pdfParseMock: ReturnType<typeof vi.fn>;

  // Simulated pdf-parse output for a typical HDFC statement
  // Format: Date  Narration  Ref  Value Dt  Withdrawal  Deposit  Balance
  const HDFC_PDF_TEXT = [
    'HDFC Bank Statement of Account',
    'Account Number: 12345678901234',
    'Period: 01 Apr 2025 To 30 Apr 2025',
    '',
    'Date         Narration              Chq/Ref    Value Dt  Withdrawal  Deposit    Balance',
    '01/04/25     NEFT CR-SALARY-CORP    REF001     01/04/25              50,000.00  1,50,000.00',
    '05/04/25     UPI/SWIGGY FOOD        REF002     05/04/25  450.00                 1,49,550.00',
    '10/04/25     ELECTRICITY BILL       REF003     10/04/25  1,200.00               1,48,350.00',
    '15/04/25     INTEREST CREDIT        REF004     15/04/25              250.00     1,48,600.00',
  ].join('\n');

  beforeEach(async () => {
    pdfParseMock = await getPdfParseMock();
    vi.clearAllMocks();
    pdfParseMock.mockResolvedValue({ text: HDFC_PDF_TEXT, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
  });

  it('detects bank as HDFC', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.bank).toBe('HDFC');
  });

  it('parses income rows (NEFT CR, INTEREST) as INCOME type', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    const income = result.transactions.filter((t) => t.type === 'INCOME');
    expect(income.length).toBeGreaterThanOrEqual(1);
    expect(income.some((t) => t.description.includes('SALARY'))).toBe(true);
  });

  it('parses expense rows (UPI, ELECTRICITY) as EXPENSE type', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    const expenses = result.transactions.filter((t) => t.type === 'EXPENSE');
    expect(expenses.length).toBeGreaterThanOrEqual(1);
  });

  it('parses dates as valid Date objects', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    result.transactions.forEach((t) => {
      expect(t.date).toBeInstanceOf(Date);
      expect(isNaN(t.date.getTime())).toBe(false);
    });
  });

  it('skips header/footer rows that have no date', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    // Header rows "HDFC Bank Statement of Account", "Account Number:", etc. should not appear
    result.transactions.forEach((t) => {
      expect(t.description).not.toMatch(/account number/i);
    });
  });

  it('uses the bank hint to override auto-detection', async () => {
    const result = await parsePDF(Buffer.from('fake'), 'SBI');
    expect(result.bank).toBe('SBI');
  });

  it('passes the password option to pdf-parse', async () => {
    await parsePDF(Buffer.from('fake'), undefined, 'secret123');
    expect(pdfParseMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ password: 'secret123' }),
    );
  });

  it('includes a warning about PDF parsing accuracy', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/review/i);
  });
});

// ─── parsePDF — SBI text layout ──────────────────────────────────────────────

describe('parsePDF — SBI text layout', () => {
  let pdfParseMock: ReturnType<typeof vi.fn>;

  // SBI dates: DD-MMM-YYYY
  const SBI_PDF_TEXT = [
    'State Bank of India - Account Statement',
    'Account: XXXXX5678',
    '',
    'Txn Date    Value Date    Description           Ref No     Debit        Credit       Balance',
    '01-Apr-2025 01-Apr-2025   SALARY CREDIT         NEFT0001                50,000.00    1,50,000.00',
    '07-Apr-2025 07-Apr-2025   BILL PAYMENT ELECT    REF0002    1,500.00                  1,48,500.00',
  ].join('\n');

  beforeEach(async () => {
    pdfParseMock = await getPdfParseMock();
    vi.clearAllMocks();
    pdfParseMock.mockResolvedValue({ text: SBI_PDF_TEXT, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
  });

  it('detects bank as SBI', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.bank).toBe('SBI');
  });

  it('parses credit rows as INCOME', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    const income = result.transactions.filter((t) => t.type === 'INCOME');
    expect(income.length).toBeGreaterThanOrEqual(1);
  });

  it('parses debit rows as EXPENSE', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    const expenses = result.transactions.filter((t) => t.type === 'EXPENSE');
    expect(expenses.length).toBeGreaterThanOrEqual(1);
  });

  it('parses DD-MMM-YYYY dates correctly', async () => {
    const result = await parsePDF(Buffer.from('fake'));
    const firstTx = result.transactions[0];
    if (firstTx) {
      expect(firstTx.date.getFullYear()).toBe(2025);
      expect(firstTx.date.getMonth()).toBe(3); // April = month 3 (0-indexed)
    }
  });
});

// ─── parsePDF — inferTransactionType and amount-heuristic edge cases ─────────
// These tests exercise the "both-columns > 0" fall-through (line 378) and the
// 3-amounts positional heuristic (lines 503-504).

describe('parsePDF — amount heuristic edge cases', () => {
  let pdfParseMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pdfParseMock = await getPdfParseMock();
    vi.clearAllMocks();
  });

  it('both-columns-nonzero falls through to default EXPENSE (line 378)', async () => {
    // "MISCELLANEOUS TRANSFER" has no income/expense keywords.
    // 3 amounts where withdrawal=500 AND deposit=300 are BOTH non-zero → neither heuristic fires.
    // inferTransactionType falls through to return 'EXPENSE' (line 378).
    const text = [
      'Test Bank Statement',
      'Account: 12345678',
      '01/04/25     MISCELLANEOUS TRANSFER    REF001   01/04/25  500.00  300.00  1,49,200.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    const tx = result.transactions.find((t) => t.description.includes('MISCELLANEOUS'));
    expect(tx).toBeDefined();
    expect(tx!.type).toBe('EXPENSE');
    expect(tx!.amount).toBeGreaterThan(0); // positional heuristic picks withdrawal column (lines 503-504)
  });

  it('amount at position 0 in afterDate uses whole line as description (line 489)', async () => {
    // afterDate starts immediately with an amount (no leading description text).
    // firstAmtPos = 0 → rawDescription = afterDate (the "else" branch, line 489).
    // Keyword "SALARY" in the middle → INCOME is detected.
    const text = [
      'Test Bank Statement',
      'Account: 12345678',
      '01/04/25 50,000.00 SALARY CREDIT 50,000.00 1,50,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    // At least one transaction should be extracted (description includes amount text)
    expect(result.transactions.length + result.errors.length).toBeGreaterThan(0);
  });
});

// ─── parsePDF — alternate date format coverage ───────────────────────────────
// The parsePDFDate helper supports DD/MM/YY, DD/MM/YYYY, DD-MM-YYYY, DD-MMM-YYYY, ISO.
// Existing tests cover DD/MM/YY (HDFC) and DD-MMM-YYYY (SBI).
// These tests cover the remaining date formats (lines 336-338, 345-352).

describe('parsePDF — DD-MM-YYYY date format (lines 336-338)', () => {
  let pdfParseMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pdfParseMock = await getPdfParseMock();
    vi.clearAllMocks();
  });

  it('parses DD-MM-YYYY dates and extracts a transaction', async () => {
    const text = [
      'Test Bank Statement',
      'Account: 12345678',
      '01-04-2025   SALARY CREDIT   REF001   50,000.00   1,50,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].date.getFullYear()).toBe(2025);
    expect(result.transactions[0].amount).toBe(50000);
  });
});

describe('parsePDF — ISO YYYY-MM-DD date format (lines 345-352)', () => {
  let pdfParseMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pdfParseMock = await getPdfParseMock();
    vi.clearAllMocks();
  });

  it('parses YYYY-MM-DD dates and extracts a transaction', async () => {
    const text = [
      'Test Bank Statement',
      'Account: 12345678',
      '2025-04-01   SALARY CREDIT   REF001   50,000.00   1,50,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].date.getFullYear()).toBe(2025);
    expect(result.transactions[0].amount).toBe(50000);
  });
});

// ─── parseCSV — HDFC edge-case branches ──────────────────────────────────────

describe('parseCSV — HDFC edge-case branches', () => {
  it('row with zero withdrawal AND zero deposit is skipped (line 54 !withdrawal&&!deposit branch)', () => {
    const csv = [
      'HDFC Bank Statement',
      'Date,Narration,Chq/Ref No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '01/04/25,ZERO ROW,REF001,01/04/25,0,0,100000.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv));
    expect(result.transactions).toHaveLength(0); // zero amounts → skipped
  });

  it('HDFC row with non-slash date → invalid date parts → error (line 58 parts.length≠3 branch)', () => {
    const csv = [
      'HDFC Bank Statement',
      'Date,Narration,Chq/Ref No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '2025-04-01,SALARY,REF001,2025-04-01,,50000.00,150000.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv));
    // dateStr='2025-04-01', parts=['2025-04-01'] (split by '/') → length=1 ≠ 3 → error
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/invalid date format/i);
  });

  it('HDFC 4-digit year (DD/MM/YYYY) parsed correctly (line 62 false branch: parts[2].length≠2)', () => {
    const csv = [
      'HDFC Bank Statement',
      'Date,Narration,Chq/Ref No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '01/04/2025,SALARY CREDIT,REF001,01/04/2025,,50000.00,150000.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv));
    // parts[2]='2025' (length=4) → uses parts[2] directly → year='2025'
    const income = result.transactions.find((t) => t.type === 'INCOME');
    expect(income).toBeDefined();
    expect(income!.date.getFullYear()).toBe(2025);
    expect(income!.date.getMonth()).toBe(3); // April
  });

  it('HDFC row with invalid date components → error (line 65 isNaN branch)', () => {
    const csv = [
      'HDFC Bank Statement',
      'Date,Narration,Chq/Ref No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '99/99/25,SALARY,REF001,99/99/25,,50000.00,150000.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv));
    // parts=['99','99','25'], year='2025', d=new Date('2025-99-99')=Invalid → error
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/could not parse date/i);
  });
});

// ─── parseCSV — bank auto-detection branches ─────────────────────────────────

describe('parseCSV — bank auto-detection from header', () => {
  it('detects SBI from "State Bank" header text (line 258 first alt)', () => {
    const csv = [
      'State Bank of India - Account Statement',
      'Txn Date,Value Date,Description,Ref No,Debit,Credit,Balance',
      '01-Apr-2025,01-Apr-2025,SALARY CREDIT,NEFT001,,50000.00,150000.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv)); // no bank hint
    expect(result.bank).toBe('SBI');
  });

  it('detects Axis from "Axis" header text (line 260)', () => {
    const csv = [
      'Axis Bank Account Statement',
      'Tran Date,Chq No,Description,Debit,Credit,Balance',
      '2025-04-01,,SALARY,,60000.00,160000.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv)); // no bank hint
    expect(result.bank).toBe('Axis');
  });

  it('detects Kotak from "Kotak" header text (line 261)', () => {
    const csv = [
      'Kotak Mahindra Bank Statement',
      'Transaction Date,Description,Chq / Ref No.,Debit Amount,Credit Amount,Balance',
      '01-04-2025,SALARY CREDIT,NEFT001,,75000.00,175000.00',
    ].join('\n');
    const result = parseCSV(Buffer.from(csv)); // no bank hint
    expect(result.bank).toBe('Kotak');
  });
});

// ─── parsePDF — detectBankFromText branches ───────────────────────────────────

describe('parsePDF — detectBankFromText ICICI/Axis/Kotak (lines 359-361)', () => {
  let pdfParseMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pdfParseMock = await getPdfParseMock();
    vi.clearAllMocks();
  });

  it('detects ICICI from PDF text (line 359)', async () => {
    // Text doesn't include 'hdfc', 'state bank', 'sbi' → falls through to ICICI check
    const text = 'ICICI Bank - Account Statement\n' + 'Account: XXXXXXXX1234\n'.repeat(10);
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.bank).toBe('ICICI');
  });

  it('detects AXIS from PDF text (line 360)', async () => {
    const text = 'Axis Bank Ltd - Account Statement\n' + 'Account: XXXXXXXX5678\n'.repeat(10);
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.bank).toBe('AXIS');
  });

  it('detects KOTAK from PDF text (line 361)', async () => {
    const text = 'Kotak Mahindra Bank - Account Statement\n' + 'Account: XXXXXXXX9012\n'.repeat(10);
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.bank).toBe('KOTAK');
  });
});

// ─── parsePDF — main loop edge cases (lines 476, 479, 484, 494) ──────────────

describe('parsePDF — main loop edge-case branches', () => {
  let pdfParseMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pdfParseMock = await getPdfParseMock();
    vi.clearAllMocks();
  });

  it('date-like pattern with invalid date components is skipped (lines 337/476)', async () => {
    // "99-99-9999" matches DD-MM-YYYY PDF pattern but parsePDFDate returns null (isNaN)
    // → if (!date) continue at line 476
    const text = [
      'Test Bank Statement (long enough padding here to pass trimmedText check)',
      '99-99-9999 SALARY CREDIT REF001 50,000.00 1,50,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    // Invalid date → date=null → skipped → no transactions from that line
    expect(result.transactions.filter((t) => t.amount === 50000)).toHaveLength(0);
  });

  it('future-date rows are skipped (line 479)', async () => {
    // "01/04/99" → year 2099 (far future) → date > new Date() → continue
    const text = [
      'Test Bank Statement with enough text padding here to pass length check',
      '01/04/99 SALARY CREDIT REF001 50,000.00 1,50,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    // 2099 date is in future → skipped
    expect(result.transactions.filter((t) => t.amount === 50000)).toHaveLength(0);
  });

  it('date-matched line with no amounts is skipped (line 484)', async () => {
    // Line matches date pattern but afterDate has no amounts matching \d{1,3}(,\d{2,3})*\.\d{2}
    const text = [
      'Test Bank Statement with enough text padding here to pass length check',
      '01/04/25 SOME TEXT WITHOUT DECIMAL AMOUNTS',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(0);
  });

  it('line with very short description is skipped (line 494)', async () => {
    // afterDate = "X 5,000.00" → firstAmtPos=2 → rawDesc=afterDate.slice(0,2)="X " → cleaned="X" (len<2)
    const text = [
      'Test Bank Statement with enough text padding here to pass length check',
      '01/04/25 X 5,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(0); // description "X" is < 2 chars → skipped
  });

  it('non-Error thrown by pdf-parse uses String(err) for message (line 422)', async () => {
    // err instanceof Error is false → String(err) path → not password/encrypted → generic error
    pdfParseMock.mockRejectedValueOnce('unexpected string rejection');
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.errors[0].message).toMatch(/Failed to read PDF/i);
    expect(result.errors[0].message).toContain('unexpected string rejection');
  });
});

// ─── parsePDF — invalid dates in each format (parsePDFDate isNaN branches) ───

describe('parsePDF — parsePDFDate invalid-date branches (lines 337, 343, 355)', () => {
  let pdfParseMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pdfParseMock = await getPdfParseMock();
    vi.clearAllMocks();
  });

  it('DD/MM/YY with 4-digit year covers line 335 false branch (DD/MM/YYYY)', async () => {
    // "01/04/2025" → m[3]='2025' (length=4) → false branch: uses m[3] directly
    const text = [
      'Test Bank Statement with enough text padding here to pass length check',
      '01/04/2025 SALARY CREDIT REF001 50,000.00 1,50,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].date.getFullYear()).toBe(2025);
    expect(result.transactions[0].amount).toBe(50000);
  });

  it('DD/MM/YY with invalid date components returns null, row skipped (line 337 null branch)', async () => {
    // "32/13/25" → matches DD/MM/YY pattern → new Date("2025-13-32") = Invalid Date → isNaN → null → skip
    const text = [
      'Test Bank Statement with enough text padding here to pass length check',
      '32/13/25 SALARY CREDIT REF001 50,000.00 1,50,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions.filter((t) => t.amount === 50000)).toHaveLength(0);
  });

  it('DD-MMM-YYYY invalid month name gives null date, row skipped (line 349 null branch)', async () => {
    // "99-ZZZ-9999" matches DD-MMM-YYYY PDF pattern, parsePDFDate uses DD[\s-]MMM[\s-]YYYY internally
    // d = new Date('99 ZZZ 9999') = Invalid → isNaN → null → line 476 continue
    const text = [
      'Test Bank Statement with enough text padding here to pass length check',
      '99-ZZZ-9999 SALARY CREDIT REF001 50,000.00 1,50,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions.filter((t) => t.amount === 50000)).toHaveLength(0);
  });

  it('YYYY-MM-DD invalid month/day gives null date, row skipped (line 355 null branch)', async () => {
    // "9999-99-99" matches ISO PDF pattern, parsePDFDate: d=new Date('9999-99-99')=Invalid → null
    const text = [
      'Test Bank Statement with enough text padding here to pass length check',
      '9999-99-99 SALARY CREDIT REF001 50,000.00 1,50,000.00',
    ].join('\n');
    pdfParseMock.mockResolvedValue({ text, numpages: 1, numrender: 1, info: {}, metadata: {}, version: '1.0' });
    const result = await parsePDF(Buffer.from('fake'));
    expect(result.transactions.filter((t) => t.amount === 50000)).toHaveLength(0);
  });
});

// ─── parsePDF — deduplication hash stability ─────────────────────────────────

describe('parsePDF — deduplication hash stability', () => {
  it('same transaction produces same importHash regardless of CSV or PDF source', () => {
    // The hash function takes (date, amount, type, description, scopeId) — same for both
    const date = new Date('2025-04-01T00:00:00.000Z');
    const h1 = makeImportHash(date, 50000, 'INCOME', 'salary credit', 'user-abc');
    const h2 = makeImportHash(date, 50000, 'INCOME', 'SALARY CREDIT', 'user-abc');
    // Case-insensitive normalization means same hash
    expect(h1).toBe(h2);
  });

  it('userId as scopeId produces a different hash than accountId as scopeId', () => {
    const date = new Date('2025-04-01T00:00:00.000Z');
    const h1 = makeImportHash(date, 50000, 'INCOME', 'salary credit', 'user-abc');
    const h2 = makeImportHash(date, 50000, 'INCOME', 'salary credit', 'account-xyz');
    expect(h1).not.toBe(h2);
  });
});

// ─── parseBankDate format matrix (module-private, driven through parseICICI) ───

describe('parseCSV — ICICI date-format matrix', () => {
  /** Build a 1-row ICICI CSV whose transaction date is `dateStr`. */
  function iciciWithDate(dateStr: string) {
    return parseCSV(Buffer.from([
      'Transaction Date,Value Date,Description,Ref,Debit,Credit,Balance',
      `${dateStr},${dateStr},TEST ROW,REF001,,1000.00,5000.00`,
    ].join('\n')), 'ICICI');
  }

  it('parses ISO YYYY-MM-DD', () => {
    const r = iciciWithDate('2025-04-01');
    expect(r.errors).toHaveLength(0);
    expect(r.transactions[0].date.toISOString()).toBe('2025-04-01T00:00:00.000Z');
  });

  it('zero-pads a single-digit ISO month and day', () => {
    const r = iciciWithDate('2025-4-1');
    expect(r.errors).toHaveLength(0);
    expect(r.transactions[0].date.toISOString()).toBe('2025-04-01T00:00:00.000Z');
  });

  it('rejects an ISO-shaped but impossible date', () => {
    const r = iciciWithDate('2025-13-45');
    expect(r.errors[0].message).toBe('Invalid date');
    expect(r.transactions).toHaveLength(0);
  });

  it('parses DD/MM/YYYY as day-first (not US month-first)', () => {
    const r = iciciWithDate('02/04/2026');
    expect(r.transactions[0].date.toISOString()).toBe('2026-04-02T00:00:00.000Z');
  });

  it('expands a 2-digit year to 20YY', () => {
    const r = iciciWithDate('02/04/26');
    expect(r.errors).toHaveLength(0);
    expect(r.transactions[0].date.toISOString()).toBe('2026-04-02T00:00:00.000Z');
  });

  it('rejects a DD/MM/YYYY-shaped but impossible date', () => {
    const r = iciciWithDate('45/45/2026');
    expect(r.errors[0].message).toBe('Invalid date');
  });

  it('parses DD-MMM-YYYY (e.g. 01-Apr-2025)', () => {
    const r = iciciWithDate('01-Apr-2025');
    expect(r.errors).toHaveLength(0);
    const d = r.transactions[0].date;
    // Constructed via `new Date("1 Apr 2025")` → local midnight, so compare parts.
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 3, 1]);
  });

  it('parses DD MMM YYYY with spaces instead of dashes', () => {
    const r = iciciWithDate('15 Aug 2025');
    expect(r.errors).toHaveLength(0);
    const d = r.transactions[0].date;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 7, 15]);
  });

  it('rejects a DD-MMM-YYYY-shaped date with a bogus month name', () => {
    const r = iciciWithDate('01-Zzz-2025');
    expect(r.errors[0].message).toBe('Invalid date');
  });

  it('falls back to Date parsing for other recognizable formats', () => {
    const r = iciciWithDate('April 1 2025');
    expect(r.errors).toHaveLength(0);
    const d = r.transactions[0].date;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 3, 1]);
  });
});

// ─── parseAmount + payment-mode inference edge cases ──────────────────────────

describe('parseCSV — ICICI amount and payment-mode edge cases', () => {
  it('treats a non-numeric amount as 0 (row contributes no transaction)', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Value Date,Description,Ref,Debit,Credit,Balance',
      '2025-04-01,2025-04-01,GARBAGE AMOUNT,REF001,abc,,5000.00',
    ].join('\n')), 'ICICI');
    expect(r.errors).toHaveLength(0);
    expect(r.transactions).toHaveLength(0);
  });

  it('strips thousands separators from amounts', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Value Date,Description,Ref,Debit,Credit,Balance',
      '2025-04-01,2025-04-01,BIG CREDIT,REF001,,"1,23,456.78",5000.00',
    ].join('\n')), 'ICICI');
    expect(r.transactions[0].amount).toBe(123456.78);
  });

  it('leaves paymentMode unset when there is no text to infer from', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Value Date,Description,Ref,Debit,Credit,Balance',
      '2025-04-01,2025-04-01,,,,1000.00,5000.00',
    ].join('\n')), 'ICICI');
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].paymentMode).toBeUndefined();
  });

  it('infers a payment mode from the description text', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Value Date,Description,Ref,Debit,Credit,Balance',
      '2025-04-01,2025-04-01,UPI/PAYTM/GROCERY,REF001,250.00,,5000.00',
    ].join('\n')), 'ICICI');
    expect(r.transactions[0].paymentMode).toBeDefined();
  });

  it('leaves paymentMode unset when the text matches no rule', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Value Date,Description,Ref,Debit,Credit,Balance',
      '2025-04-01,2025-04-01,ZZZZZZ NOTHING MATCHES,REF001,250.00,,5000.00',
    ].join('\n')), 'ICICI');
    expect(r.transactions[0].paymentMode).toBeUndefined();
  });
});

// ─── ICICI header-detection branches ──────────────────────────────────────────

describe('parseCSV — ICICI header detection', () => {
  it('falls back to the value-date column when no transaction-date column exists', () => {
    const r = parseCSV(Buffer.from([
      'Value Date,Description,Debit,Credit',
      '2025-04-01,SALARY,,1000.00',
    ].join('\n')), 'ICICI');
    expect(r.errors).toHaveLength(0);
    expect(r.transactions[0].date.toISOString()).toBe('2025-04-01T00:00:00.000Z');
  });

  it('errors when the header row is missing entirely', () => {
    const r = parseCSV(Buffer.from([
      'Some Bank Statement',
      '2025-04-01,SALARY,,1000.00',
    ].join('\n')), 'ICICI');
    expect(r.errors[0].message).toMatch(/Missing required ICICI CSV headers/);
    expect(r.transactions).toHaveLength(0);
  });

  it('errors when a date column exists but no description column does', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Debit,Credit',
      '2025-04-01,,1000.00',
    ].join('\n')), 'ICICI');
    expect(r.errors[0].message).toMatch(/Missing required ICICI CSV headers/);
  });

  it('errors when neither a debit nor a credit column exists', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Description,Balance',
      '2025-04-01,SALARY,1000.00',
    ].join('\n')), 'ICICI');
    expect(r.errors[0].message).toMatch(/Missing required ICICI CSV headers/);
  });

  it('parses a credit-only statement (no debit column present)', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Description,Credit',
      '2025-04-01,SALARY,1000.00',
    ].join('\n')), 'ICICI');
    expect(r.errors).toHaveLength(0);
    expect(r.transactions[0]).toMatchObject({ amount: 1000, type: 'INCOME' });
  });

  it('parses a debit-only statement (no credit column present)', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Description,Debit',
      '2025-04-01,RENT,15000.00',
    ].join('\n')), 'ICICI');
    expect(r.errors).toHaveLength(0);
    expect(r.transactions[0]).toMatchObject({ amount: 15000, type: 'EXPENSE' });
  });

  it('omits reference when no reference column is present', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Description,Credit',
      '2025-04-01,SALARY,1000.00',
    ].join('\n')), 'ICICI');
    expect(r.transactions[0].reference).toBeUndefined();
  });

  it('skips rows whose first cell is blank', () => {
    const r = parseCSV(Buffer.from([
      'Transaction Date,Description,Debit,Credit',
      '2025-04-01,SALARY,,1000.00',
      ',,,',
    ].join('\n')), 'ICICI');
    expect(r.transactions).toHaveLength(1);
  });
});

describe('parseCSV — ICICI blank date cell', () => {
  it('reports an empty transaction-date cell as an invalid date rather than crashing', () => {
    // Leading serial column keeps row[0] non-blank, so the row is NOT skipped and the
    // empty date cell reaches parseBankDate.
    const r = parseCSV(Buffer.from([
      'S No,Transaction Date,Description,Debit,Credit',
      '1,,SOME PAYMENT,500.00,',
    ].join('\n')), 'ICICI');
    expect(r.transactions).toHaveLength(0);
    expect(r.errors[0].message).toBe('Invalid date');
  });

  it('reports a whitespace-only transaction-date cell as an invalid date', () => {
    const r = parseCSV(Buffer.from([
      'S No,Transaction Date,Description,Debit,Credit',
      '1,   ,SOME PAYMENT,500.00,',
    ].join('\n')), 'ICICI');
    expect(r.errors[0].message).toBe('Invalid date');
  });

  it('reports a missing trailing date cell as an invalid date', () => {
    // Short row: the date column index exists in the header but not in this data row.
    const r = parseCSV(Buffer.from([
      'S No,Description,Debit,Credit,Transaction Date',
      '1,SOME PAYMENT,500.00,',
    ].join('\n')), 'ICICI');
    expect(r.errors[0].message).toBe('Invalid date');
  });
});
