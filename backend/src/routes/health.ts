import { Router } from 'express';
import prisma from '../config/prisma';

const router = Router();

router.get('/', async (_req, res) => {
  let dbStatus = 'connected';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'disconnected';
  }

  res.json({
    success: true,
    data: {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      db: dbStatus,
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? '1.0.0',
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
