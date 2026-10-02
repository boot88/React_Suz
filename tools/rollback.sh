#!/usr/bin/env bash
# Откат боевой версии к одной из резервных копий, сделанных release.sh.
#
#   bash tools/rollback.sh                 # покажет список копий
#   bash tools/rollback.sh 2026-10-02_14-30-00
set -euo pipefail

PROD_DIR="${PROD_DIR:-/home/qwest/.cline/data/workspaces/chat/React_Suz}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/qwest/.react_suz_releases}"
STAMP="${1:-}"

if [ -z "$STAMP" ]; then
  echo "Доступные копии в $BACKUP_ROOT:"
  ls -1 "$BACKUP_ROOT" 2>/dev/null || echo "  (пока нет ни одной)"
  echo
  echo "Запустите: bash tools/rollback.sh <имя_копии>"
  exit 0
fi

SRC="$BACKUP_ROOT/$STAMP"
[ -d "$SRC" ] || { echo "Копия не найдена: $SRC"; exit 1; }

echo "Восстанавливаю боевую папку из $SRC"
rsync -a --delete \
  --exclude 'node_modules' --exclude '.git' --exclude 'build' \
  --exclude '.env' --exclude 'server/uploads/' --exclude 'server/data/' \
  "$SRC/" "$PROD_DIR/"
echo "✅ Откат выполнен. Перезапустите боевую версию."
