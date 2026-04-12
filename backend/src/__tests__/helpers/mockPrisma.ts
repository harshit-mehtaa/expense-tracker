/**
 * Shared Prisma mock factory.
 * Routes use BOTH `import prisma from '../config/prisma'` (default)
 * and `import { prisma } from '../config/prisma'` (named).
 * The dual-export shape satisfies both.
 *
 * Usage in a test file:
 *   vi.mock('../../config/prisma', () => buildPrismaMock({ user: ['findUnique', 'findFirst'] }))
 */

type MethodList = string[];
type ModelMap = Record<string, MethodList>;

export function buildPrismaMock(models: ModelMap) {
  const prismaObj: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};

  // Always include $queryRaw for health checks
  (prismaObj as any)['$queryRaw'] = vi.fn().mockResolvedValue([{ 1: 1 }]);

  for (const [model, methods] of Object.entries(models)) {
    prismaObj[model] = {};
    for (const method of methods) {
      prismaObj[model][method] = vi.fn().mockResolvedValue(null);
    }
  }

  return { default: prismaObj, prisma: prismaObj };
}
