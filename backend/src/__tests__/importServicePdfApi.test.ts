/**
 * Covers parsePDF's pdf-parse version-compatibility shim.
 *
 * importService supports both pdf-parse majors:
 *   v2 — exports a `PDFParse` class    → `new PDFParse({data}).getText()`
 *   v1 — exports a callable default    → `pdfParse(buffer, opts)`
 *
 * `importService.test.ts` pins the v1 shape for its whole file (vi.mock is hoisted and
 * file-scoped), so the v2 arm can only be reached from a separate file. Here we use
 * vi.resetModules() + vi.doMock() — which, unlike vi.mock, is NOT hoisted — so each test
 * can install a different pdf-parse shape and re-import the service against it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const STATEMENT_TEXT = [
  'HDFC Bank Statement of Account',
  'Date         Narration              Chq/Ref    Value Dt  Withdrawal  Deposit    Balance',
  '01/04/25     NEFT CR-SALARY-CORP    REF001     01/04/25              80,000.00  2,00,000.00',
].join('\n');

/** Install a pdf-parse mock shape, then import parsePDF bound to it. */
async function loadParsePDF(pdfParseExports: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('pdf-parse', () => pdfParseExports);
  const mod = await import('../services/importService');
  return mod.parsePDF;
}

afterEach(() => {
  vi.doUnmock('pdf-parse');
  vi.resetModules();
});

describe('parsePDF — pdf-parse v2 (PDFParse class export)', () => {
  it('constructs PDFParse with the buffer and reads text through getText()', async () => {
    const getText = vi.fn().mockResolvedValue({ text: STATEMENT_TEXT });
    const destroy = vi.fn().mockResolvedValue(undefined);
    const ctor = vi.fn();
    class PDFParse {
      constructor(opts: unknown) { ctor(opts); }
      getText = getText;
      destroy = destroy;
    }

    const parsePDF = await loadParsePDF({ PDFParse });
    const result = await parsePDF(Buffer.from('fake-pdf'), 'HDFC');

    expect(ctor).toHaveBeenCalledTimes(1);
    const opts = ctor.mock.calls[0][0] as { data: Uint8Array; password?: string };
    expect(opts.data).toBeInstanceOf(Uint8Array);
    expect(getText).toHaveBeenCalledTimes(1);
    expect(result.bank).toBe('HDFC');
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ amount: 80000, type: 'INCOME' });
  });

  it('forwards the password through to the PDFParse constructor', async () => {
    const ctor = vi.fn();
    class PDFParse {
      constructor(opts: unknown) { ctor(opts); }
      getText = vi.fn().mockResolvedValue({ text: STATEMENT_TEXT });
      destroy = vi.fn().mockResolvedValue(undefined);
    }

    const parsePDF = await loadParsePDF({ PDFParse });
    await parsePDF(Buffer.from('fake-pdf'), 'HDFC', 'hunter2');

    expect((ctor.mock.calls[0][0] as { password?: string }).password).toBe('hunter2');
  });

  it('always destroys the parser, including when getText rejects', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    class PDFParse {
      getText = vi.fn().mockRejectedValue(new Error('corrupt xref table'));
      destroy = destroy;
    }

    const parsePDF = await loadParsePDF({ PDFParse });
    const result = await parsePDF(Buffer.from('fake-pdf'));

    expect(destroy).toHaveBeenCalledTimes(1); // finally-block cleanup
    expect(result.errors[0].message).toMatch(/Failed to read PDF: corrupt xref table/);
  });

  it('reports a password-protected PDF as an actionable error', async () => {
    class PDFParse {
      getText = vi.fn().mockRejectedValue(new Error('No password given (encrypted)'));
      destroy = vi.fn().mockResolvedValue(undefined);
    }

    const parsePDF = await loadParsePDF({ PDFParse });
    const result = await parsePDF(Buffer.from('fake-pdf'));

    expect(result.errors[0].message).toMatch(/password-protected/i);
    expect(result.bank).toBe('UNKNOWN');
  });
});

describe('parsePDF — v1 module shape without a default export', () => {
  it('falls back to the module namespace itself when `default` is undefined', async () => {
    // `default` is present-but-undefined, so the `?? pdfParseModule` fallback is taken.
    // The namespace object is not callable, so the attempt fails and is reported.
    const parsePDF = await loadParsePDF({ default: undefined });
    const result = await parsePDF(Buffer.from('fake-pdf'));

    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/Failed to read PDF/i);
    expect(result.bank).toBe('UNKNOWN');
  });
});
