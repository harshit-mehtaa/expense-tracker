/**
 * Unit tests for the ImportModal auto-detect pure helpers.
 * These are module-level functions defined in Transactions.tsx —
 * tested here by duplicating the logic (the functions are not exported,
 * so we reproduce them to test independently without mounting the full component).
 *
 * If the implementation in Transactions.tsx changes, update these copies too.
 */
import { describe, it, expect } from 'vitest';

// ─── Inline copies of the helpers under test ─────────────────────────────────
// (identical to the module-level definitions in Transactions.tsx)

const AUTO_DETECT = '__auto__';

const BANK_FILENAME_KEYWORDS: Record<string, string> = {
  hdfc: 'HDFC', sbi: 'SBI', icici: 'ICICI', axis: 'AXIS', kotak: 'KOTAK',
};

const BANK_ACCOUNT_PATTERNS: Record<string, string[]> = {
  HDFC: ['hdfc'],
  SBI: ['sbi', 'state bank'],
  ICICI: ['icici'],
  AXIS: ['axis'],
  KOTAK: ['kotak'],
};

function detectBankFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const [kw, bank] of Object.entries(BANK_FILENAME_KEYWORDS)) {
    if (lower.includes(kw)) return bank;
  }
  return null;
}

interface AutoDetectResult { account: any | null; ambiguous: boolean }

function resolveAccountForBank(bankKey: string | null, accounts: any[]): AutoDetectResult {
  if (!bankKey || accounts.length === 0) return { account: null, ambiguous: false };
  const patterns = BANK_ACCOUNT_PATTERNS[bankKey.toUpperCase()] ?? [bankKey.toLowerCase()];
  const matches = accounts.filter((a: any) => {
    const name = a.bankName?.toLowerCase() ?? '';
    return patterns.some((p) => name.includes(p));
  });
  if (matches.length === 0) return { account: null, ambiguous: false };
  if (matches.length === 1) return { account: matches[0], ambiguous: false };
  return { account: null, ambiguous: true };
}

// ─── detectBankFromFilename ───────────────────────────────────────────────────

describe('detectBankFromFilename', () => {
  it('detects HDFC from filename', () => {
    expect(detectBankFromFilename('HDFC_Statement_Apr2025.csv')).toBe('HDFC');
  });

  it('detects SBI from filename (case-insensitive)', () => {
    expect(detectBankFromFilename('SBI_stmt.pdf')).toBe('SBI');
    expect(detectBankFromFilename('sbi_bank_statement.csv')).toBe('SBI');
  });

  it('detects ICICI from filename', () => {
    expect(detectBankFromFilename('icici-account-statement.pdf')).toBe('ICICI');
  });

  it('detects AXIS from filename', () => {
    expect(detectBankFromFilename('Axis_Bank_2025.csv')).toBe('AXIS');
  });

  it('detects KOTAK from filename', () => {
    expect(detectBankFromFilename('kotak_statement.csv')).toBe('KOTAK');
  });

  it('returns null when filename has no bank keyword', () => {
    expect(detectBankFromFilename('statement.csv')).toBeNull();
    expect(detectBankFromFilename('bank_export.pdf')).toBeNull();
    expect(detectBankFromFilename('2025-04-01.csv')).toBeNull();
  });

  it('returns null for empty filename', () => {
    expect(detectBankFromFilename('')).toBeNull();
  });

  it('detects bank keyword embedded in longer string', () => {
    expect(detectBankFromFilename('myhdfc_export.csv')).toBe('HDFC');
    expect(detectBankFromFilename('personal_sbi_2025.pdf')).toBe('SBI');
  });
});

// ─── resolveAccountForBank ────────────────────────────────────────────────────

const HDFC_ACCOUNT = { id: 'acc-hdfc-1', bankName: 'HDFC Bank', accountNumberLast4: '1234' };
const HDFC_ACCOUNT_2 = { id: 'acc-hdfc-2', bankName: 'HDFC Bank', accountNumberLast4: '5678' };
const SBI_ACCOUNT = { id: 'acc-sbi-1', bankName: 'State Bank of India', accountNumberLast4: '9012' };
const ICICI_ACCOUNT = { id: 'acc-icici-1', bankName: 'ICICI Bank', accountNumberLast4: '3456' };

describe('resolveAccountForBank', () => {
  it('returns the matching account when exactly one match', () => {
    const result = resolveAccountForBank('HDFC', [HDFC_ACCOUNT, SBI_ACCOUNT]);
    expect(result.account).toEqual(HDFC_ACCOUNT);
    expect(result.ambiguous).toBe(false);
  });

  it('returns null + ambiguous=true when multiple accounts match', () => {
    const result = resolveAccountForBank('HDFC', [HDFC_ACCOUNT, HDFC_ACCOUNT_2]);
    expect(result.account).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it('returns null + ambiguous=false when no account matches', () => {
    const result = resolveAccountForBank('AXIS', [HDFC_ACCOUNT, SBI_ACCOUNT]);
    expect(result.account).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('returns null + ambiguous=false for empty accounts list', () => {
    const result = resolveAccountForBank('HDFC', []);
    expect(result.account).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('returns null + ambiguous=false when bankKey is null', () => {
    const result = resolveAccountForBank(null, [HDFC_ACCOUNT]);
    expect(result.account).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('returns null + ambiguous=false when bankKey is empty string', () => {
    const result = resolveAccountForBank('', [HDFC_ACCOUNT]);
    expect(result.account).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('matches SBI via "state bank" pattern (official name "State Bank of India")', () => {
    const result = resolveAccountForBank('SBI', [HDFC_ACCOUNT, SBI_ACCOUNT]);
    expect(result.account).toEqual(SBI_ACCOUNT);
    expect(result.ambiguous).toBe(false);
  });

  it('matches case-insensitively — lowercase bank key works', () => {
    const result = resolveAccountForBank('hdfc', [HDFC_ACCOUNT, SBI_ACCOUNT]);
    expect(result.account).toEqual(HDFC_ACCOUNT);
    expect(result.ambiguous).toBe(false);
  });

  it('matches by substring — ICICI in "ICICI Bank"', () => {
    const result = resolveAccountForBank('ICICI', [ICICI_ACCOUNT, SBI_ACCOUNT]);
    expect(result.account).toEqual(ICICI_ACCOUNT);
  });

  it('single HDFC account with no ambiguity', () => {
    const result = resolveAccountForBank('HDFC', [HDFC_ACCOUNT]);
    expect(result.account).toEqual(HDFC_ACCOUNT);
    expect(result.ambiguous).toBe(false);
  });
});

// ─── deriveBankHintFromBankName ───────────────────────────────────────────────
// Inline copy of the helper from Transactions.tsx — update here if the implementation changes.

function deriveBankHintFromBankName(bankName: string | null | undefined): string | null {
  if (!bankName) return null;
  const lower = bankName.toLowerCase();
  for (const [key, patterns] of Object.entries(BANK_ACCOUNT_PATTERNS)) {
    if (patterns.some((p) => lower.includes(p))) return key;
  }
  return null;
}

describe('deriveBankHintFromBankName', () => {
  it('maps "HDFC Bank" → "HDFC"', () => {
    expect(deriveBankHintFromBankName('HDFC Bank')).toBe('HDFC');
  });

  it('maps "State Bank of India" → "SBI" (via "state bank" pattern)', () => {
    expect(deriveBankHintFromBankName('State Bank of India')).toBe('SBI');
  });

  it('maps "ICICI Bank" → "ICICI"', () => {
    expect(deriveBankHintFromBankName('ICICI Bank')).toBe('ICICI');
  });

  it('maps "Axis Bank" → "AXIS"', () => {
    expect(deriveBankHintFromBankName('Axis Bank')).toBe('AXIS');
  });

  it('maps "Kotak Mahindra Bank" → "KOTAK"', () => {
    expect(deriveBankHintFromBankName('Kotak Mahindra Bank')).toBe('KOTAK');
  });

  it('returns null for unrecognized bank name (e.g. "Yes Bank")', () => {
    expect(deriveBankHintFromBankName('Yes Bank')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(deriveBankHintFromBankName('hdfc bank')).toBe('HDFC');
    expect(deriveBankHintFromBankName('STATE BANK OF INDIA')).toBe('SBI');
  });

  it('returns null for null input', () => {
    expect(deriveBankHintFromBankName(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(deriveBankHintFromBankName(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(deriveBankHintFromBankName('')).toBeNull();
  });

  it('is symmetric with resolveAccountForBank — HDFC account resolves to HDFC hint', () => {
    const hdfcAccount = { id: 'acc-1', bankName: 'HDFC Bank', accountNumberLast4: '1234' };
    const hint = deriveBankHintFromBankName(hdfcAccount.bankName);
    const result = resolveAccountForBank(hint, [hdfcAccount]);
    expect(result.account).toEqual(hdfcAccount);
  });
});

// ─── resolvedBankHint priority chain ─────────────────────────────────────────
// Inline simulation of the priority logic in ImportModal — update if implementation changes.

function simulateResolvedBankHint(opts: {
  bankAccountId: string;
  accounts: any[];
  filenameBankHint: string | null;
  manualBankHint: string;
}): string | null {
  const { bankAccountId, accounts, filenameBankHint, manualBankHint } = opts;
  if (bankAccountId !== AUTO_DETECT && bankAccountId !== '') {
    const acc = accounts.find((a: any) => a.id === bankAccountId);
    return deriveBankHintFromBankName(acc?.bankName);
  }
  if (filenameBankHint) return filenameBankHint;
  if (bankAccountId === '') return manualBankHint || null;
  return null;
}

const HDFC_ACC = { id: 'acc-hdfc', bankName: 'HDFC Bank', accountNumberLast4: '1234' };
const SBI_ACC  = { id: 'acc-sbi',  bankName: 'State Bank of India', accountNumberLast4: '5678' };

describe('resolvedBankHint priority chain', () => {
  it('specific account selected → derives hint from account bankName', () => {
    const hint = simulateResolvedBankHint({
      bankAccountId: HDFC_ACC.id,
      accounts: [HDFC_ACC, SBI_ACC],
      filenameBankHint: null,
      manualBankHint: '',
    });
    expect(hint).toBe('HDFC');
  });

  it('specific account — SBI via "State Bank of India" bankName', () => {
    const hint = simulateResolvedBankHint({
      bankAccountId: SBI_ACC.id,
      accounts: [HDFC_ACC, SBI_ACC],
      filenameBankHint: null,
      manualBankHint: '',
    });
    expect(hint).toBe('SBI');
  });

  it('AUTO_DETECT + filename hit → sends filename bank hint to backend parser', () => {
    // AUTO_DETECT means "auto-detect which account to link", not "hide bank from parser".
    // The filename hint is still useful for the backend to pick the right column layout.
    const hint = simulateResolvedBankHint({
      bankAccountId: AUTO_DETECT,
      accounts: [HDFC_ACC],
      filenameBankHint: 'HDFC',
      manualBankHint: 'SBI',
    });
    expect(hint).toBe('HDFC');
  });

  it('AUTO_DETECT + no filename hit → null (backend fully auto-detects)', () => {
    const hint = simulateResolvedBankHint({
      bankAccountId: AUTO_DETECT,
      accounts: [HDFC_ACC],
      filenameBankHint: null,
      manualBankHint: '',
    });
    expect(hint).toBeNull();
  });

  it('"Don\'t link" + filename hit → uses filenameBankHint (not manualBankHint)', () => {
    const hint = simulateResolvedBankHint({
      bankAccountId: '',
      accounts: [],
      filenameBankHint: 'SBI',
      manualBankHint: 'HDFC',
    });
    expect(hint).toBe('SBI');
  });

  it('"Don\'t link" + no filename + manualBankHint set → uses manualBankHint', () => {
    const hint = simulateResolvedBankHint({
      bankAccountId: '',
      accounts: [],
      filenameBankHint: null,
      manualBankHint: 'AXIS',
    });
    expect(hint).toBe('AXIS');
  });

  it('"Don\'t link" + no filename + no manualBankHint → null', () => {
    const hint = simulateResolvedBankHint({
      bankAccountId: '',
      accounts: [],
      filenameBankHint: null,
      manualBankHint: '',
    });
    expect(hint).toBeNull();
  });

  it('specific account with unrecognized bankName → null (backend auto-detects)', () => {
    const jupiterAcc = { id: 'acc-j', bankName: 'Jupiter', accountNumberLast4: '0000' };
    const hint = simulateResolvedBankHint({
      bankAccountId: jupiterAcc.id,
      accounts: [jupiterAcc],
      filenameBankHint: 'HDFC',  // filename says HDFC but account wins
      manualBankHint: '',
    });
    expect(hint).toBeNull();
  });
});

// ─── AUTO_DETECT sentinel ─────────────────────────────────────────────────────

describe('AUTO_DETECT sentinel', () => {
  it('is the string __auto__', () => {
    expect(AUTO_DETECT).toBe('__auto__');
  });

  it('cannot collide with a cuid (cuids start with "c" and contain no underscores)', () => {
    // cuid v1 format: c + 24 alphanumeric chars (no underscores, no double-underscores)
    const exampleCuid = 'clhk8g9a20000356s5nqq4k5m';
    expect(AUTO_DETECT).not.toBe(exampleCuid);
    expect(exampleCuid.startsWith('__')).toBe(false);
  });
});
