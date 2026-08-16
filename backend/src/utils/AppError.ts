/**
 * Typed application error class.
 *
 * isOperational = true  → Known, expected error (4xx). Safe to return message to client.
 * isOperational = false → Programmer error (5xx). Return generic message; log full details.
 *
 * Defaults to `statusCode < 500`, which is the right call almost always: an unexpected
 * 5xx must not leak internals to the client. The override exists for the narrow case of a
 * server-side failure whose *cause* is internal but whose *consequence* the user needs
 * stated — e.g. "the import failed and nothing was saved", where withholding the message
 * leaves the user unable to tell whether a retry would duplicate data. Only pass an
 * explicit `true` for a message you have written by hand and confirmed leaks nothing.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;

  constructor(message: string, statusCode: number = 500, code?: string, isOperational?: boolean) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational ?? statusCode < 500;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, code?: string): AppError {
    return new AppError(message, 400, code);
  }

  static unauthorized(message: string = 'Unauthorized'): AppError {
    return new AppError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message: string = 'Forbidden'): AppError {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(resource: string = 'Resource'): AppError {
    return new AppError(`${resource} not found`, 404, 'NOT_FOUND');
  }

  static conflict(message: string, code?: string): AppError {
    return new AppError(message, 409, code);
  }

  static validationError(message: string): AppError {
    return new AppError(message, 422, 'VALIDATION_ERROR');
  }

  static internal(message: string = 'Internal server error'): AppError {
    return new AppError(message, 500, 'INTERNAL_ERROR');
  }
}
