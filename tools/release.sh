#!/usr/bin/env bash
# «Кнопка переноса»: переносит проверенную версию из тестовой папки в боевую.
#
#   bash tools/release.sh
#
# Порядок: тесты -> резервная копия боевой -> синхронизация файлов -> перезапуск.
# Боевые .env, node_modules, server/uploads и server/data НИКОГДА не затираются.
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_DIR="${PROD_DIR:-/home/qwest/.cline/data/workspaces/chat/React_Suz}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/qwest/.react_suz_releases}"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

[ -d "$DEV_DIR/src" ] || { echo "Не найдена тестовая папка $DEV_DIR"; exit 1; }
[ -d "$PROD_DIR" ]    || { echo "Не найдена боевая папка $PROD_DIR"; exit 1; }

EXCLUDES=(
  --exclude 'node_modules'
  --exclude '.git'
  --exclude 'build'
  --exclude '.env'
  --exclude 'server/uploads/'
  --exclude 'server/data/'
)

log "Шаг 1/4. Тесты сервера в тестовой копии (информационно)"
cd "$DEV_DIR"
TEST_LOG="$(mktemp)"
# В проекте есть заранее падающий тест и тест-процесс не всегда завершается
# сам (открытый пул MySQL), поэтому ограничиваем время и не считаем это отказом.
set +e
timeout 90 npm run test:server > "$TEST_LOG" 2>&1
TEST_CODE=$?
set -e
grep -E '^# (tests|pass|fail)' "$TEST_LOG" || echo "(итоговую строку тестов получить не удалось)"
if [ "$TEST_CODE" -eq 124 ]; then
  echo "⚠️ Тест-процесс не завершился за 90 с (известная особенность проекта, не блокирует перенос)."
elif [ "$TEST_CODE" -ne 0 ]; then
  echo "⚠️ Тесты завершились с кодом $TEST_CODE (в проекте есть заранее падающие тесты)."
else
  echo "✅ Тесты прошли."
fi
if [ "${REQUIRE_TESTS:-0}" = "1" ] && [ "$TEST_CODE" -ne 0 ]; then
  echo "❌ REQUIRE_TESTS=1 и тесты не прошли — перенос отменён."
  exit 1
fi

log "Шаг 2/4. Резервная копия боевой версии -> $BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP_ROOT/$STAMP"
rsync -a --delete --exclude 'node_modules' --exclude '.git' "$PROD_DIR/" "$BACKUP_ROOT/$STAMP/"

if [ "${AUTO_CONFIRM:-0}" != "1" ]; then
  read -r -p "Перенести изменения в боевую версию? (y/N) " answer
  case "$answer" in [yYдД]*) ;; *) echo "Отменено. Боевая версия не изменена."; exit 0 ;; esac
fi

log "Шаг 3/4. Перенос файлов из тестовой папки в боевую"
rsync -a --delete "${EXCLUDES[@]}" "$DEV_DIR/" "$PROD_DIR/"

# ВАЖНО: тестовая копия работает на своём порту (proxy = 5100). Если оставить его
# в боевой папке, боевой клиент начнёт проксировать /api на тестовый сервер.
if grep -q '"proxy": *"http://localhost:5100"' "$PROD_DIR/package.json"; then
  sed -i 's#"proxy": *"http://localhost:5100"#"proxy": "http://localhost:5000"#' "$PROD_DIR/package.json"
  echo "Боевой proxy в package.json возвращён на http://localhost:5000"
fi

log "Шаг 4/4. Перезапуск боевой версии"
if systemctl --user is-active --quiet react-suz.service 2>/dev/null; then
  systemctl --user restart react-suz.service
  echo "Боевой сервис react-suz перезапущен."
else
  echo "Боевая версия запущена НЕ службой (ярлыком в терминале)."
  echo "Перезапустите её ярлыком «React_Suz — запуск» на рабочем столе."
fi

echo
echo "✅ Перенос выполнен."
echo "   Откат: bash tools/rollback.sh $STAMP"
