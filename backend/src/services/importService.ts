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
    const date = new Date(`${match[1]} ${match[2]} ${match[3]}`);
    return isNaN(date.getTime()) ? null : date;
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
      const date = new Date(dateStr.replace(/-/g, ' '));
      if (isNaN(date.getTime())) {
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
  // DD-MM-YYYY
  m = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    const d = new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    return isNaN(d.getTime()) ? null : d;
  }
  // DD MMM YYYY or DD-MMM-YYYY
  m = dateStr.match(/^(\d{2})[\s-]([A-Za-z]{3})[\s-](\d{4})$/);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]} ${m[3]}`);
    return isNaN(d.getTime()) ? null : d;
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

function inferTransactionType(
  description: string,
  amounts: number[],
): 'INCOME' | 'EXPENSE' {
  if (INCOME_KEYWORD_RE.test(description)) return 'INCOME';
  if (EXPENSE_KEYWORD_RE.test(description)) return 'EXPENSE';
  // Heuristic: if 3+ amounts (withdrawal, deposit, balance), use positional inference:
  // In HDFC/SBI-style: amounts[-3]=withdrawal, amounts[-2]=deposit, amounts[-1]=balance
  // If withdrawal > 0 and deposit === 0 → EXPENSE; reverse → INCOME
  if (amounts.length >= 3) {
    const withdrawal = amounts[amounts.length - 3];
    const deposit = amounts[amounts.length - 2];
    /* c8 ignore next 2 -- extractAmounts only pushes val>0, so withdrawal/deposit are always >0 here; these true branches are unreachable */
    if (deposit > 0 && withdrawal === 0) return 'INCOME';
    if (withdrawal > 0 && deposit === 0) return 'EXPENSE';
  }
  // Default to EXPENSE — conservative, user can correct
  return 'EXPENSE';
}

function cleanDescription(raw: string): string {
  return raw
    .replace(/\s{2,}/g, ' ')  // collapse multiple spaces
    .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '') // strip control chars
    .trim();
}

function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  const re = /\b(\d{1,3}(?:,\d{2,3})*\.\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (val > 0) amounts.push(val);
  }
  return amounts;
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
    const amounts = extractAmounts(afterDate);
    if (amounts.length === 0) continue;

    // Description: everything before the first amount in afterDate
    const firstAmtPos = afterDate.search(/\b\d{1,3}(?:,\d{2,3})*\.\d{2}\b/);
    const rawDescription = firstAmtPos > 0
      ? afterDate.slice(0, firstAmtPos)
      : afterDate;
    const description = cleanDescription(rawDescription);

    // Need at least a non-empty description to form a valid transaction
    if (!description || description.length < 2) continue;

    const type = inferTransactionType(description, amounts);

    // Transaction amount: last amount before balance (second-to-last if >= 2 amounts)
    // For 3+ amounts: [withdrawal/deposit, deposit/withdrawal, balance] → use second-to-last
    // For 2 amounts: [amount, balance] → use first
    // For 1 amount: use it directly
    let amount: number;
    if (amounts.length >= 3) {
      // Use positional heuristic: expense uses amounts[-3], income uses amounts[-2]
      amount = type === 'EXPENSE' ? amounts[amounts.length - 3] : amounts[amounts.length - 2];
      // If heuristic gives 0 (empty column), fall back to first amount
      /* c8 ignore next -- extractAmounts only pushes val > 0, so amount is never 0 here */
      if (amount === 0) amount = amounts[0];
    } else {
      amount = amounts[0];
    }

    /* c8 ignore next -- extractAmounts only pushes val > 0, so amount <= 0 is structurally unreachable */
    if (amount <= 0) continue;

    transactions.push({ date, description, remark: description, amount, type });
  }

  if (transactions.length === 0 && errors.length === 0) {
    errors.push({
      row: 0,
      message: 'No transactions found in PDF. The format may not be supported. Try exporting as CSV instead.',
      raw: '',
    });
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
