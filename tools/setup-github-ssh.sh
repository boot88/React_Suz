#!/usr/bin/env bash
# Перевод тестовой копии на SSH-доступ к GitHub (вместо токена).
#
#   1) bash tools/setup-github-ssh.sh key    — создать ключ и показать его для GitHub
#   2) добавить ключ на https://github.com/settings/keys
#   3) bash tools/setup-github-ssh.sh push   — проверить доступ, переключить remote, запушить
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEV_DIR"

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_URL="${SSH_URL:-git@github.com:boot88/React_Suz.git}"
HTTPS_URL="${HTTPS_URL:-https://github.com/boot88/React_Suz.git}"
DEV_BRANCH="${DEV_BRANCH:-dev/test-stand}"

cmd="${1:-help}"
case "$cmd" in
  key)
    mkdir -p "$HOME/.ssh"
    chmod 700 "$HOME/.ssh"
    if [ ! -f "$SSH_KEY" ]; then
      ssh-keygen -q -t ed25519 -N "" -C "boot88@$(hostname)-react-suz-dev" -f "$SSH_KEY"
      echo "Ключ создан: $SSH_KEY"
    else
      echo "Ключ уже существует: $SSH_KEY"
    fi
    ssh-keyscan -t rsa,ed25519 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || true
    chmod 600 "$HOME/.ssh/known_hosts" 2>/dev/null || true
    echo
    echo "Скопируйте ключ ниже и добавьте его на https://github.com/settings/keys (New SSH key):"
    echo
    cat "$SSH_KEY.pub"
    ;;
  push)
    echo "Проверяю доступ к GitHub по SSH ..."
    out="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true)"
    echo "$out"
    case "$out" in
      *"successfully authenticated"*) ;;
      *)
        echo "❌ SSH-доступ не работает. Добавьте ключ на https://github.com/settings/keys и повторите."
        echo "   Вернуть HTTPS: git remote set-url origin $HTTPS_URL"
        exit 1
        ;;
    esac
    git remote set-url origin "$SSH_URL"
    echo "Remote переключён на $SSH_URL"
    git push -u origin "HEAD:$DEV_BRANCH"
    echo "✅ Ветка $DEV_BRANCH отправлена на GitHub."
    git --no-pager log --oneline -1
    ;;
  test)
    ssh -o BatchMode=yes -T git@github.com 2>&1 || true
    ;;
  *)
    echo "Использование: bash tools/setup-github-ssh.sh {key|push|test}"
    exit 1
    ;;
esac
