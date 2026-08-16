import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  FRONTEND_URL: z.string().default('http://localhost'),
  COOKIE_DOMAIN: z.string().default('localhost'),
  // Injectable so tests can point at a writable temp dir. multer({ dest }) calls
  // mkdirp.sync at CONSTRUCTION time, and multer is externalized CJS so vi.mock('fs')
  // cannot intercept it — a hardcoded '/app/uploads' makes any module that constructs
  // multer unimportable in tests (EROFS/ENOENT). Docker creates /app/uploads (Dockerfile).
  // .min(1) matters: .default() only fires on undefined, so a bare `UPLOADS_DIR=` in
  // .env would yield '' and surface as an unreadable ENOENT from mkdirSync at import
  // time instead of the readable zod error every other var gets.
  // MUST match the uploads_data volume mount in docker-compose, or files vanish on down.
  UPLOADS_DIR: z.string().min(1, 'UPLOADS_DIR must not be empty').default('/app/uploads'),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  /* c8 ignore start -- process.exit branch cannot be unit-tested without module reload */
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    result.error.issues.forEach((issue) => {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }
  /* c8 ignore stop */
  return result.data;
}

export const env = parseEnv();

export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
