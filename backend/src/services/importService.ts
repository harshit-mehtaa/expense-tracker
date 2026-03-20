import crypto from 'crypto';
import Papa from 'papaparse';
import iconv from 'iconv-lite';

export interface ParsedTransaction {
  date: Date;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  reference?: string;
}

export interface ParseError {
  row: number;
  message: string;
  raw: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  errors: ParseError[];
  warnings: string[];
  bank: string;
}

// ─── Bank Parsers ─────────────────────────────────────────────────────────────

function parseHDFC(rows: string[][]): ParseResult {
  const transactions: ParsedTransaction[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [];
  let dataStart = 0;

  // HDFC: skip until we find header row with "Date"
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    if (rows[i].some((cell) => cell.trim().toLowerCase() === 'date')) {
      dataStart = i + 1;
      break;
    }
  }

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]?.trim()) continue;

    try {
      // HDFC format: Date | Narration | Chq/Ref | Value Dt | Withdrawal | Deposit | Closing Balance
      const dateStr = row[0].trim();
      const description = row[1]?.trim() || '';
      const withdrawal = parseFloat(row[4]?.replace(/,/g, '') || '0');
      const deposit = parseFloat(row[5]?.replace(/,/g, '') || '0');

      if (!dateStr || (!withdrawal && !deposit)) continue;

      // DD/MM/YY or DD/MM/YYYY
      const parts = dateStr.split('/');
      if (parts.length !== 3) {
        errors.push({ row: i + 1, message: 'Invalid date format', raw: row.join(',') });
        continue;
      }
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      const date = new Date(`${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`);

      if (isNaN(date.getTime())) {
        errors.push({ row: i + 1, message: 'Could not parse date', raw: row.join(',') });
        continue;
      }

      if (deposit > 0) {
        transactions.push({ date, description, amount: deposit, type: 'INCOME', reference: row[2]?.trim() });
      }
      if (withdrawal > 0) {
        transactions.push({ date, description, amount: withdrawal, type: 'EXPENSE', reference: row[2]?.trim() });
      }
    } catch {
      errors.push({ row: i + 1, message: 'Parse error', raw: row.join(',') });
    }
  }

  return { transactions, errors, warnings, bank: 'HDFC' };
}

function parseSBI(rows: string[][]): ParseResult {
  const transactions: ParsedTransaction[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [];
  let dataStart = 0;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].some((cell) => /txn date/i.test(cell))) {
      dataStart = i + 1;
      break;
    }
  }

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]?.trim()) continue;

    try {
      // SBI format: Txn Date | Value Date | Description | Ref No | Debit | Credit | Balance
      const dateStr = row[0].trim();
      const description = row[2]?.trim() || '';
      let debit = parseFloat(row[4]?.replace(/,/g, '') || '0');
      let credit = parseFloat(row[5]?.replace(/,/g, '') || '0');

      // Some SBI exports use Dr/Cr suffix on single amount column
      if (row.length < 6 && row[3]) {
        const amtStr = row[3].trim();
        const amount = parseFloat(amtStr.replace(/,/g, '').replace(/[Dd][Rr]|[Cc][Rr]/, '').trim());
        if (/[Dd][Rr]/.test(amtStr)) debit = amount;
        else credit = amount;
      }

      // SBI date: DD-MMM-YYYY
      const date = new Date(dateStr.replace(/-/g, ' '));
      if (isNaN(date.getTime())) {
        errors.push({ row: i + 1, message: 'Invalid date', raw: row.join(',') });
        continue;
      }

      if (credit > 0) transactions.push({ date, description, amount: credit, type: 'INCOME', reference: row[3]?.trim() });
      if (debit > 0) transactions.push({ date, description, amount: debit, type: 'EXPENSE', reference: row[3]?.trim() });
    } catch {
      errors.push({ row: i + 1, message: 'Parse error', raw: row.join(',') });
    }
  }

  return { transactions, errors, warnings, bank: 'SBI' };
}

function parseICICI(rows: string[][]): ParseResult {
  const transactions: ParsedTransaction[] = [];
  const errors: ParseError[] = [];
  let dataStart = 0;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].some((cell) => /transaction date/i.test(cell))) {
      dataStart = i + 1;
      break;
    }
  }

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]?.trim()) continue;

    try {
      // ICICI: Transaction Date | Value Date | Description | Ref | Debit | Credit | Balance
      const dateStr = row[0].trim();
      const description = row[2]?.trim() || '';
      const debit = parseFloat(row[4]?.replace(/,/g, '') || '0');
      const credit = parseFloat(row[5]?.replace(/,/g, '') || '0');

      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        errors.push({ row: i + 1, message: 'Invalid date', raw: row.join(',') });
        continue;
      }

      if (credit > 0) transactions.push({ date, description, amount: credit, type: 'INCOME' });
      if (debit > 0) transactions.push({ date, description, amount: debit, type: 'EXPENSE' });
    } catch {
      errors.push({ row: i + 1, message: 'Parse error', raw: row.join(',') });
    }
  }

  return { transactions, errors, warnings: [], bank: 'ICICI' };
}

function parseAxis(rows: string[][]): ParseResult {
  const transactions: ParsedTransaction[] = [];
  const errors: ParseError[] = [];
  let dataStart = 0;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].some((cell) => /tran date/i.test(cell) || /transaction date/i.test(cell))) {
      dataStart = i + 1;
      break;
    }
  }

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]?.trim()) continue;

    try {
      const dateStr = row[0].trim();
      const description = (row[2] || row[1])?.trim() || '';
      const debit = parseFloat(row[3]?.replace(/,/g, '') || '0');
      const credit = parseFloat(row[4]?.replace(/,/g, '') || '0');

      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        errors.push({ row: i + 1, message: 'Invalid date', raw: row.join(',') });
        continue;
      }

      if (credit > 0) transactions.push({ date, description, amount: credit, type: 'INCOME' });
      if (debit > 0) transactions.push({ date, description, amount: debit, type: 'EXPENSE' });
    } catch {
      errors.push({ row: i + 1, message: 'Parse error', raw: row.join(',') });
    }
  }

  return { transactions, errors, warnings: [], bank: 'Axis' };
}

function parseKotak(rows: string[][]): ParseResult {
  const transactions: ParsedTransaction[] = [];
  const errors: ParseError[] = [];
  let dataStart = 0;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].some((cell) => /transaction date/i.test(cell) || /date/i.test(cell))) {
      dataStart = i + 1;
      break;
    }
  }

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]?.trim()) continue;

    try {
      const dateStr = row[0].trim();
      const description = row[1]?.trim() || '';
      const debit = parseFloat(row[3]?.replace(/,/g, '') || '0');
      const credit = parseFloat(row[4]?.replace(/,/g, '') || '0');

      // Kotak: DD-MM-YYYY
      const parts = dateStr.split('-');
      const date = parts.length === 3
        ? new Date(`${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`)
        : new Date(dateStr);

      if (isNaN(date.getTime())) {
        errors.push({ row: i + 1, message: 'Invalid date', raw: row.join(',') });
        continue;
      }

      if (credit > 0) transactions.push({ date, description, amount: credit, type: 'INCOME' });
      if (debit > 0) transactions.push({ date, description, amount: debit, type: 'EXPENSE' });
    } catch {
      errors.push({ row: i + 1, message: 'Parse error', raw: row.join(',') });
    }
  }

  return { transactions, errors, warnings: [], bank: 'Kotak' };
}

// ─── Bank Auto-Detection ──────────────────────────────────────────────────────

function detectBank(header: string): string | null {
  const h = header.toLowerCase();
  if (h.includes('hdfc')) return 'HDFC';
  if (h.includes('state bank') || h.includes('sbi')) return 'SBI';
  if (h.includes('icici')) return 'ICICI';
  if (h.includes('axis')) return 'AXIS';
  if (h.includes('kotak')) return 'KOTAK';
  return null;
}

// ─── Main Parse Function ──────────────────────────────────────────────────────

export function parseCSV(buffer: Buffer, bankHint?: string): ParseResult {
  // Handle potential encoding issues (some banks export in Windows-1252)
  let text: string;
  try {
    text = iconv.decode(buffer, 'utf-8');
    if (text.includes('')) {
      text = iconv.decode(buffer, 'windows-1252');
    }
  } catch {
    text = buffer.toString('utf-8');
  }

  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = parsed.data as string[][];

  if (rows.length === 0) {
    return { transactions: [], errors: [{ row: 0, message: 'Empty file', raw: '' }], warnings: [], bank: 'UNKNOWN' };
  }

  // Detect bank from first few rows
  const headerText = rows.slice(0, 5).map((r) => r.join(' ')).join(' ');
  const detectedBank = bankHint?.toUpperCase() || detectBank(headerText);

  switch (detectedBank) {
    case 'HDFC': return parseHDFC(rows);
    case 'SBI': return parseSBI(rows);
    case 'ICICI': return parseICICI(rows);
    case 'AXIS': return parseAxis(rows);
    case 'KOTAK': return parseKotak(rows);
    default: {
      // Generic: try to find date + amount columns
      const warnings = ['Bank not detected — using generic parser. Review imported transactions carefully.'];
      return { ...parseICICI(rows), bank: 'GENERIC', warnings };
    }
  }
}

// ─── Import Hash ──────────────────────────────────────────────────────────────

export function makeImportHash(date: Date, amount: number, type: string, description: string, accountId: string): string {
  const raw = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${type}|${description.trim().toLowerCase()}|${accountId}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}
