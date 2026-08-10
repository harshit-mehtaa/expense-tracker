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

Setting up on a new machine takes about 10 minutes, most of which is Docker building
images. Everything runs in containers — no Node, npm, or PostgreSQL needed on the host.

### Prerequisites
- **Docker Desktop** (or Docker Engine + Compose v2) — running before you start
- **git**
- 2 GB RAM available for containers, ~3 GB disk for images
- An internet connection for the first build

No registry login is required. The base images (`ghcr.io/harshit-mehtaa/node:20-alpine`,
`ghcr.io/harshit-mehtaa/nginx:alpine`) are public, as are `postgres:16-alpine` and
`nginx:alpine` from Docker Hub.

### 1. Clone

```bash
git clone git@github.com:harshit-mehtaa/expense-tracker.git
cd expense-tracker
```

Use `https://github.com/harshit-mehtaa/expense-tracker.git` if the machine has no SSH key.

### 2. Create .env

`.env` is gitignored and never leaves the original machine, so it must be created here.

```bash
cp .env.example .env
```

Generate two independent secrets:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # JWT_REFRESH_SECRET
```

No Node on the host? Use `openssl rand -hex 64`, or
`docker run --rm ghcr.io/harshit-mehtaa/node:20-alpine node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.

Then fill in `.env`. A complete working local configuration:

```ini
POSTGRES_DB=familyfinance
POSTGRES_USER=familyfinance
POSTGRES_PASSWORD=<pick a strong password>

# Host must be `db` — that is the Compose service name, not localhost.
# The password here must match POSTGRES_PASSWORD above.
DATABASE_URL=postgresql://familyfinance:<same password>@db:5432/familyfinance

JWT_SECRET=<first generated hex>
JWT_REFRESH_SECRET=<second generated hex>

NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:8080
COOKIE_DOMAIN=localhost
VITE_API_URL=http://localhost:8080/api
```

The two most common mistakes are pointing `DATABASE_URL` at `localhost` instead of `db`,
and letting its password drift out of sync with `POSTGRES_PASSWORD`.

### 3. Start

```bash
make start
```

The first run builds both images and takes several minutes; later runs take ~15 seconds.
Compose builds automatically, so a separate `make build` is not needed.

Startup order is enforced: Postgres becomes healthy, then a one-shot `migrate` container
generates the Prisma client, applies all migrations, and seeds — then the backend starts.

### 4. Verify

```bash
curl http://localhost:8080/api/health
```

Expect `{"success":true,"data":{"status":"ok","db":"connected",...}}`. If you get
`"db":"connected"`, the whole chain is working.

```bash
docker compose ps -a
```

`db`, `backend`, `frontend`, and `nginx` should be `Up`; `migrate` should be `Exited (0)`.
`migrate` exiting non-zero is the failure to investigate — check `docker compose logs migrate`.

### 5. First login

Open **http://localhost:8080**.

| Field | Value |
|-------|-------|
| Email | `harshit@mehta.local` |
| Password | `Admin@1234` |

> ⚠️ Change the admin password immediately after first login.

The seed creates one family ("Mehta Family"), this single ADMIN user, and the shared
category tree (Salary, Dividend, Groceries, Subscriptions with Netflix / Amazon Prime /
Google beneath it, and so on). It creates **no financial data** — no accounts,
transactions, or investments. Re-running the seed is safe; it upserts.

### 6. Set up your accounts

The app is empty until you add a bank account — most pages depend on one existing, and
transactions cannot be created without it.

1. **Accounts → Add Account.** Only *Bank Name* and *Account Type* are required.
   Account number, IFSC, balance, and UPI ID are optional and can be filled in later.
   Types available: `SAVINGS`, `CURRENT`, `SALARY`, `CREDIT_CARD`, `DEBIT_CARD`,
   `PREPAID_CARD`, `NRE`, `NRO`, `PPF`, `EPF`, `DEMAT`.
   For `CREDIT_CARD`, also set the credit limit and billing cycle so statement
   and due-date tracking work.
2. **Add family members** (optional) under Settings — as ADMIN you see all members'
   data; each MEMBER sees only their own.
3. **Review categories.** The seeded tree is a starting point; add or rename under
   Categories. Categories are shared across the family.
4. **Add transactions** — manually, or via **Transactions → Import** for a CSV or PDF
   bank statement. Import auto-detects the bank and de-duplicates on re-import, so
   importing the same statement twice is safe.
5. **Investments, Loans, Insurance** are independent — fill them in as needed.

### Day-to-day commands

| Command | Purpose |
|---------|---------|
| `make start` / `make stop` | Start / stop the stack |
| `make restart` | Recreate containers (also re-runs migrations + seed) |
| `make logs` / `make logs-backend` | Follow logs |
| `make migrate` | Create a new migration after editing `schema.prisma` |
| `make generate` | Regenerate the Prisma client after a schema edit while running |
| `make seed` | Re-run the seed |
| `make backup-db` | Dump the database to `backups/` (gitignored) |
| `make reset-db` | **Destroys all data** and starts clean |
| `make build` | Rebuild images from scratch (after dependency changes) |

### Moving data between machines

Data lives in the `postgres_data` Docker volume, not in the repo — a clone starts empty.
To carry data across:

```bash
make backup-db                                  # on the source machine
# copy backups/backup_<timestamp>.sql to the new machine, then:
make restore-db FILE=backups/backup_<timestamp>.sql
```

`backups/` is gitignored deliberately: those dumps contain real financial records and
must never be committed.

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
| Admin | `harshit@mehta.local` | `Admin@1234` |

> Change the admin password immediately after first login.
