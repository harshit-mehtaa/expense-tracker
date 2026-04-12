import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

export async function getAllUsers() {
  return prisma.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      avatarUrl: true,
      colorTag: true,
      panNumberMasked: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { accounts: true, transactions: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'MEMBER';
  panNumberMasked?: string;
  colorTag?: string;
}) {
  const exists = await prisma.user.findUnique({ where: { email: data.email } });
  if (exists) throw AppError.conflict('Email already in use');

  const passwordHash = await bcrypt.hash(data.password, 12);
  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
      panNumberMasked: data.panNumberMasked,
      colorTag: data.colorTag,
      mustChangePassword: true,
    },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });
}

export async function updateUser(id: string, requesterId: string, data: {
  name?: string;
  email?: string;
  role?: 'ADMIN' | 'MEMBER';
  isActive?: boolean;
  colorTag?: string;
  panNumberMasked?: string;
}) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw AppError.notFound('User');
  if (id === requesterId && data.role !== undefined && data.role !== user.role) {
    throw AppError.badRequest('Cannot change your own role');
  }
  if (data.email && data.email !== user.email) {
    const conflict = await prisma.user.findUnique({ where: { email: data.email } });
    if (conflict) throw AppError.conflict('Email already in use');
  }
  return prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, isActive: true, updatedAt: true },
  });
}

export async function deleteUser(id: string, requestorId: string) {
  if (id === requestorId) throw AppError.badRequest('Cannot delete your own account');
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw AppError.notFound('User');
  // Revoke all active sessions so the deleted user is immediately locked out
  await prisma.refreshToken.deleteMany({ where: { userId: id } });
  // Soft delete
  return prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
}

export async function resetUserPassword(id: string, newPassword: string) {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw AppError.notFound('User');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  return prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
}

export async function getAuditLog(page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { performedBy: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLog.count(),
  ]);
  return { logs, total, page, limit };
}
