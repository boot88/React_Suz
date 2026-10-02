#!/usr/bin/env bash
# Git-синхронизация тестовой копии с GitHub.
#
#   bash tools/git-sync.sh status        — показать текущую ветку и что изменено
#   bash tools/git-sync.sh pull          — забрать свежие правки боевой ветки
#   bash tools/git-sync.sh save "текст"  — закоммитить всё и отправить в свою ветку
#
# Раскладка веток:
#   codex/fix-feed-mutations — боевая ветка (в ней сидит боевая папка React_Suz)
#   dev/test-stand           — ветка тестовой копии (package.json с портом 5100,
#                              папка tools/, локальные настройки стенда)
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEV_DIR"

PROD_BRANCH="${PROD_BRANCH:-codex/fix-feed-mutations}"
DEV_BRANCH="${DEV_BRANCH:-dev/test-stand}"

cmd="${1:-status}"
case "$cmd" in
  status)
    echo "Текущая ветка: $(git rev-parse --abbrev-ref HEAD)"
    git --no-pager status --short --branch
    ;;
  pull)
    git fetch origin
    echo "Вливаю правки из origin/$PROD_BRANCH ..."
    git merge --no-edit "origin/$PROD_BRANCH"
    echo "✅ Свежие правки боевой ветки получены."
    ;;
  save)
    msg="${2:-Обновление тестовой версии $(date '+%Y-%m-%d %H:%M')}"
    git add -A
    if git diff --cached --quiet; then
      echo "Изменений нет — коммит не нужен."
    else
      git commit -m "$msg"
    fi
    git push -u origin "HEAD:$DEV_BRANCH"
    echo "✅ Отправлено в ветку $DEV_BRANCH:"
    git --no-pager log --oneline -1
    ;;
  *)
    echo "Использование: bash tools/git-sync.sh {status|pull|save \"сообщение\"}"
    exit 1
    ;;
esac
