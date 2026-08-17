# Deployment Guide

Deploy on any machine with Docker installed. No repo clone needed — just create two files below.

---

## Step 1 — Create `docker-compose.deploy.yml`

Create a file called `docker-compose.deploy.yml` and paste this content:

```yaml
version: '3.9'

services:
  db:
    image: ghcr.io/harshit-mehtaa/postgres:16-alpine
    restart: unless-stopped
    env_file: .env
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  migrate:
    image: ghcr.io/harshit-mehtaa/expense-tracker-backend:latest
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    command: ["npx", "prisma", "migrate", "deploy"]
    restart: "no"

  backend:
    image: ghcr.io/harshit-mehtaa/expense-tracker-backend:latest
    restart: unless-stopped
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    volumes:
      - uploads_data:/app/uploads

  frontend:
    image: ghcr.io/harshit-mehtaa/expense-tracker-frontend:latest
    restart: unless-stopped

  # Frontend — serves static files and proxies /api/ to backend
  frontend:
    image: ghcr.io/harshit-mehtaa/expense-tracker-frontend:latest
    restart: unless-stopped
    ports:
      - "8080:80"
    depends_on:
      - backend

volumes:
  postgres_data:
  uploads_data:
```

---

## Step 2 — Create `.env`

Create a file called `.env` in the same folder and paste this, filling in your own values:

```env
# PostgreSQL
POSTGRES_DB=familyfinance
POSTGRES_USER=familyfinance
POSTGRES_PASSWORD=your_strong_password

# Must match the values above
DATABASE_URL=postgresql://familyfinance:your_strong_password@db:5432/familyfinance

# JWT — generate each with:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=your_64_byte_hex_secret
JWT_REFRESH_SECRET=your_other_64_byte_hex_secret

# App
NODE_ENV=production
PORT=3000
FRONTEND_URL=http://localhost:8080
COOKIE_DOMAIN=localhost
VITE_API_URL=http://localhost:8080/api
```

---

## Step 3 — Log in to GitHub Container Registry

Create a GitHub Personal Access Token with `read:packages` scope at:
`github.com → Settings → Developer settings → Personal access tokens`

```bash
echo "<YOUR_GITHUB_TOKEN>" | docker login ghcr.io -u harshit-mehtaa --password-stdin
```

---

## Step 4 — Start the app

```bash
docker compose -f docker-compose.deploy.yml pull
docker compose -f docker-compose.deploy.yml up -d
```

App runs at **http://localhost:8080**

---

## Updating to a new version

```bash
docker compose -f docker-compose.deploy.yml pull
docker compose -f docker-compose.deploy.yml up -d
```

## When a migration fails — recovering from P3009

A failed migration stops the whole stack, not just the migration. Both
`docker-compose.yml` and `docker-compose.deploy.yml` declare the backend as
`depends_on: migrate: condition: service_completed_successfully`, so if `migrate`
exits non-zero the backend never starts. There is no partial-service state: the app
is simply down until this is resolved.

Every subsequent `up` then fails with:

```
Error: P3009
migrate found failed migrations in the target database, new migrations will not
be applied.
```

Prisma refuses to continue because it cannot know whether the failed migration left
the database half-changed.

### Before anything else, take a dump

```bash
docker compose -f docker-compose.deploy.yml exec db \
  pg_dump -U familyfinance familyfinance > backup-$(date +%Y%m%d-%H%M%S).sql
```

Nothing below is destructive, but recovery involves telling Prisma to trust a claim
about the database's state. If that claim is wrong, the next migration runs against
a schema it does not expect.

### Step 1 — find out which migration failed

```bash
docker compose -f docker-compose.deploy.yml run --rm migrate \
  npx prisma migrate status
```

Or read it directly:

```bash
docker compose -f docker-compose.deploy.yml exec db psql -U familyfinance -d familyfinance -c \
  'SELECT migration_name, started_at, finished_at, rolled_back_at
     FROM "_prisma_migrations" WHERE finished_at IS NULL;'
```

A row with `finished_at IS NULL` is the one that failed.

### Step 2 — decide whether it rolled back or partly applied

This decides which command to run, and getting it wrong is the only way to make
things worse.

**Prisma wraps each migration file in a single transaction**, so a failure normally
rolls the whole file back and leaves nothing behind. Every migration in this repo is
written to keep that true — the file headers say so explicitly.

Two statements break out of that transaction and are the exception:
`CREATE INDEX CONCURRENTLY` and `ALTER TYPE ... ADD VALUE`. If the failed migration
contains either, assume it partly applied and check by hand.

Verify rather than assume — look for something the migration should have created:

```bash
docker compose -f docker-compose.deploy.yml exec db psql -U familyfinance -d familyfinance -c \
  "SELECT column_name FROM information_schema.columns
    WHERE table_name = 'TheTable' AND column_name = 'the_new_column';"
```

- **Nothing was created** → it rolled back. Go to Step 3a.
- **Some of it exists** → it partly applied. Go to Step 3b.

### Step 3a — it rolled back (the usual case)

```bash
docker compose -f docker-compose.deploy.yml run --rm migrate \
  npx prisma migrate resolve --rolled-back 20260817080000_the_failed_migration
```

Then fix the migration SQL, or remove the migration directory if it should never
have existed, and start normally:

```bash
docker compose -f docker-compose.deploy.yml up -d
```

### Step 3b — it partly applied

Finish or undo the partial change by hand first, so the database matches what the
migration would have produced. Then, depending on which you did:

```bash
# You completed the change manually — record it as applied:
docker compose -f docker-compose.deploy.yml run --rm migrate \
  npx prisma migrate resolve --applied 20260817080000_the_failed_migration

# You undid the partial change — record it as rolled back:
docker compose -f docker-compose.deploy.yml run --rm migrate \
  npx prisma migrate resolve --rolled-back 20260817080000_the_failed_migration
```

`--applied` tells Prisma the migration is done and it will never run it again. Only
use it once the database genuinely matches.

### Step 4 — confirm

```bash
docker compose -f docker-compose.deploy.yml run --rm migrate npx prisma migrate status
# expect: "Database schema is up to date!"

docker compose -f docker-compose.deploy.yml up -d
curl -s localhost:8080/api/health
```

### If you need the app up before you can fix the migration

The backend cannot start while `migrate` fails. To bring it up against the existing
schema, start it without the dependency:

```bash
docker compose -f docker-compose.deploy.yml up -d db
docker compose -f docker-compose.deploy.yml up -d --no-deps backend nginx
```

Only reasonable when the failed migration rolled back cleanly, so the schema still
matches the previously deployed code. If the app was already updated to code that
expects the new schema, it will fail at runtime instead — fix the migration.

### This procedure is tested

The commands above were verified end to end against a real database: a deliberately
failing migration was applied, P3009 reproduced, and `--rolled-back` followed by a
normal deploy restored it to "Database schema is up to date!". The rollback
behaviour was confirmed by checking the column the failed migration tried to add was
absent afterwards.

## Common operations

```bash
# View running containers
docker compose -f docker-compose.deploy.yml ps

# Tail logs
docker compose -f docker-compose.deploy.yml logs -f

# Stop everything
docker compose -f docker-compose.deploy.yml down

# Stop and wipe database (destructive)
docker compose -f docker-compose.deploy.yml down -v
```
