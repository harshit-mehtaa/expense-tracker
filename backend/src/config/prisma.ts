import { PrismaClient } from '@prisma/client';
import { isDev } from './env';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: isDev ? ['query', 'error', 'warn'] : ['error'],
  });

if (isDev) globalForPrisma.prisma = prisma;

export default prisma;
