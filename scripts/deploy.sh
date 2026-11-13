#!/bin/bash
# Деплой на сервер хакатона: исходники → /opt/afisha → docker compose build/up.
# Запуск из корня проекта (Git Bash): bash scripts/deploy.sh
#
# Доступ: SSH-ключ, если настроен; иначе plink (PuTTY) с паролем из файла psw (в git не попадает).
# .env на сервере создаётся один раз из локального .env (ИИ и MAX) + случайный пароль БД;
# дальше правится на сервере: /opt/afisha/.env, затем снова этот скрипт.
set -euo pipefail

HOST="${DEPLOY_HOST:-193.47.33.213}"
USER_="${DEPLOY_USER:-root}"
DIR=/opt/afisha
PUBLIC_URL="${PUBLIC_URL:-https://afish.193-47-33-213.sslip.io}"
HOSTKEY="SHA256:vTP34yqfDkIDvvXLxmGs7oPIqS/In19l1sFWSVmoQoE"

if ssh -o BatchMode=yes -o ConnectTimeout=5 "$USER_@$HOST" true 2>/dev/null; then
  run() { ssh "$USER_@$HOST" "$@"; }
else
  [ -f psw ] || { echo "Нет SSH-ключа и файла psw"; exit 1; }
  # psw: … root / Пароль / <пароль> / Max / <токен бота>: пароль — 3-я непустая строка начиная с «root»
  PW=$(tr -d '\r' < psw | grep -A3 '^root$' | grep -v '^[[:space:]]*$' | sed -n 3p | tr -d ' ')
  run() { plink -batch -ssh -hostkey "$HOSTKEY" -pw "$PW" "$USER_@$HOST" "$@"; }
fi

echo "→ Загрузка исходников в $DIR"
tar czf - --exclude=node_modules --exclude=.next --exclude=generated --exclude=.env --exclude=psw \
  --exclude=.git --exclude='*.tsbuildinfo' --exclude=test-results . |
  # Код раскладывается в чистую папку: удалённые и перенесённые файлы не остаются на сервере.
  # .env сервера сохраняется; база — в томе Docker, её это не касается.
  run "set -e; rm -rf $DIR.new && mkdir -p $DIR.new && tar xzf - -C $DIR.new && if [ -f $DIR/.env ]; then cp -p $DIR/.env $DIR.new/.env; fi && rm -rf $DIR.old && if [ -d $DIR ]; then mv $DIR $DIR.old; fi && mv $DIR.new $DIR && rm -rf $DIR.old"

if ! run "test -f $DIR/.env"; then
  echo "→ Создаю $DIR/.env"
  {
    echo "PUBLIC_URL=\"$PUBLIC_URL\""
    echo "POSTGRES_PASSWORD=\"$(openssl rand -hex 16)\""
    grep -E '^(AI_PROVIDER|GIGACHAT_[A-Z_]+|LLM_[A-Z_]+|MAX_[A-Z_]+)=' .env || true
  } | run "umask 077 && cat > $DIR/.env"
fi

echo "→ Сборка и запуск"
# Ошибка сборки останавливает деплой (иначе продолжает работать старый контейнер, а скрипт пишет «Готово»)
run "set -o pipefail; cd $DIR && docker compose -f docker-compose.prod.yml build afisha 2>&1 | grep -E 'error|Error|ERROR' | head -20; test \${PIPESTATUS[0]} -eq 0" || { echo "✗ Сборка не удалась"; exit 1; }
run "cd $DIR && docker compose -f docker-compose.prod.yml up -d --remove-orphans 2>&1 | tail -3 && docker image prune -f >/dev/null"

echo "→ Проверка"
run "for i in \$(seq 1 30); do docker exec afisha-app node -e \"fetch('http://localhost:3000/api/health').then(r=>r.text()).then(t=>{console.log(t);process.exit(0)}).catch(()=>process.exit(1))\" 2>/dev/null && exit 0; sleep 2; done; docker logs --tail 30 afisha-app; exit 1"
echo "Готово: $PUBLIC_URL"
