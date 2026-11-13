# Сервер и деплой

## Сервер

| | |
|---|---|
| Адрес | `193.47.33.213`, Ubuntu 24.04, 2 ядра, 1,8 ГБ RAM + 5,7 ГБ swap, ~5 ГБ свободно на диске |
| Доступ | `root`, пароль — в локальном файле `psw` (в git не попадает) |
| Сайт | https://afish.193-47-33-213.sslip.io |
| Папка | `/opt/afisha` |

**На сервере работает продакшн РемЗап** (`/opt/remzap`, проект crm_spare_parts, домен
`193-47-33-213.sslip.io`). Его не трогаем:

- не останавливать и не пересоздавать контейнеры `remzap-*`;
- не делать `docker system prune` (удалит кэш сборки и чужие образы);
- не открывать новые порты — 80/443 заняты Caddy РемЗапа.

## Как устроено

```
Интернет ─► remzap-caddy-1 (80/443, Let's Encrypt)
              ├─ 193-47-33-213.sslip.io        ─► remzap-app-1
              └─ afish.193-47-33-213.sslip.io  ─► afisha-app:3000  (сеть remzap_default)
afisha-app ─► afisha-db-1 (PostgreSQL 16, том afisha_db-data)
```

- `docker-compose.prod.yml` — проект `afisha`: `db` (лимит 256 МБ) и `app` (512 МБ, контейнер `afisha-app`,
  подключён к сети `remzap_default`). Порты наружу не публикуются.
- HTTPS — Caddy РемЗапа: блок из `docker/Caddyfile.afish` добавлен в `/opt/remzap/docker/Caddyfile` и в
  репозиторий crm_spare_parts (`docker/Caddyfile`), чтобы деплой РемЗапа его не затёр.
- `sslip.io` сам резолвит любой поддомен `*.193-47-33-213.sslip.io` в этот IP — DNS-записи не нужны.
- При старте контейнера применяются миграции (`docker/entrypoint.sh`).

## Деплой

```bash
bash scripts/deploy.sh      # из корня проекта, Git Bash
```

Скрипт:

1. Упаковывает исходники (без `node_modules`, `.next`, `.env`, `psw`) и раскладывает их в **чистую** папку
   `/opt/afisha` — удалённые файлы на сервере не остаются. `.env` сервера сохраняется.
2. Собирает образ на сервере (`docker compose build app`). **Ошибка сборки останавливает деплой** — иначе
   продолжил бы работать старый контейнер.
3. Перезапускает приложение и ждёт `/api/health`.

Доступ — SSH-ключ, если настроен, иначе `plink` (PuTTY) с паролем из `psw`. Сборка идёт около 3–5 минут.

## Переменные окружения (`/opt/afisha/.env`)

| Переменная | Назначение |
|---|---|
| `PUBLIC_URL` | Публичный адрес (ссылки в ботах, API, виджете) |
| `POSTGRES_PASSWORD` | Пароль БД (создан при первом деплое) |
| `ADMIN_KEY` | Ключ входа в админку, ≥16 символов |
| `MAX_MODE` | `polling` (по умолчанию) или `webhook` |
| `MAX_WEBHOOK_SECRET` | Только для webhook MAX |

Ключи ИИ и токены ботов хранятся **в админке** (таблица `Setting`), не в `.env`. Переменные
`GIGACHAT_*`, `LLM_*`, `MAX_BOT_TOKEN`, `TELEGRAM_*` поддерживаются как запасные значения, но не заданы.
Перенести их из `.env` в настройки: `npx tsx scripts/env-to-settings.mts`.

## Эксплуатация

```bash
docker logs -f afisha-app                                    # логи
docker exec afisha-app npx tsx scripts/seed-demo.mts --allow-remote          # тестовые данные
docker exec afisha-app npx tsx scripts/seed-demo.mts --allow-remote --clear  # удалить их
docker exec afisha-db-1 pg_dump -U afisha afisha > backup.sql                # резервная копия БД
cd /opt/afisha && docker compose -f docker-compose.prod.yml restart app      # перезапуск
```

Тестовыми данными удобнее управлять из админки (раздел «Данные»).

## Внешние сервисы

| Сервис | Для чего | Ключ |
|---|---|---|
| GigaChat (Сбер) | ИИ-помощник | в админке |
| MAX Bot API | бот MAX | в админке |
| Telegram Bot API через Cloudflare Worker | бот Telegram | в админке |
| tile.openstreetmap.org | плитки карты (из браузера посетителя) | не нужен, обязательна подпись © OpenStreetMap |
| Яндекс Карты, JavaScript API v3 | карта, если выбрана в админке | в админке («Карта»), ограничить по HTTP Referer |

Плитки CARTO сначала использовались для карты, но стали требовать ключ — заменены на OpenStreetMap. При
большой нагрузке правила OSM требуют свой сервер плиток или коммерческого поставщика.

## Известные подвохи

- **Имена сервисов в общей сети с РемЗапом.** Docker регистрирует имя compose-сервиса в каждой сети, к которой
  подключён контейнер. В сети `remzap_default` имена `app` и `db` — это РемЗап. Если сервис афиши назвать
  `app`, Caddy РемЗапа (`reverse_proxy app:3000`) будет отправлять часть запросов РемЗапа в афишу — у пользователей
  РемЗапа страницы через раз будут открываться как 404. Поэтому сервисы афиши называются `afisha` (контейнер
  `afisha-app`) и база — с псевдонимом `afisha-db`. **Не называть сервисы `app`, `db`, `caddy`**, не подключать
  базу афиши к сети РемЗапа. Проверка: `docker exec remzap-caddy-1 getent hosts app` — должен быть один адрес.

- **Caddy держит старую копию Caddyfile.** Файл на хосте заменялся деплоем РемЗапа, а контейнер видит
  прежний inode — `caddy reload` с `/etc/caddy/Caddyfile` изменений не видит. Как применить правку без
  перезапуска РемЗапа:
  ```bash
  docker cp /opt/remzap/docker/Caddyfile remzap-caddy-1:/tmp/Caddyfile
  docker exec remzap-caddy-1 caddy validate --config /tmp/Caddyfile --adapter caddyfile
  docker exec remzap-caddy-1 caddy reload --config /tmp/Caddyfile --adapter caddyfile
  ```
  При перезапуске контейнера Caddy сам подхватит актуальный файл.
- **Telegram заблокирован с сервера в обе стороны** — бот работает через Cloudflare Worker
  ([BOTS.md](BOTS.md)).
- **Бесплатный GigaChat — один поток.** Параллельные запросы получают 429 — поэтому очередь
  ([ARCHITECTURE.md](ARCHITECTURE.md#ии-провайдеры-и-нагрузка-libserveraits)).
- **Проверка ИИ запросом с кириллицей из Git Bash** (`curl -d '...'`) портит кодировку — тело запроса
  передавайте файлом: `--data-binary @q.json`.

## Локальная разработка

См. [README](../README.md#быстрый-старт-локально). Локальный бот с тем же токеном, что на сервере, запускать
нельзя — сообщения будут уходить то туда, то сюда; для разработки — отдельный тестовый бот.
