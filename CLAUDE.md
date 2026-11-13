# Афиша культуры Башкортостана — правила проекта

Документация: README.md и docs/ (ARCHITECTURE, API, BOTS, ADMIN, DEPLOY). При изменениях — обновлять.
ТЗ заказчика — docs/TZ.md, сверка и план работ — docs/PLAN.md (отмечать выполненное).

- Стек: Next.js 16 (App Router) + Prisma 7 (клиент в `generated/prisma`) + PostgreSQL 16, Tailwind 4.
  Код и комментарии на русском. Модули ИИ и MAX — из `D:\Git\crm_spare_parts`.
- Главный принцип задачи: **выдуманных мероприятий нет**. У каждого события — источник (`EventSource.url`).
  ИИ-агент выбирает только из результатов поиска по БД, список событий в ответе формирует код.
- Поиск — одна функция `searchEvents` (`lib/server/events.ts`) для сайта, API, виджета, ботов и агента.
- ИИ — только через `lib/server/ai.ts` (`chat`, `askJson`): очередь, повторы, предохранитель, кэш.
  Агент обязан работать и без ИИ (правила `ruleFilter` + шаблон).
- Настройки, ключи и токены — в админке (`lib/server/settings.ts`, таблица `Setting`), не в `.env` и не в коде.
- REST API версионируется (`/api/v1`); при изменении — обновлять `app/api/v1/openapi/route.ts` и docs/API.md.
- Админка: каждое server action начинается с `await requireAdmin()`.
- Сервер общий с продакшном РемЗап (`/opt/remzap`): не трогать его контейнеры, не открывать новые порты,
  не делать `docker system prune`. Деплой — `bash scripts/deploy.sh`.
- Тестовые события — источник `demo` (`lib/demo-data.ts`).
- Перед коммитом: `npm run typecheck && npm run lint`.
