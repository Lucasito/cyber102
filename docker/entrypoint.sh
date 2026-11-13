#!/bin/sh
set -e

npx prisma migrate deploy

# Чистая машина (docker compose up): тестовые данные и первый администратор — только если включено переменными
if [ "$BOOTSTRAP_DEMO" = "1" ] || [ "$BOOTSTRAP_ADMIN" = "1" ]; then
  npx tsx scripts/bootstrap.mts || echo "[bootstrap] не выполнен — приложение запускается без него"
fi

exec npm run start -- -p "${PORT:-3000}"
