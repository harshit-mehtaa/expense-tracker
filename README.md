# Family Finance Tracker — India Edition

A production-grade, Docker-based, locally-hosted Family Finance Management System designed for Indian families. Deployable with `docker compose up` on any local machine or home server.

---

## Features

- **Indian Numbering System** — All amounts displayed as ₹1,23,456 (lakhs/crores), never ₹1,234,567
- **Indian Financial Year** — All reports and dashboards default to April 1 – March 31 FY
- **Tax Centre** — 80C/80D tracker, HRA calculator, advance tax calendar, Old vs New Regime comparison
- **Bank Statement Import** — CSV import for HDFC, SBI, ICICI, Axis, Kotak with duplicate detection
- **FD/RD Management** — Fixed and Recurring Deposits with maturity calculators
- **SIP Tracker** — Mutual Fund SIPs with XIRR calculation
- **Foreign Equity** — Track US/UK stocks with live INR conversion
- **Loan Amortization** — Full schedule with prepayment simulator
- **Insurance Calendar** — Premium dues with 80C/80D eligibility badges
- **Role-based access** — Admin sees all family data; Members see only their own
- **Dark mode** — Toggle in the header
- **Fully containerized** — PostgreSQL + Express API + React + Nginx, all in Docker Compose

---

## Quick Start

### Prerequisites
- Docker Desktop (or Docker + Docker Compose v2)
- 2 GB RAM available for containers

### 1. Clone and configure

```bash
git clone <your-repo-url>
cd family-finance

cp .env.example .env
# Edit .env and set strong values for:
# - POSTGRES_PASSWORD
# - JWT_SECRET        (generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
# - JWT_REFRESH_SECRET (generate another random 64-byte hex)
```

### 2. Start the application

```bash
make start
# Or: docker compose up -d
```

The app will be available at **http://localhost** in about 30 seconds.

### 3. First login

| Field | Value |
|-------|-------|
| Email | `admin@family.local` |
| Password | `Admin@1234` |

> ⚠️ You will be prompted to change your password on first login.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_DB` | ✅ | PostgreSQL database name |
| `POSTGRES_USER` | ✅ | PostgreSQL username |
| `POSTGRES_PASSWORD` | ✅ | PostgreSQL password (use a strong random value) |
| `DATABASE_URL` | ✅ | Prisma connection URL (constructed from above values) |
| `JWT_SECRET` | ✅ | 64-byte hex secret for access tokens (15 min) |
| `JWT_REFRESH_SECRET` | ✅ | 64-byte hex secret for refresh tokens (7 days) |
| `NODE_ENV` | ✅ | `development` or `production` |
| `PORT` | — | Backend port (default: 3000) |
| `FRONTEND_URL` | ✅ | Full URL of the frontend (for CORS) |
| `COOKIE_DOMAIN` | ✅ | Cookie domain (e.g., `localhost` for local dev) |
| `VITE_API_URL` | ✅ | API base URL used by the frontend |

---

## Make Commands

```bash
make start          # Start all containers
make stop           # Stop all containers
make restart        # Stop and restart
make build          # Rebuild all images (no cache)
make reset-db       # ⚠️  Wipe database and restart (confirmation required)
make seed           # Re-run seed script (safe — skips if admin already exists)
make migrate        # Run pending Prisma migrations
make backup-db      # Backup database to backups/backup_TIMESTAMP.sql
make restore-db FILE=backups/backup_xxx.sql  # Restore from backup
make logs           # Tail all container logs
make logs-backend   # Tail backend logs only
make shell-backend  # Open shell in backend container
make shell-db       # Open psql in database container
make start-prod     # Start in production mode
make build-prod     # Build production images
```

---

## Bank Statement Import Guide

The app supports CSV imports from the following banks. Export your statement from net banking as CSV and upload it in **Transactions → Import**.

| Bank | Export Format | Notes |
|------|---------------|-------|
| **HDFC Bank** | Statement (CSV) from Net Banking | Date format: DD/MM/YY; skips 17-line header |
| **SBI** | Account Statement (CSV) | Date format: DD-Mon-YYYY; uses Dr/Cr suffix |
| **ICICI Bank** | Account Statement (CSV) | Standard format |
| **Axis Bank** | Statement (Excel/CSV) | Standard format |
| **Kotak Bank** | Account Statement (CSV) | Date format: DD-MM-YYYY |

**Duplicate detection:** Transactions are deduplicated using a SHA-256 hash of (date + amount + description + account). Re-importing the same file is safe.

---

## Backup & Restore

### Backup

```bash
make backup-db
# Creates: backups/backup_YYYYMMDD_HHMMSS.sql
```

For automated backups, add to cron:
```
0 2 * * * cd /path/to/family-finance && make backup-db >> /var/log/ff-backup.log 2>&1
```

### Restore

```bash
make restore-db FILE=backups/backup_20240401_020000.sql
```

### Migrating to a new machine

1. Run `make backup-db` on the old machine
2. Copy the backup file and `.env` to the new machine
3. Run `docker compose up -d db` on the new machine (start only the database)
4. Run `make restore-db FILE=<backup>`
5. Run `make start`

---

## Production Deployment

```bash
# Edit .env: set NODE_ENV=production and strong secrets
make build-prod
make start-prod
```

The production compose file (`docker-compose.prod.yml`) enables:
- `NODE_ENV=production` (no stack traces in errors)
- `SameSite=Strict` cookies
- Nginx SSL configuration (place certificates in `nginx/ssl/`)

For HTTPS with Let's Encrypt, add a `certbot` sidecar service to `docker-compose.prod.yml`.

---

## Architecture

```
nginx:80
  ├── /api/*  → backend:3000 (Node.js + Express + TypeScript)
  │              ├── Prisma ORM → PostgreSQL 16
  │              └── uploads/ (Docker volume)
  └── /*      → frontend:5173 (React 18 + Vite + Tailwind)
```

- **Schema-first**: Prisma schema is the single source of truth — all TypeScript types derive from it
- **FY-aware**: All date queries use IST-adjusted UTC boundaries via `financialYear.ts`
- **Soft deletes**: Transactions and accounts are never hard-deleted (`deletedAt` column)
- **Security**: bcrypt (cost 12), JWT HS256, HttpOnly cookies, Helmet, rate limiting, Zod validation

---

## Development

```bash
# Start in dev mode (hot-reload for both frontend and backend)
make start

# View logs
make logs

# Run backend tests
docker compose exec backend npm test

# Access database directly
make shell-db
```

---

## Default Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@family.local` | `Admin@1234` |

> Change the admin password immediately after first login.
