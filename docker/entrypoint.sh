#!/bin/sh
set -e

npx prisma migrate deploy

# Чистая машина (docker compose up): реальные события (снимок афиши) и первый администратор — только если включено
if [ "$BOOTSTRAP_EVENTS" = "1" ] || [ "$BOOTSTRAP_ADMIN" = "1" ]; then
  npx tsx --conditions=react-server scripts/bootstrap.mts || echo "[bootstrap] не выполнен — приложение запускается без него"
fi

exec npm run start -- -p "${PORT:-3000}"
