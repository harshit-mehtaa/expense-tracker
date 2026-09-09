import crypto from 'crypto';
import { PaymentMode } from '@prisma/client';
import Papa from 'papaparse';
import iconv from 'iconv-lite';
import * as pdfParseModule from 'pdf-parse';

export interface ParsedTransaction {
  date: Date;
  description: string;
  remark?: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  categoryId?: string;
  reference?: string;
  paymentMode?: PaymentMode;
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

function parseAmount(value: string | undefined): number {
  const normalized = value?.replace(/,/g, '').trim() || '';
  if (!normalized) return 0;
  const amount = parseFloat(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

const PAYMENT_MODE_RULES: Array<{ mode: PaymentMode; patterns: RegExp[] }> = [
  { mode: PaymentMode.EMI, patterns: [/\bemi\b/i] },
  {
    mode: PaymentMode.AUTO_DEBIT,
    patterns: [
      /\bauto[\s-]?debit\b/i,
      /\bnach\b/i,
      /\becs\b/i,
      /\bmandate\b/i,
      /\bstanding\s+instruction\b/i,
      /\bsi[-/\s]*(?:mandate|auto|debit|payment|transfer|sip|mf|mutual|insurance|premium|emi)\b/i,
      /\bautopay\b/i,
    ],
  },
  {
    mode: PaymentMode.UPI,
    patterns: [
      /\bupi(?:\b|[-/0-9])/i,
      /\bupi[-/]/i,
      /[-/]\s*upi\b/i,
      /\b(?:gpay|google\s*pay|phonepe|bharatpe)\b/i,
      /(?:^|[^a-z0-9._%+-])[a-z0-9._-]{2,}@(okaxis|okhdfcbank|oksbi|okicici|ybl|ibl|axl|upi|paytm|ptaxis|pthdfc|yesbank|barodampay|sbi|hdfcbank|icici|axisbank|kotak|idfcbank|fbl)(?:[^a-z0-9.-]|$)/i,
    ],
  },
  { mode: PaymentMode.IMPS, patterns: [/\bimps(?:\b|[-/0-9])/i] },
  { mode: PaymentMode.NEFT, patterns: [/\bneft(?:\b|[-/0-9])/i] },
  { mode: PaymentMode.RTGS, patterns: [/\brtgs(?:\b|[-/0-9])/i] },
  {
    mode: PaymentMode.CHEQUE,
    patterns: [/\bcheque\b/i, /\bcheq\b/i, /\bchq\b/i, /\bclg\b/i, /\bclearing\b/i],
  },
  {
    mode: PaymentMode.CASH,
    patterns: [
      /\bcash\b/i,
      /\batm\b.*\b(?:cash|wdl|withdrawal|withdrawn)\b/i,
      /\b(?:cash|wdl|withdrawal|withdrawn)\b.*\batm\b/i,
    ],
  },
  {
    mode: PaymentMode.CARD,
    patterns: [
      /\bpos\b/i,
      /\bvisa\b/i,
      /\bmastercard\b/i,
      /\brupay\b/i,
      /\be[-\s]?com\b/i,
      /\b(?:debit|credit)\s+card\s+(?:purchase|txn|transaction|pos|swipe)\b/i,
      /\bcard\s+(?:purchase|txn|transaction|pos|swipe)\b/i,
    ],
  },
];

function inferPaymentModeFromRemark(remark: string): PaymentMode | undefined {
  const text = remark.trim();
  if (!text) return undefined;

  const normalized = text.replace(/[_|:]+/g, ' ').replace(/\s+/g, ' ');
  const searchable = `${text} ${normalized}`;

  return PAYMENT_MODE_RULES.find((rule) => (
    rule.patterns.some((pattern) => pattern.test(searchable))
  ))?.mode;
}

function withInferredPaymentMode(transaction: ParsedTransaction): ParsedTransaction {
  // Kept deliberately, not deleted: ParsedTransaction declares `paymentMode?: PaymentMode`,
  // and the day a parser does set it, an explicitly parsed value must beat an inferred one.
  // No parser populates it today, so the guard is unreachable through the public API and
  // covering it would mean exporting this private helper purely for a test.
  /* c8 ignore next -- defensive: no parser sets paymentMode yet, see comment above */
  if (transaction.paymentMode) return transaction;

  const text = [transaction.remark, transaction.description, transaction.reference]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const paymentMode = inferPaymentModeFromRemark(text);

  return paymentMode ? { ...transaction, paymentMode } : transaction;
}

function withInferredPaymentModes(result: ParseResult): ParseResult {
  return {
    ...result,
    transactions: result.transactions.map(withInferredPaymentMode),
  };
}

const MONTH_ABBREV_INDEX: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Build a Date from DD/MMM/YYYY parts (any bank's "01 Apr 2025" or "01-Apr-2025"
 * style) via an explicit UTC-safe ISO string, instead of `new Date("01 Apr 2025")` —
 * that form is parsed in the PROCESS's LOCAL timezone per the ECMA-262 spec (unlike a
 * plain `YYYY-MM-DD` string, which is always UTC), so on a non-UTC host the same
 * calendar day resolves to a different UTC instant than the numeric-date branches in
 * this file produce for the identical real date. That divergence broke cross-format
 * (CSV vs PDF) transaction matching — see statementImportService.ts's fuzzy dedup and
 * makeImportHash's date-string derivation, both of which assume same-day inputs land
 * on the same UTC day regardless of which branch parsed them.
 */
function parseUTCDateFromDayMonthYear(day: string, monthAbbrev: string, year: string): Date | null {
  const mm = MONTH_ABBREV_INDEX[monthAbbrev.slice(0, 3).toLowerCase()];
  if (!mm) return null;
  const date = new Date(`${year}-${mm}-${day.padStart(2, '0')}`);
  return isNaN(date.getTime()) ? null : date;
}

function parseBankDate(value: string): Date | null {
  const dateStr = value.trim();
  if (!dateStr) return null;

  let match = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    const date = new Date(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
    return isNaN(date.getTime()) ? null : date;
  }

  match = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    const date = new Date(`${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
    return isNaN(date.getTime()) ? null : date;
  }

  match = dateStr.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (match) {
    return parseUTCDateFromDayMonthYear(match[1], match[2], match[3]);
  }

  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

function findHeaderIndex(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function normalizeHeaders(row: string[]): string[] {
  return row.map((cell) => cell.trim().toLowerCase().replace(/\s+/g, ' '));
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
    /* c8 ignore next -- row[0] is never null/undefined with PapaParse (defensive optional chain) */
    if (!row[0]?.trim()) continue;

    try {
      // HDFC format: Date | Narration | Chq/Ref | Value Dt | Withdrawal | Deposit | Closing Balance
      const dateStr = row[0].trim();
      /* c8 ignore next -- row[1] is never null/undefined with PapaParse (defensive optional chain) */
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
        transactions.push({ date, description, remark: description, amount: deposit, type: 'INCOME', reference: row[2]?.trim() });
      }
      if (withdrawal > 0) {
        transactions.push({ date, description, remark: description, amount: withdrawal, type: 'EXPENSE', reference: row[2]?.trim() });
      }
    /* c8 ignore next 3 -- defensive: standard string/array ops in the try body never throw */
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
    /* c8 ignore next -- row[0] is never null/undefined with PapaParse (defensive optional chain) */
    if (!row[0]?.trim()) continue;

    try {
      // SBI format: Txn Date | Value Date | Description | Ref No | Debit | Credit | Balance
      const dateStr = row[0].trim();
      /* c8 ignore next -- row[2] is never null/undefined with PapaParse (defensive optional chain) */
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
      const sbiDateMatch = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
      const date = sbiDateMatch ? parseUTCDateFromDayMonthYear(sbiDateMatch[1], sbiDateMatch[2], sbiDateMatch[3]) : null;
      if (!date || isNaN(date.getTime())) {
        errors.push({ row: i + 1, message: 'Invalid date', raw: row.join(',') });
        continue;
      }

      if (credit > 0) transactions.push({ date, description, remark: description, amount: credit, type: 'INCOME', reference: row[3]?.trim() });
      if (debit > 0) transactions.push({ date, description, remark: description, amount: debit, type: 'EXPENSE', reference: row[3]?.trim() });
    /* c8 ignore next 3 -- defensive: standard string/array ops in the try body never throw */
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
  let foundHeader = false;
  let dateIdx = -1;
  let descriptionIdx = -1;
  let referenceIdx = -1;
  let debitIdx = -1;
  let creditIdx = -1;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const headers = normalizeHeaders(rows[i]);
    if (headers.some((cell) => /transaction date|txn date|value date/.test(cell))) {
      const transactionDateIdx = findHeaderIndex(headers, [/^transaction date$/, /^txn date$/]);
      const valueDateIdx = findHeaderIndex(headers, [/^value date$/]);
      dateIdx = transactionDateIdx >= 0 ? transactionDateIdx : valueDateIdx;
      const detectedDescriptionIdx = findHeaderIndex(headers, [/description/, /remarks?/, /narration/, /particulars/]);
      const detectedReferenceIdx = findHeaderIndex(headers, [/ref/, /reference/, /chq/]);
      const detectedDebitIdx = findHeaderIndex(headers, [/debit/, /withdrawal/, /dr amount/]);
      const detectedCreditIdx = findHeaderIndex(headers, [/credit/, /deposit/, /cr amount/]);
      descriptionIdx = detectedDescriptionIdx;
      referenceIdx = detectedReferenceIdx;
      debitIdx = detectedDebitIdx;
      creditIdx = detectedCreditIdx;
      dataStart = i + 1;
      foundHeader = true;
      break;
    }
  }

  if (!foundHeader || dateIdx < 0 || descriptionIdx < 0 || (debitIdx < 0 && creditIdx < 0)) {
    return {
      transactions,
      errors: [{ row: 0, message: 'Missing required ICICI CSV headers for date, remarks, debit, and credit columns', raw: '' }],
      warnings: [],
      bank: 'ICICI',
    };
  }

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]?.trim()) continue;

    try {
      // ICICI variants may include a leading serial-number column.
      const dateStr = row[dateIdx]?.trim() || '';
      const description = row[descriptionIdx]?.trim() || '';
      const debit = debitIdx >= 0 ? parseAmount(row[debitIdx]) : 0;
      const credit = creditIdx >= 0 ? parseAmount(row[creditIdx]) : 0;

      const date = parseBankDate(dateStr);
      if (!date) {
        errors.push({ row: i + 1, message: 'Invalid date', raw: row.join(',') });
        continue;
      }

      if (credit > 0) transactions.push({ date, description, remark: description, amount: credit, type: 'INCOME', reference: referenceIdx >= 0 ? row[referenceIdx]?.trim() : undefined });
      if (debit > 0) transactions.push({ date, description, remark: description, amount: debit, type: 'EXPENSE', reference: referenceIdx >= 0 ? row[referenceIdx]?.trim() : undefined });
    /* c8 ignore next 3 -- defensive: standard string/array ops in the try body never throw */
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
    /* c8 ignore next -- row[0] is never null/undefined with PapaParse (defensive optional chain) */
    if (!row[0]?.trim()) continue;

    try {
      const dateStr = row[0].trim();
      /* c8 ignore next -- row elements are never null/undefined with PapaParse (defensive optional chain) */
      const description = (row[2] || row[1])?.trim() || '';
      const debit = parseFloat(row[3]?.replace(/,/g, '') || '0');
      const credit = parseFloat(row[4]?.replace(/,/g, '') || '0');

      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        errors.push({ row: i + 1, message: 'Invalid date', raw: row.join(',') });
        continue;
      }

      if (credit > 0) transactions.push({ date, description, remark: description, amount: credit, type: 'INCOME' });
      if (debit > 0) transactions.push({ date, description, remark: description, amount: debit, type: 'EXPENSE' });
    /* c8 ignore next 3 -- defensive: standard string/array ops in the try body never throw */
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
    /* c8 ignore next -- row[0] is never null/undefined with PapaParse (defensive optional chain) */
    if (!row[0]?.trim()) continue;

    try {
      const dateStr = row[0].trim();
      /* c8 ignore next -- row[1] is never null/undefined with PapaParse (defensive optional chain) */
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

      if (credit > 0) transactions.push({ date, description, remark: description, amount: credit, type: 'INCOME' });
      if (debit > 0) transactions.push({ date, description, remark: description, amount: debit, type: 'EXPENSE' });
    /* c8 ignore next 3 -- defensive: standard string/array ops in the try body never throw */
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
  /* c8 ignore next 3 -- defensive fallback: iconv.decode rarely throws in practice */
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
    case 'HDFC': return withInferredPaymentModes(parseHDFC(rows));
    case 'SBI': return withInferredPaymentModes(parseSBI(rows));
    case 'ICICI': return withInferredPaymentModes(parseICICI(rows));
    case 'AXIS': return withInferredPaymentModes(parseAxis(rows));
    case 'KOTAK': return withInferredPaymentModes(parseKotak(rows));
    default: {
      // Generic: try to find date + amount columns
      const warnings = ['Bank not detected — using generic parser. Review imported transactions carefully.'];
      return withInferredPaymentModes({ ...parseICICI(rows), bank: 'GENERIC', warnings });
    }
  }
}

// ─── PDF Parser ───────────────────────────────────────────────────────────────

/**
 * Date patterns for Indian bank statement PDFs.
 * Groups: [full_match, date_string]
 * Note: index 0 handles both DD/MM/YY and DD/MM/YYYY — the \d{2,4} year group covers both.
 */
const PDF_DATE_PATTERNS = [
  /^(\d{2}\/\d{2}\/\d{2,4})\b/,     // DD/MM/YY or DD/MM/YYYY  (HDFC, ICICI, Axis)
  /^(\d{2}-\d{2}-\d{4})\b/,          // DD-MM-YYYY               (Kotak)
  /^(\d{2}\s[A-Za-z]{3}\s\d{4})\b/, // DD MMM YYYY              (SBI)
  /^(\d{2}-[A-Za-z]{3}-\d{4})\b/,   // DD-MMM-YYYY              (SBI alt)
  /^(\d{4}-\d{2}-\d{2})\b/,         // YYYY-MM-DD               (ISO)
  /^(?:\d{1,6}\s+)?(\d{2}\.\d{2}\.\d{4})\b/, // [S.No.] DD.MM.YYYY (ICICI passbook export)
];

/** Keyword that strongly suggests a credit (INCOME) transaction */
const INCOME_KEYWORD_RE = /\b(?:cr|credit|deposit|salary|credited|refund|reversal|interest|dividend|cashback|imps cr|neft cr|upi cr|rtgs cr|byorder|by clg|by transfer)\b/i;

/** Keyword that strongly suggests a debit (EXPENSE) transaction */
const EXPENSE_KEYWORD_RE = /\b(?:dr|debit|withdrawal|withdrawn|debited|payment|purchase|bill|emi|auto.?debit|nach|ach|to transfer|imps dr|neft dr|upi dr|rtgs dr|atm|pos )\b/i;

function parsePDFDate(dateStr: string): Date | null {
  // DD/MM/YY or DD/MM/YYYY
  let m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = new Date(`${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    return isNaN(d.getTime()) ? null : d;
  }
  // DD-MM-YYYY or DD.MM.YYYY
  m = dateStr.match(/^(\d{2})[-.](\d{2})[-.](\d{4})$/);
  if (m) {
    const d = new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    return isNaN(d.getTime()) ? null : d;
  }
  // DD MMM YYYY or DD-MMM-YYYY
  m = dateStr.match(/^(\d{2})[\s-]([A-Za-z]{3})[\s-](\d{4})$/);
  if (m) {
    return parseUTCDateFromDayMonthYear(m[1], m[2], m[3]);
  }
  // ISO YYYY-MM-DD
  m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}`);
    return isNaN(d.getTime()) ? null : d;
    /* c8 ignore next -- if body always returns; closing brace is unreachable */
  }
  /* c8 ignore next 2 -- defensive fallback: parsePDFDate is only called with strings from PDF_DATE_PATTERNS which always match one of the cases above */
  return null;
}

function detectBankFromText(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('hdfc')) return 'HDFC';
  if (t.includes('state bank') || t.includes(' sbi ') || t.includes('sbi.co')) return 'SBI';
  if (t.includes('icici')) return 'ICICI';
  if (t.includes('axis bank') || t.includes('axisbank')) return 'AXIS';
  if (t.includes('kotak')) return 'KOTAK';
  return 'GENERIC';
}

function cleanDescription(raw: string): string {
  return raw
    .replace(/\s{2,}/g, ' ')  // collapse multiple spaces
    .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '') // strip control chars
    .trim();
}

interface AmountToken { value: number; index: number; length: number; }

/** Narrow amount token — the original, well-tested pattern (comma-grouped, <=3 leading digits). */
const AMOUNT_RE_NARROW = /\b(\d{1,3}(?:,\d{2,3})*\.\d{2})\b/g;
/**
 * Fallback amount token for ungrouped thousands, e.g. ICICI's `683783.52` (no commas).
 * Only ever consulted when AMOUNT_RE_NARROW finds nothing on a line — see scanAmounts.
 * The lookbehind/lookahead guard rejects a decimal-shaped fragment immediately adjacent
 * to a digit/`.`/`,`/`-`/`/`/`:`/`#`/`|`/`(`/`)`/`*` — the delimiter set actually seen
 * in real UPI/NEFT/RTGS reference strings (e.g. "NEFT-N123456789-1234.00" and
 * "MMT/IMPS/518012345678/1234.00/ABC" both correctly reject "1234.00" — see
 * importService.test.ts for the exact rejected/accepted cases).
 */
const AMOUNT_RE_WIDE = /(?<![\w.,\-/:#|()*])(\d+(?:,\d{2,3})*\.\d{2})(?![\w.,\-/:#|()*])/g;

/**
 * Every regex match, INCLUDING a zero-valued "0.00" placeholder — position-accurate.
 * Callers filter to `value > 0` themselves wherever a value (not just a position)
 * matters; the description-boundary split in the single-line path deliberately needs
 * the UNFILTERED first match (see scanAmounts) to keep `makeImportHash` stable for
 * statements that render an empty Withdrawal/Deposit column as "0.00".
 */
function scanAmountTokens(text: string, re: RegExp): AmountToken[] {
  const tokens: AmountToken[] = [];
  const r = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    tokens.push({ value: val, index: m.index, length: m[0].length });
  }
  return tokens;
}

interface AmountScan { tokens: AmountToken[]; tier: 'narrow' | 'wide'; }

/**
 * Single source of truth for "where are the amounts in this text". Always tries the
 * narrow (comma-grouped) pattern first; only falls back to the ungrouped-thousands
 * pattern when narrow's nonzero matches don't reach the end of the line cleanly (either
 * because it found nothing, or because a narration fragment happens to fit narrow's
 * <=3-digit cap while the real trailing amount doesn't). Any line whose amounts the
 * narrow pattern already matches cleanly today is completely unaffected by the wide
 * pattern. Returns the RAW (zero-inclusive) token list for whichever tier was chosen —
 * see scanAmountTokens for why.
 */
function scanAmounts(text: string): AmountScan {
  const narrow = scanAmountTokens(text, AMOUNT_RE_NARROW);
  const narrowNonZero = narrow.filter((t) => t.value > 0);
  if (narrowNonZero.length > 0) {
    const last = narrowNonZero[narrowNonZero.length - 1];
    const tail = text.slice(last.index + last.length).trim();
    if (tail.length === 0) return { tokens: narrow, tier: 'narrow' };
  }
  return { tokens: scanAmountTokens(text, AMOUNT_RE_WIDE), tier: 'wide' };
}

function selectAmountForType(type: 'INCOME' | 'EXPENSE', amounts: number[]): number {
  // Heuristic: if 3+ amounts (withdrawal, deposit, balance), use positional inference:
  // In HDFC/SBI-style: amounts[-3]=withdrawal, amounts[-2]=deposit, amounts[-1]=balance
  if (amounts.length >= 3) {
    let amount = type === 'EXPENSE' ? amounts[amounts.length - 3] : amounts[amounts.length - 2];
    /* c8 ignore next -- callers only ever pass amounts filtered to val > 0, so amount is never 0 here */
    if (amount === 0) amount = amounts[0];
    return amount;
  }
  return amounts[0];
}

interface RowState { prevBalance: number | null; prevDate: Date | null; ascending: boolean; }

/**
 * Whether the statement's dated rows run oldest-first overall. A per-row `date >=
 * prevDate` check alone cannot tell "ascending statement, same-day rows" from
 * "descending statement, same-day rows" — both look identical locally — so delta
 * inference is gated on this GLOBAL direction, not just the pairwise comparison. On a
 * descending (or indeterminate) statement, delta inference is disabled entirely rather
 * than attempted in reverse: reconciling against the correct neighbor would require
 * comparing to the NEXT row's balance instead of the previous one, a materially
 * different (and untested) code path, not worth the risk for what a bounded, disabled
 * fallback already handles safely via keyword/positional/default inference.
 *
 * Uses a majority vote over EVERY consecutive pair of dated lines, not just first-vs-
 * last — first-vs-last is fooled by a single non-transaction dated line (a "Statement
 * Period: 01/07/2026 to 31/07/2026" header, or a "Printed on" footer) landing at either
 * end, and resolves an all-same-day statement to "ascending" by default, silently
 * re-enabling the exact inversion this gate exists to prevent. A vote across every pair
 * is robust to a handful of stray header/footer date lines as long as real transaction
 * rows dominate, and ties (including "no clear direction" and "all one day") default to
 * FALSE — disabled — because a wrong-signed transaction is worse than a merely
 * conservative one.
 */
function detectStatementDateOrder(lines: string[]): boolean {
  const dates: Date[] = [];
  for (const line of lines) {
    for (const pattern of PDF_DATE_PATTERNS) {
      const m = line.match(pattern);
      if (!m) continue;
      const d = parsePDFDate(m[1]);
      if (d && d <= new Date()) dates.push(d);
      break;
    }
  }
  let increasing = 0;
  let decreasing = 0;
  for (let i = 1; i < dates.length; i++) {
    const cmp = dates[i].getTime() - dates[i - 1].getTime();
    if (cmp > 0) increasing++;
    else if (cmp < 0) decreasing++;
  }
  return increasing > decreasing;
}

/**
 * Decide direction (INCOME/EXPENSE) and the transaction amount for one row. This
 * function is NOT layout-gated — it runs for every bank's rows, not just ICICI's, so a
 * reconciled delta can now take precedence over a keyword on any layout, not only the
 * new multi-line one.
 * Precedence: reconciled balance-delta (only when the statement runs oldest-first
 * overall AND this row's date is non-decreasing vs. the last row AND exactly one
 * candidate amount reconciles to the cent — see detectStatementDateOrder) > keyword
 * match > the existing 3-amount positional heuristic > default EXPENSE.
 * A reconciled delta wins over a disagreeing keyword — verified against a real
 * statement, where keyword false-positives (a Fixed Deposit narrated with "Deposit", a
 * salary NACH batch credit narrated with "nach"/"ach") were the wrong answer both times
 * delta and keyword actually disagreed. Disagreement is still surfaced via `warnings`
 * so the user can double-check.
 */
function resolveTransaction(
  description: string,
  amounts: number[],
  date: Date,
  state: RowState,
  warnings: string[],
): { type: 'INCOME' | 'EXPENSE'; amount: number } {
  const keywordType: 'INCOME' | 'EXPENSE' | undefined = INCOME_KEYWORD_RE.test(description)
    ? 'INCOME'
    : EXPENSE_KEYWORD_RE.test(description)
      ? 'EXPENSE'
      : undefined;

  let deltaResult: { type: 'INCOME' | 'EXPENSE'; amount: number } | null = null;
  if (
    amounts.length >= 2
    && state.prevBalance !== null
    && state.prevDate !== null
    && state.ascending
    && date.getTime() >= state.prevDate.getTime()
  ) {
    const balance = amounts[amounts.length - 1];
    const delta = balance - state.prevBalance;
    const deltaAbs = Math.abs(delta);
    const candidates = amounts.slice(0, -1).filter((a) => Math.abs(a - deltaAbs) < 0.005);
    if (candidates.length === 1) {
      deltaResult = { type: delta >= 0 ? 'INCOME' : 'EXPENSE', amount: candidates[0] };
    }
  }

  // A reconciled delta is arithmetic proof (it only fires when the balance math works
  // out to the cent), while a keyword match is a heuristic over free-text narration that
  // demonstrably misfires on real statements — e.g. "...Deposit T4 301..." for a Fixed
  // Deposit purchase (an EXPENSE from this account, not an INCOME "deposit"), and
  // "NACH...ACH/SAL-..." for an employer's salary NACH batch credit (INCOME, not the
  // auto-debit EXPENSE the "nach"/"ach" keywords normally imply). Both were verified
  // against a real statement during implementation. So when they disagree, prefer the
  // delta and surface the disagreement as a warning instead of silently trusting the
  // keyword.
  if (deltaResult && keywordType && keywordType !== deltaResult.type) {
    warnings.push(
      `Transaction direction on ${date.toISOString().slice(0, 10)}: the description `
      + `matched ${keywordType} keywords, but balance reconciliation determined `
      + `${deltaResult.type} — used ${deltaResult.type} (balance math is more reliable `
      + `than keyword matching). Please verify this transaction.`,
    );
    return deltaResult;
  }
  if (deltaResult) return deltaResult;
  if (keywordType) return { type: keywordType, amount: selectAmountForType(keywordType, amounts) };

  if (amounts.length >= 3) {
    const withdrawal = amounts[amounts.length - 3];
    const deposit = amounts[amounts.length - 2];
    /* c8 ignore next 2 -- callers only ever pass amounts filtered to val > 0, so withdrawal/deposit are always >0 here; these true branches are unreachable */
    if (deposit > 0 && withdrawal === 0) return { type: 'INCOME', amount: deposit };
    if (withdrawal > 0 && deposit === 0) return { type: 'EXPENSE', amount: withdrawal };
  }
  // Default to EXPENSE — conservative, user can correct. Route through
  // selectAmountForType (not amounts[0] directly) so a 4+-amount row picks the same
  // positional column here as it would via the keyword branch above — consistent with
  // the original pre-refactor behavior, which always applied positional selection for
  // 3+ amount rows regardless of how the type was determined.
  return { type: 'EXPENSE', amount: selectAmountForType('EXPENSE', amounts) };
}

/**
 * A dated line describing a statement-level total, not an individual transaction — an
 * "Opening/Closing Balance", "Total", or "Brought/Carried Forward" row. These can carry
 * one OR TWO amount-shaped tokens (e.g. "TOTAL WITHDRAWALS 100000.00 TOTAL DEPOSITS
 * 200000.00"), so the wide-tier "needs >= 2 amounts" heuristic alone doesn't reject
 * them — this keyword check runs first and is decisive. Matched lines are skipped
 * outright (like a future-date artifact), not routed through the block accumulator and
 * not counted toward the dropped-row warning — they were never a transaction attempt.
 */
const SUMMARY_LINE_RE = /\b(?:opening|closing)\s+balance\b|\btotal\b|\bbrought\s+forward\b|\bcarried\s+forward\b|\bb\/f\b|\bc\/f\b/i;

const MAX_BLOCK_LOOKAHEAD = 6;
/** Lines that must never be swallowed into a transaction description, even if they
 * happen to fall inside a block-accumulator's lookahead window (glossary/legend/footer
 * text in the real ICICI export, e.g. "SMO - Smart Money Order", "-- 6 of 6 --"), or a
 * statement-total/opening-closing-balance line — see SUMMARY_LINE_RE. */
const BLOCK_BAILOUT_RE = new RegExp(
  `^(legends?\\b|note[:\\s]|disclaimer\\b|page\\s+\\d|--\\s*\\d+\\s+of\\s+\\d+\\s*--|${SUMMARY_LINE_RE.source})`,
  'i',
);

function isDateLineStart(line: string): boolean {
  return PDF_DATE_PATTERNS.some((p) => p.test(line));
}

interface MultiLineBlock { description: string; amounts: number[]; endIdx: number; }

/**
 * ICICI-style layout: date+payee is on `lines[startIdx]`, narration wraps across
 * several following lines with no date/amount, and the transaction amount + running
 * balance appear together on a later line with nothing after them (a "terminator").
 * Only ever called when the single-line path already found zero amounts on the date
 * line, so this can never engage for a layout (HDFC/SBI/etc.) that already works.
 */
function tryParseMultiLineBlock(
  lines: string[],
  startIdx: number,
  firstLineRemainder: string,
): MultiLineBlock | null {
  const narrationParts: string[] = firstLineRemainder ? [firstLineRemainder] : [];
  const limit = Math.min(lines.length - 1, startIdx + MAX_BLOCK_LOOKAHEAD);

  for (let j = startIdx + 1; j <= limit; j++) {
    const candidate = lines[j];
    if (isDateLineStart(candidate)) return null; // next row started — no terminator found
    if (BLOCK_BAILOUT_RE.test(candidate)) return null; // footer/legend — bail, don't consume

    // Use the wide (ungrouped-thousands-tolerant) regex directly here, not the
    // narrow-first scanAmounts(): this function is only ever reached from a line whose
    // narrow scan already found nothing (see call site), so a terminator candidate can
    // legitimately mix a narrow-shaped token ("40.00") with a wide-only one
    // ("683783.52") on the same line — narrow-first would silently keep only the
    // first and miss the second.
    const tokens = scanAmountTokens(candidate, AMOUNT_RE_WIDE); // may include "0.00" placeholders
    if (tokens.length >= 2) {
      const last = tokens[tokens.length - 1];
      const tail = candidate.slice(last.index + last.length).trim();
      if (tail.length === 0) {
        // Numeric-tail-only line: everything from the first amount token onward is the
        // amount region. The last RAW token is always the balance (even in the rare
        // case it's genuinely 0.00 — an emptied account). Earlier zero-valued tokens
        // are a blank Withdrawal/Deposit column rendering as "0.00" and are dropped; a
        // real transaction amount is always > 0.
        const candidateAmounts = tokens.slice(0, -1).filter((t) => t.value > 0).map((t) => t.value);
        if (candidateAmounts.length === 0) return null;
        const prefix = candidate.slice(0, tokens[0].index).trim();
        if (prefix) narrationParts.push(prefix);
        return {
          description: cleanDescription(narrationParts.join(' ')),
          amounts: [...candidateAmounts, last.value],
          endIdx: j,
        };
      }
    }
    narrationParts.push(candidate);
  }
  return null;
}

/**
 * Parse a bank statement PDF buffer into structured transactions.
 * Uses regex-based date/amount detection — robust against column variability in PDF text.
 *
 * @param buffer  - PDF file buffer
 * @param bankHint - Optional bank name override (HDFC/SBI/ICICI/AXIS/KOTAK)
 * @param password - Optional password for encrypted PDFs
 */
export async function parsePDF(
  buffer: Buffer,
  bankHint?: string,
  password?: string,
): Promise<ParseResult> {
  let rawText: string;
  let parser: { getText: () => Promise<{ text: string }>; destroy: () => Promise<void> } | undefined;
  try {
    let PDFParseCtor: any;
    try {
      // NOT dead code: under Vitest's ESM module mock the namespace is a Proxy that
      // THROWS on access to an export the mock factory did not define, so probing for
      // the v2-only `PDFParse` export must stay guarded. (Against the real package a
      // missing property would merely be undefined.)
      PDFParseCtor = (pdfParseModule as any).PDFParse;
    } catch {
      PDFParseCtor = undefined;
    }
    let data: { text: string };
    if (PDFParseCtor) {
      parser = new PDFParseCtor({ data: new Uint8Array(buffer), password });
      data = await parser!.getText();
    } else {
      const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
      data = await pdfParse(buffer, { password, max: 0 });
    }
    rawText = data.text;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password/i.test(msg) || /encrypted/i.test(msg)) {
      return {
        transactions: [],
        errors: [{ row: 0, message: 'PDF is password-protected. Enter the password and try again.', raw: '' }],
        warnings: [],
        bank: 'UNKNOWN',
      };
    }
    return {
      transactions: [],
      errors: [{ row: 0, message: `Failed to read PDF: ${msg}`, raw: '' }],
      warnings: [],
      bank: 'UNKNOWN',
    };
  } finally {
    await parser?.destroy();
  }

  const trimmedText = rawText.trim();
  if (trimmedText.length < 50) {
    return {
      transactions: [],
      errors: [{
        row: 0,
        message: 'PDF has no extractable text. Ensure the statement is a digital (non-scanned) PDF.',
        raw: '',
      }],
      warnings: [],
      bank: 'UNKNOWN',
    };
  }

  const bank = bankHint?.toUpperCase() ?? detectBankFromText(trimmedText);

  const transactions: ParsedTransaction[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [
    'PDF import is approximate — review transactions for accuracy. Re-importing the same file is safe (duplicates are skipped).',
  ];

  const lines = trimmedText.split('\n').map((l) => l.trim()).filter(Boolean);
  const rowState: RowState = { prevBalance: null, prevDate: null, ascending: detectStatementDateOrder(lines) };
  // Count date-matched rows that were subsequently abandoned (no terminator found, no
  // usable description, etc.) so the user gets one visible signal instead of a
  // plausible-looking but silently-incomplete import — see vision.md's "no dry-run/
  // bulk-undo" tech-debt note for why a silent partial import is the expensive failure
  // mode here.
  let droppedDatedRows = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try each date pattern at the start of the line
    let dateStr: string | null = null;
    let dateMatch: RegExpMatchArray | null = null;
    for (const pattern of PDF_DATE_PATTERNS) {
      dateMatch = line.match(pattern);
      if (dateMatch) { dateStr = dateMatch[1]; break; }
    }
    if (!dateStr || !dateMatch) continue;

    const date = parsePDFDate(dateStr);
    if (!date) continue;

    // Skip future dates (likely a header or footer artifact)
    if (date > new Date()) continue;

    // Text after the date
    const afterDate = line.slice(dateMatch[0].length).trim();

    // A dated statement-total/opening-closing-balance line is not a transaction
    // attempt — skip it like a future-date artifact (no drop-count increment, no
    // block-accumulator attempt). Checked before amount scanning because such a line
    // can carry two amount-shaped tokens ("TOTAL WITHDRAWALS 100000.00 TOTAL DEPOSITS
    // 200000.00"), which the wide-tier ">= 2 amounts" heuristic alone won't reject.
    if (SUMMARY_LINE_RE.test(afterDate)) continue;

    const scan = scanAmounts(afterDate);
    const sameLineNonZero = scan.tokens.filter((t) => t.value > 0);

    let description: string;
    let amounts: number[];

    // A lone WIDE-tier amount (no companion balance) is more likely a dated summary
    // line ("OPENING BALANCE 125000.00") than a real transaction — a genuine row in
    // every layout this parser targets always shows amount + running balance. Route
    // it through the block accumulator instead of accepting it outright; narrow-tier
    // single amounts are unaffected (that's normal, pre-existing behavior for
    // already-working layouts).
    const treatAsNoAmount = sameLineNonZero.length === 0
      || (scan.tier === 'wide' && sameLineNonZero.length < 2);

    if (treatAsNoAmount) {
      // Multi-line fallback (ICICI-style): date+payee is on this line, the amount and
      // running balance appear on a LATER line with no date. Only reachable here — a
      // layout whose amounts are already on the date line never enters this branch.
      // When a lone wide-tier amount is what routed us here (the summary-line guard
      // above), strip it out of the seed narration — if a real terminator happens to
      // be found further down, the summary line's own amount-shaped text must not leak
      // into an unrelated transaction's description.
      const firstLineRemainder = scan.tier === 'wide' && scan.tokens.length > 0
        ? afterDate.slice(0, scan.tokens[0].index).trim()
        : afterDate;
      const block = tryParseMultiLineBlock(lines, i, firstLineRemainder);
      if (!block || !block.description || block.description.length < 2) {
        droppedDatedRows++;
        rowState.prevBalance = null;
        rowState.prevDate = null;
        continue;
      }
      description = block.description;
      amounts = block.amounts;
      i = block.endIdx;
    } else {
      // Description boundary must match the FIRST amount-shaped token regardless of
      // its value — including a "0.00" placeholder — not just the first nonzero one.
      // `description` feeds makeImportHash(); splitting at a different point than a
      // prior import would silently break "safe to re-import the same file" dedup.
      const firstAmtPos = scan.tokens[0].index;
      const rawDescription = firstAmtPos > 0
        ? afterDate.slice(0, firstAmtPos)
        : afterDate;
      description = cleanDescription(rawDescription);
      amounts = sameLineNonZero.map((t) => t.value);

      // Need at least a non-empty description to form a valid transaction
      if (!description || description.length < 2) {
        droppedDatedRows++;
        rowState.prevBalance = null;
        rowState.prevDate = null;
        continue;
      }
    }

    const { type, amount } = resolveTransaction(description, amounts, date, rowState, warnings);

    /* c8 ignore next 6 -- amounts only ever contains val > 0, so amount <= 0 is structurally unreachable */
    if (amount <= 0) {
      droppedDatedRows++;
      rowState.prevBalance = null;
      rowState.prevDate = null;
      continue;
    }

    transactions.push({ date, description, remark: description, amount, type });

    // Track the running balance for the next row's delta reconciliation — only when
    // this row's last amount IS the balance (i.e. there were >= 2 amounts to begin with).
    if (amounts.length >= 2) {
      rowState.prevBalance = amounts[amounts.length - 1];
      rowState.prevDate = date;
    } else {
      rowState.prevBalance = null;
      rowState.prevDate = null;
    }
  }

  if (transactions.length === 0 && errors.length === 0) {
    errors.push({
      row: 0,
      message: 'No transactions found in PDF. The format may not be supported. Try exporting as CSV instead.',
      raw: '',
    });
  } else if (droppedDatedRows > 0) {
    warnings.push(
      `${droppedDatedRows} dated row${droppedDatedRows === 1 ? '' : 's'} could not be `
      + 'parsed and were skipped — check the original statement for anything missing.',
    );
  }

  return withInferredPaymentModes({ transactions, errors, warnings: transactions.length > 0 ? warnings : [], bank });
}

// ─── Import Hash ──────────────────────────────────────────────────────────────

/**
 * Compute a deterministic deduplication hash for an imported transaction.
 *
 * @param scopeId - bankAccountId when an account is linked; userId otherwise.
 *                  Using userId (instead of null) ensures deduplication works even
 *                  when the user imports the same file without linking an account.
 */
export function makeImportHash(date: Date, amount: number, type: string, description: string, scopeId: string): string {
  const raw = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${type}|${description.trim().toLowerCase()}|${scopeId}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}
