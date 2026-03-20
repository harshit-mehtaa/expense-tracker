/**
 * Cursor-based pagination utilities.
 * Cursor is always on the `id` field (CUID — guaranteed unique).
 * For date-ordered results, sort by (date DESC, id DESC) to ensure
 * stable ordering even when multiple records share the same timestamp.
 */

export interface PaginationParams {
  cursor?: string;
  limit?: number;
  sort?: string; // e.g., "date:desc", "amount:asc"
}

export interface PrismaFindManyArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
  orderBy: Record<string, 'asc' | 'desc'>[];
}

export interface PaginationMeta {
  total: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parses pagination parameters and returns Prisma-compatible findMany args.
 */
export function buildPaginationArgs(params: PaginationParams): PrismaFindManyArgs {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const [sortField = 'date', sortDir = 'desc'] = (params.sort ?? 'date:desc').split(':');

  const orderBy: Record<string, 'asc' | 'desc'>[] = [
    { [sortField]: sortDir as 'asc' | 'desc' },
    { id: 'desc' }, // Secondary sort by id for stable ordering
  ];

  const args: PrismaFindManyArgs = {
    take: limit + 1, // Fetch one extra to determine if there's a next page
    orderBy,
  };

  if (params.cursor) {
    args.cursor = { id: params.cursor };
    args.skip = 1; // Skip the cursor record itself
  }

  return args;
}

/**
 * Processes the result from a paginated Prisma query.
 * Takes N+1 results, trims to N, and returns pagination metadata.
 */
export function processPaginationResult<T extends { id: string }>(
  items: T[],
  limit: number,
  total: number,
): { items: T[]; meta: PaginationMeta } {
  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1]?.id : undefined;

  return {
    items: trimmed,
    meta: {
      total,
      limit,
      hasMore,
      nextCursor,
    },
  };
}
