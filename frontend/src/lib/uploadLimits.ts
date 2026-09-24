/**
 * Upload size limits, mirrored from the backend — the source of truth is multer's
 * `fileSize` in backend/src/routes/import.ts and backend/src/routes/documents.ts
 * (uploadLimits.test.ts fails if these drift). shared/ can't hold runtime values:
 * the Docker build contexts are ./backend and ./frontend.
 *
 * Checked in the browser so an oversized file never starts uploading. nginx rejects
 * bodies over its own cap early, and a browser can report that as a connection reset
 * instead of the 413 — the server-side messages alone are not reliable for this case.
 */
export const MAX_STATEMENT_BYTES = 15 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Error text for a file over `maxBytes`, or null if it fits (the limit is inclusive). */
export function fileTooLargeMessage(file: Pick<File, 'size'>, maxBytes: number): string | null {
  if (file.size <= maxBytes) return null;
  return `File too large — the limit is ${maxBytes / (1024 * 1024)} MB`;
}
