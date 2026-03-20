.PHONY: start stop restart build reset-db seed logs shell-backend shell-db backup-db restore-db

# ── Dev lifecycle ──────────────────────────────────────────────────────────

start:
	docker compose up -d
	@echo "✓ App running at http://localhost"
	@echo "  Default login: admin@family.local / Admin@1234"

stop:
	docker compose down

restart:
	docker compose down && docker compose up -d

build:
	docker compose build --no-cache

# ── Database ───────────────────────────────────────────────────────────────

reset-db:
	@echo "⚠ This will DELETE all data. Press Ctrl+C to cancel..."
	@sleep 3
	docker compose down -v
	docker compose up -d
	@echo "✓ Database reset complete"

seed:
	docker compose exec backend npx ts-node prisma/seed.ts

migrate:
	docker compose exec backend npx prisma migrate dev

# ── Backup / Restore ───────────────────────────────────────────────────────

backup-db:
	@mkdir -p backups
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S) && \
	docker compose exec db pg_dump -U $${POSTGRES_USER:-familyfinance} $${POSTGRES_DB:-familyfinance} \
		> backups/backup_$$TIMESTAMP.sql && \
	echo "✓ Backup saved to backups/backup_$$TIMESTAMP.sql"

restore-db:
	@if [ -z "$(FILE)" ]; then echo "Usage: make restore-db FILE=backups/backup_xxx.sql"; exit 1; fi
	@echo "⚠ This will OVERWRITE the current database. Press Ctrl+C to cancel..."
	@sleep 3
	docker compose exec -T db psql -U $${POSTGRES_USER:-familyfinance} $${POSTGRES_DB:-familyfinance} < $(FILE)
	@echo "✓ Restore complete from $(FILE)"

# ── Debug ──────────────────────────────────────────────────────────────────

logs:
	docker compose logs -f

logs-backend:
	docker compose logs -f backend

shell-backend:
	docker compose exec backend sh

shell-db:
	docker compose exec db psql -U $${POSTGRES_USER:-familyfinance} $${POSTGRES_DB:-familyfinance}

# ── Production ─────────────────────────────────────────────────────────────

start-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

build-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
