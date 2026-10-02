#!/usr/bin/env bash
# Одноразовая подготовка тестовой базы its_test.
#
# Запускать ЧЕРЕЗ SUDO: у пользователя MySQL 'admin' нет права CREATE DATABASE,
# создать базу и выдать права может только root.
#
#   sudo bash tools/create_test_db.sh
#
# Скрипт: 1) создаёт its_test, 2) выдаёт на неё права пользователю admin,
#         3) копирует туда структуру и данные боевой базы its.
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DEV_DIR/.env"
[ -f "$ENV_FILE" ] || { echo "Не найден $ENV_FILE"; exit 1; }

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

SRC_DB="its"          # боевая база — источник
DST_DB="$(get MYSQL_DATABASE)"
DB_HOST="$(get MYSQL_HOST)"
DB_PORT="$(get MYSQL_PORT)"
DB_USER="$(get MYSQL_USER)"
DB_PASS="$(get MYSQL_PASSWORD)"

[ "$DST_DB" = "its" ] && { echo "В .env указана боевая база its — правьте MYSQL_DATABASE."; exit 1; }

if [ "$(id -u)" != "0" ]; then
  echo "Нужны права root: sudo bash tools/create_test_db.sh"
  exit 1
fi

echo "1/3 Создаю базу $DST_DB и выдаю права пользователю $DB_USER"
mysql -e "CREATE DATABASE IF NOT EXISTS \`$DST_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "GRANT ALL PRIVILEGES ON \`$DST_DB\`.* TO '$DB_USER'@'localhost';"
mysql -e "GRANT ALL PRIVILEGES ON \`$DST_DB\`.* TO '$DB_USER'@'127.0.0.1';"
mysql -e "FLUSH PRIVILEGES;"

echo "2/3 Копирую структуру и данные из $SRC_DB в $DST_DB"
export MYSQL_PWD="$DB_PASS"
mysqldump -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" \
  --single-transaction --routines --triggers \
  "$SRC_DB" | mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DST_DB"

echo "3/3 Готово. Таблиц в $DST_DB:"
mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DST_DB';"
echo "Теперь можно запускать тестовую копию ярлыком «React_Suz DEV — запуск»."
