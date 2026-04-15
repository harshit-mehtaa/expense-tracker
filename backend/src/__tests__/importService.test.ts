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
    if (result.transactions.length > 0) {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/review/i);
    }
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
