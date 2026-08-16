// Test setup — runs before each test file
import os from 'os';
import path from 'path';

// Set test environment variables before importing anything that reads env
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.COOKIE_DOMAIN = 'localhost';
// Writable temp dir: multer({ dest }) mkdirs at construction time and cannot be
// intercepted by vi.mock('fs'), so the default '/app/uploads' would make every module
// that constructs multer throw EROFS/ENOENT on import.
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'expense-tracker-test-uploads');
