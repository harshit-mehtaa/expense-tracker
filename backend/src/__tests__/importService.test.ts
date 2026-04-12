/**
 * Tests for importService — makeImportHash (pure crypto) and parseCSV
 * (uses real iconv-lite + papaparse but no DB access).
 */
import { describe, it, expect } from 'vitest';
import { makeImportHash, parseCSV } from '../services/importService';

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
