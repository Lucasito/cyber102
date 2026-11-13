# Афиша культуры РБ — образ приложения (Next.js + Prisma). Основа — Dockerfile crm_spare_parts.
# Миграции выполняются при старте контейнера (docker/entrypoint.sh).
#
# Скорость пересборки: node_modules (~1 ГБ) — отдельным слоем финального образа. Пока package-lock.json
# не менялся, этот слой берётся из кэша и не копируется и не экспортируется заново; новые слои — только
# исходники и результат сборки (десятки МБ). Кэш сборки Next.js лежит в кэше BuildKit, не в образе.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Сборка не подключается к БД, но модуль Prisma требует адрес.
# Ограничение памяти — на сервере 1.8 ГБ RAM и рядом работает РемЗап
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS="--max-old-space-size=1024"
RUN --mount=type=cache,target=/app/.next/cache npx prisma generate && npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
# Сначала то, что меняется редко: зависимости — из кэша слоёв
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# Исходники (скрипты, миграции, public) и результат сборки
COPY --chown=node:node . .
COPY --from=build --chown=node:node /app/generated ./generated
COPY --from=build --chown=node:node /app/.next ./.next
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "docker/entrypoint.sh"]
