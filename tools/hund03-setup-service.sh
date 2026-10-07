#!/usr/bin/env bash
# Настройка автозапуска боевой версии React_Suz на сервере hund03.
#
# Запускать НА hund03 от пользователя qwest — права root НЕ нужны:
#     ssh qwest@192.168.129.31 'bash ~/react-suz-setup.sh'
#
# Что делает:
#   1) ставит пользовательскую службу systemd (~/.config/systemd/user/react-suz.service);
#   2) включает linger — служба поднимается сама при включении компьютера,
#      даже если никто не вошёл в систему;
#   3) гасит ручной запуск (nohup) и запускает службу;
#   4) проверяет, что сервер слушает порт.
#
# База данных и файлы данных (server/data, server/uploads, .env) не изменяются.
# Повторный запуск безопасен.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/qwest/React_Suz}"
APP_PORT="${APP_PORT:-3000}"
SERVICE="${SERVICE:-react-suz}"
LOG_FILE="${LOG_FILE:-/home/qwest/react-suz.log}"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/react-suz-hund03.service"

echo "==> Сервер: $(hostname)"
echo "==> Проект: $APP_DIR (порт $APP_PORT)"
echo "==> Служба: ${SERVICE}.service (пользовательская)"
echo

[ -f "$UNIT_SRC" ] || { echo "❌ Не найден шаблон службы: $UNIT_SRC" >&2; exit 1; }
[ -d "$APP_DIR/server" ] || { echo "❌ Не найдена папка проекта: $APP_DIR/server" >&2; exit 1; }
[ -f "$APP_DIR/.env" ] || echo "⚠️  Нет файла $APP_DIR/.env — проверьте настройки MySQL."
[ -f "$APP_DIR/build/index.html" ] || echo "⚠️  Нет сборки $APP_DIR/build — выполните сборку в $APP_DIR."

echo "==> (1/4) Ставлю службу $UNIT_DIR/${SERVICE}.service"
mkdir -p "$UNIT_DIR"
install -m 0644 "$UNIT_SRC" "$UNIT_DIR/${SERVICE}.service"
systemctl --user daemon-reload

echo "==> (2/4) Включаю автозапуск при загрузке компьютера (linger)"
if loginctl enable-linger "$USER" 2>/dev/null; then
  echo "Linger включён — служба стартует без входа в систему."
else
  echo "⚠️  Включите один раз вручную: sudo loginctl enable-linger $USER"
fi

echo "==> (3/4) Гашу ручной запуск (если был) и стартую службу"
systemctl --user stop "${SERVICE}.service" 2>/dev/null || true
PID="$(ss -ltnpH "sport = :${APP_PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -n 1 || true)"
if [ -n "$PID" ]; then
  echo "Останавливаю процесс, занявший порт ${APP_PORT}: PID $PID"
  kill "$PID" 2>/dev/null || true
  sleep 1
fi
systemctl --user enable --now "${SERVICE}.service"

echo "==> (4/4) Проверяю"
sleep 3
if systemctl --user is-active --quiet "${SERVICE}.service"; then
  echo "Служба активна."
else
  echo "❌ Служба не запустилась. Смотрите: journalctl --user -u ${SERVICE} -n 50" >&2
  exit 1
fi
if ss -ltn 2>/dev/null | grep -q ":${APP_PORT} "; then
  echo "✅ Готово: порт ${APP_PORT} слушается, автозапуск при загрузке включён."
  echo "   Адрес для других компьютеров: http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
  echo "   По понятному имени:            http://${APP_NAME:-esz}:${APP_PORT}"
  echo "                                  (запись в hosts на клиенте: tools/setup-client-name.sh)"
  echo "   DNS-имя (уже работает):        http://zayavki.nioch.nsc.ru:${APP_PORT}"
  echo "   Управление: systemctl --user {status|restart|stop} ${SERVICE}"
  echo "   Лог:        ${LOG_FILE}"
else
  echo "❌ Порт ${APP_PORT} не слушается." >&2
  echo "   Смотрите: journalctl --user -u ${SERVICE} -n 50   и   ${LOG_FILE}" >&2
  exit 1
fi
