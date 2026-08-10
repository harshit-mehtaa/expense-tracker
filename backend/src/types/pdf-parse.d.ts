declare module 'pdf-parse' {
  class PDFParse {
    constructor(options: { data: Uint8Array; password?: string });
    getText(): Promise<{ text: string }>;
    destroy(): Promise<void>;
  }

  interface PDFInfo {
    PDFFormatVersion?: string;
    IsAcroFormPresent?: boolean;
    IsXFAPresent?: boolean;
    [key: string]: unknown;
  }

  interface PDFMetadata {
    [key: string]: unknown;
  }

  interface PDFData {
    numpages: number;
    numrender: number;
    info: PDFInfo;
    metadata: PDFMetadata;
    text: string;
    version: string;
  }

  interface PDFOptions {
    /** Password for encrypted PDFs */
    password?: string;
    /** Max number of pages to parse (0 = all) */
    max?: number;
    version?: string;
    pagerender?: (pageData: unknown) => Promise<string>;
  }

  function pdfParse(dataBuffer: Buffer, options?: PDFOptions): Promise<PDFData>;

  export { PDFParse };
  export default pdfParse;
}
