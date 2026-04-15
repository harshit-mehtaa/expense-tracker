# Deployment Guide

Deploy on any machine with Docker installed. No repo clone needed — just two files.

## First-time setup

```bash
# 1. Download the two required files
curl -O https://raw.githubusercontent.com/harshit-mehtaa/expense-tracker/main/docker-compose.deploy.yml
curl -O https://raw.githubusercontent.com/harshit-mehtaa/expense-tracker/main/.env.deploy.example

# 2. Create your .env from the template
cp .env.deploy.example .env
# Edit .env — change passwords, DATABASE_URL, and JWT secrets
```

Generate JWT secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

```bash
# 3. Log in to GitHub Container Registry
#    Use a GitHub Personal Access Token with read:packages scope
#    (github.com → Settings → Developer settings → Personal access tokens)
echo "<YOUR_GITHUB_TOKEN>" | docker login ghcr.io -u harshit-mehtaa --password-stdin

# 4. Pull images and start
docker compose -f docker-compose.deploy.yml pull
docker compose -f docker-compose.deploy.yml up -d
```

App runs at **http://localhost:8080**

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
