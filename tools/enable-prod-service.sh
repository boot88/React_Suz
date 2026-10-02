#!/usr/bin/env bash
# Одноразово переводит БОЕВУЮ версию в пользовательскую службу systemd,
# чтобы кнопка переноса (release.sh) умела перезапускать её сама.
#
#   bash tools/enable-prod-service.sh
#
# ВАЖНО: сначала закройте боевую версию, запущенную ярлыком в терминале
# (иначе порт 5000 занят и служба не стартует).
set -euo pipefail

UNIT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/react-suz.service"
UNIT_DIR="$HOME/.config/systemd/user"

if ss -ltn 2>/dev/null | grep -q ':5000 '; then
  echo "❌ Порт 5000 занят — похоже, боевая версия уже запущена в терминале."
  echo "   Закройте то окно (Ctrl+C) и запустите этот скрипт снова."
  exit 1
fi

mkdir -p "$UNIT_DIR"
cp "$UNIT_SRC" "$UNIT_DIR/react-suz.service"
systemctl --user daemon-reload
systemctl --user enable --now react-suz.service
loginctl enable-linger "$USER" 2>/dev/null || true

sleep 2
systemctl --user --no-pager --lines=0 status react-suz.service || true
echo
echo "✅ Боевая версия теперь работает как служба react-suz."
echo "   Управление: systemctl --user {status|restart|stop} react-suz"
echo "   Ярлык «React_Suz — запуск» больше не нужен."
