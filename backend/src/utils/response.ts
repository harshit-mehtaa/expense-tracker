import { Response } from 'express';
import { PaginationMeta } from './pagination';

/**
 * Consistent API response helpers.
 * All responses follow the envelope: { success, data, message, pagination? }
 */

export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string,
  statusCode: number = 200,
): void {
  res.status(statusCode).json({
    success: true,
    data,
    message,
  });
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  meta: PaginationMeta,
  message?: string,
): void {
  res.status(200).json({
    success: true,
    data: items,
    message,
    pagination: meta,
  });
}

export function sendCreated<T>(res: Response, data: T, message?: string): void {
  sendSuccess(res, data, message, 201);
}

export function sendNoContent(res: Response): void {
  res.status(204).send();
}
