import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { isTest } from '../config/env';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'RECONCILE' | 'RESET_PASSWORD' | 'GENERATE';

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function recordAuditLog(input: {
  performedByUserId: string;
  action: AuditAction | string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  if (isTest) return null;
  if (!prisma.auditLog?.create) return null;
  return prisma.auditLog.create({
    data: {
      performedByUserId: input.performedByUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValueJson: toJsonValue(input.oldValue),
      newValueJson: toJsonValue(input.newValue),
    },
  });
}
