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
