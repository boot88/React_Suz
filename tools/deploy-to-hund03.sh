#!/usr/bin/env bash
# Доставка обновлений из тестовой копии (React_Suz_dev) на боевой сервер hund03.
#
#   bash tools/deploy-to-hund03.sh            — перенос + сборка + перезапуск
#   DRY_RUN=1 bash tools/deploy-to-hund03.sh  — показать, что изменится (ничего не меняет)
#
# ЧТО НЕ ЗАТРАГИВАЕТСЯ НИКОГДА:
#   • база данных MySQL (дампы не заливаются, к БД не подключаемся);
#   • боевой .env на сервере (пароль MySQL, секрет токенов, имя базы its);
#   • server/data    — JSON-хранилища и архивы (чаты, лента, бэкапы, восстановление);
#   • server/uploads — аватары сотрудников и файлы из чатов;
#   • node_modules и build на сервере (зависимости ставятся, клиент собирается на месте).
# Заявки, статьи, справочник и IP-адреса живут в базе данных на самом сервере,
# поэтому обновление кода их не трогает.
#
# Параметры можно переопределить переменными окружения:
#   REMOTE, REMOTE_DIR, SERVICE, PORT, EXTRA_PORTS, NAME, BACKUP_ROOT, DRY_RUN
# По умолчанию: PORT=3000 (основной адрес), EXTRA_PORTS=5000 (старые ссылки).
# NAME — короткое имя сервера для подсказок (esz); сами имена (esz, zayavki,
# el-ap-sys) живут в DNS и в hosts у клиентов и задаются скриптами
# tools/setup-client-name.sh / .ps1 / .cmd.
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${REMOTE:-qwest@192.168.129.31}"
REMOTE_DIR="${REMOTE_DIR:-/home/qwest/React_Suz}"
SERVICE="${SERVICE:-react-suz}"
PORT="${PORT:-3000}"
# Дополнительный порт: старые ссылки на :5000 продолжают открываться.
# Оставьте пустым (EXTRA_PORTS=), чтобы служба слушала только PORT.
EXTRA_PORTS="${EXTRA_PORTS:-5000}"
# Короткое имя сервера для подсказок: в браузере http://esz:3000
# (см. tools/setup-client-name.* и README, раздел «Боевой адрес»)
NAME="${NAME:-esz}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/qwest/.react_suz_releases}"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
SSH_CMD=(ssh "${SSH_OPTS[@]}" "$REMOTE")
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

EXCLUDES=(
  --exclude 'node_modules'
  --exclude '.git'
  --exclude '.github'
  --exclude 'build'
  --exclude '.env'
  --exclude 'coverage'
  --exclude '*.log'
  --exclude 'server/uploads/'
  --exclude 'server/data/'
)

log "Шаг 1/5. Проверяю связь с $REMOTE"
"${SSH_CMD[@]}" "test -d '$REMOTE_DIR/server'" \
  || { echo "❌ Нет связи или на сервере нет папки $REMOTE_DIR/server."; exit 1; }
echo "Связь есть."

log "Шаг 2/5. Резервная копия боевой папки на сервере"
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "(DRY_RUN — копия не создаётся)"
else
  # build тоже копируем: если сборка новой версии не удастся, старую сборку
  # можно вернуть с этой копии.
  "${SSH_CMD[@]}" "mkdir -p '$BACKUP_ROOT/$STAMP' && rsync -a --delete \
    --exclude node_modules --exclude .git \
    --exclude 'server/uploads/' --exclude 'server/data/' \
    '$REMOTE_DIR/' '$BACKUP_ROOT/$STAMP/'"
  echo "Копия: $BACKUP_ROOT/$STAMP"
fi

log "Шаг 3/5. Переношу файлы $DEV_DIR -> $REMOTE:$REMOTE_DIR"
if [ "${DRY_RUN:-0}" = "1" ]; then
  rsync -ani --delete "${EXCLUDES[@]}" -e "$RSYNC_SSH" "$DEV_DIR/" "$REMOTE:$REMOTE_DIR/"
  echo
  echo "(DRY_RUN — изменения не применены)"
  exit 0
fi
rsync -a --delete "${EXCLUDES[@]}" -e "$RSYNC_SSH" "$DEV_DIR/" "$REMOTE:$REMOTE_DIR/"

# В тестовой копии package.json проксирует /api на порт стенда (5100).
# На сервере сборку и API отдаёт один и тот же процесс, поэтому вернуть боевой порт.
"${SSH_CMD[@]}" "cd '$REMOTE_DIR' && sed -i 's#\"proxy\": *\"http://localhost:5100\"#\"proxy\": \"http://localhost:${PORT}\"#' package.json"

log "Шаг 4/5. Ставлю зависимости и собираю клиент на сервере (БД не используется)"
# Сборка идёт в отдельную папку и только потом подменяет build: пока клиент
# собирается, посетители видят прежнюю версию, а не наполовину пустую папку
# (иначе часть запросов к бандлам отдаёт index.html и страница становится белой).
"${SSH_CMD[@]}" "cd '$REMOTE_DIR' && export PATH=\"\$HOME/.local/bin:\$PATH\" && npm install --no-audit --no-fund && rm -rf build-next && BUILD_PATH=build-next npm run build && rm -rf build-prev && if [ -d build ]; then mv build build-prev; fi && mv build-next build && rm -rf build-prev"

log "Шаг 5/5. Синхронизирую параметры службы и перезапускаю её"
"${SSH_CMD[@]}" "cd '$REMOTE_DIR' && mkdir -p ~/.config/systemd/user && if ! cmp -s tools/react-suz-hund03.service ~/.config/systemd/user/${SERVICE}.service; then install -m 0644 tools/react-suz-hund03.service ~/.config/systemd/user/${SERVICE}.service && systemctl --user daemon-reload && echo '  параметры службы обновлены: порт ${PORT}${EXTRA_PORTS:+, доп. порт ${EXTRA_PORTS}}'; else echo '  параметры службы уже актуальны'; fi"
"${SSH_CMD[@]}" "systemctl --user restart '$SERVICE.service' && sleep 2 && systemctl --user is-active '$SERVICE.service'" \
  || { echo "❌ Служба не поднялась. Смотрите на сервере: journalctl --user -u $SERVICE -n 50"; exit 1; }

log "Проверка по сети"
# Проверяем именно то, что ломает страницу: файлы должны отдаваться с верными
# типами, а отсутствующий бандл — получать 404, а не HTML.
"${SSH_CMD[@]}" "cd '$REMOTE_DIR' && BUNDLE=\$(grep -o 'static/js/main\\.[a-z0-9]*\\.js' build/index.html | head -n 1) && \
  curl -s -o /dev/null -w '  GET /                     -> %{http_code} %{content_type}\n' http://127.0.0.1:${PORT}/ && \
  curl -s -o /dev/null -w \"  \$BUNDLE -> %{http_code} %{content_type}\n\" http://127.0.0.1:${PORT}/\$BUNDLE && \
  curl -s -o /dev/null -w '  GET /api/health           -> %{http_code} %{content_type}\n' http://127.0.0.1:${PORT}/api/health && \
  curl -s -o /dev/null -w '  старый бандл (ждём 404)   -> %{http_code} %{content_type}\n' http://127.0.0.1:${PORT}/static/js/main.deadbeef.js"

for extra in ${EXTRA_PORTS//,/ }; do
  "${SSH_CMD[@]}" "curl -s -o /dev/null -w '  доп. порт ${extra}: GET /   -> %{http_code}\n' http://127.0.0.1:${extra}/"
done

echo
echo "✅ Обновление доставлено. База данных и файлы данных не изменялись."
echo "   Приложение: http://${REMOTE#*@}:${PORT}"
[ -n "$EXTRA_PORTS" ] && echo "   Старые ссылки (порт ${EXTRA_PORTS}) тоже отвечают."
echo "   По имени:   http://${NAME}:${PORT}   (запись в hosts клиента — tools/setup-client-name.sh)"
echo "   DNS-имя:    http://zayavki.nioch.nsc.ru:${PORT}   (уже работает, настройка клиентов не нужна)"
echo "   Откат к прежней версии (на сервере):"
echo "     rsync -a --delete --exclude node_modules --exclude .git --exclude build \\"
echo "       --exclude .env --exclude 'server/uploads/' --exclude 'server/data/' \\"
echo "       '$BACKUP_ROOT/$STAMP/' '$REMOTE_DIR/' && systemctl --user restart ${SERVICE}"
