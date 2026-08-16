/**
 * Sanitize a user-supplied filename before it is persisted.
 *
 * This is a stored-XSS mitigation, not a cosmetic tidy-up. The result is written to
 * `document.fileName`, which IS rendered back in the document list — an unsanitized
 * `<img src=x onerror=...>.csv` would execute on whoever views it. It is also written to
 * `bankStatementImport.filename`, which has no read endpoint today but is captured into
 * audit-log payloads.
 *
 * Three independent jobs, in order:
 *   1. Replace HTML/path metacharacters `< > " ' / \` with `_` — kills tag injection
 *      and path traversal in one pass.
 *   2. Strip C0 control characters (including NUL, which can truncate a path in
 *      C-based syscalls).
 *   3. Cap at 200 chars so the value always fits its column and can't be used to
 *      blow up a filesystem path.
 *
 * Note this deliberately does NOT touch `..` sequences on their own — dots are legal in
 * filenames, and traversal is already dead once `/` and `\` are replaced.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[<>"'/\\]/g, '_').replace(/[\x00-\x1f]/g, '').slice(0, 200);
}
