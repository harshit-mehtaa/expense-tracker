/**
 * singleFileUpload: classify errors raised while multer reads a multipart body by
 * ORIGIN, not message text. Client problems (malformed/truncated multipart, aborted
 * or reset connections) are 400 UPLOAD_REJECTED; our own disk/stream failures stay
 * errors that reach errorHandler as a logged 500.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Multer } from 'multer';
import { AppError } from '../utils/AppError';
import { classifyUploadError, isMulterError, singleFileUpload } from '../middleware/upload';

const multerShaped = () => Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
const withCode = (message: string, code: string, syscall?: string) =>
  Object.assign(new Error(message), { code, ...(syscall ? { syscall } : {}) });

describe('classifyUploadError', () => {
  it('passes an AppError (fileFilter rejection) through unchanged', () => {
    const err = AppError.badRequest('Only CSV or PDF files are allowed');
    expect(classifyUploadError(err)).toBe(err);
  });

  it('passes a MulterError through unchanged (errorHandler maps it to 413/400)', () => {
    const err = multerShaped();
    expect(classifyUploadError(err)).toBe(err);
  });

  it.each([
    ['Multipart: Boundary not found'],
    ['Unexpected end of form'],
    ['Malformed part header'],
    ['Request aborted'],
    ['Request closed'],
  ])('maps busboy/request error "%s" to 400 UPLOAD_REJECTED', (message) => {
    const out = classifyUploadError(new Error(message));
    expect(out).toBeInstanceOf(AppError);
    expect(out).toMatchObject({ statusCode: 400, code: 'UPLOAD_REJECTED', message: 'Upload was malformed or incomplete' });
  });

  it.each(['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'])(
    'maps client stream code %s to 400 even if a syscall is attached',
    (code) => {
      expect(classifyUploadError(withCode('x', code, 'read'))).toMatchObject({ statusCode: 400, code: 'UPLOAD_REJECTED' });
    },
  );

  it.each([['ENOSPC', 'write'], ['EACCES', 'open'], ['EROFS', 'open']])(
    'keeps our own I/O failure %s (syscall %s) as-is → 500',
    (code, syscall) => {
      const err = withCode('disk trouble', code, syscall);
      expect(classifyUploadError(err)).toBe(err);
    },
  );

  it.each([
    ['TypeError', new TypeError('cannot read x of undefined')],
    ['ReferenceError', new ReferenceError('y is not defined')],
    ['RangeError', new RangeError('bad length')],
  ])('keeps a programmer error (%s) as-is → logged 500, never blamed on the client', (_label, err) => {
    expect(classifyUploadError(err)).toBe(err);
  });

  it.each([['a string', 'boom'], ['null', null]])('treats %s as a client error', (_label, value) => {
    expect(classifyUploadError(value)).toMatchObject({ statusCode: 400, code: 'UPLOAD_REJECTED' });
  });
});

describe('isMulterError', () => {
  it('requires both the name and a string code', () => {
    expect(isMulterError(multerShaped())).toBe(true);
    expect(isMulterError(Object.assign(new Error('x'), { name: 'MulterError' }))).toBe(false);
    expect(isMulterError({ name: 'MulterError', code: 'LIMIT_FILE_SIZE' })).toBe(false);
  });
});

describe('singleFileUpload', () => {
  const fakeUpload = (err?: unknown) => {
    const single = vi.fn(() => (_req: unknown, _res: unknown, cb: (e?: unknown) => void) => cb(err));
    return { upload: { single } as unknown as Multer, single };
  };

  it('delegates to upload.single(field) and calls next() on success', () => {
    const { upload, single } = fakeUpload();
    const next = vi.fn();
    singleFileUpload(upload, 'file')({} as never, {} as never, next);
    expect(single).toHaveBeenCalledWith('file');
    expect(next).toHaveBeenCalledWith();
  });

  it('classifies an error before handing it to next()', () => {
    const { upload } = fakeUpload(new Error('Unexpected end of form'));
    const next = vi.fn();
    singleFileUpload(upload, 'file')({} as never, {} as never, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400, code: 'UPLOAD_REJECTED' });
  });
});
