#!/usr/bin/env bash
# Запуск тестовой копии на изолированных портах:
#   сервер 5100, клиент 3100  (боевая версия: 5000 / 3000).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

export PORT="${PORT:-5100}"
export CLIENT_PORT="${CLIENT_PORT:-3100}"
export BROWSER=none   # не открывать лишнюю вкладку автоматически

echo "Тестовая копия: сервер :$PORT, клиент :$CLIENT_PORT, база из .env (MYSQL_DATABASE)"
exec npm run dev
